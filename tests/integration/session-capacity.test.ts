import type { PrismaClient } from '@prisma/client';

import {
  AlreadyJoinedError,
  SessionFullError,
  joinSession,
  leaveSession,
  postChatMessage,
} from '@/app-layer/usecases/session';

import { prismaTestClient, seedTenant, type SeededTenant } from '../helpers/db';
import { asAppSuperuser } from '../helpers/rls';

describe('open-play session capacity', () => {
  const prisma = prismaTestClient();
  let t: SeededTenant;
  let sessionId: string;
  let userIds: string[] = [];

  beforeEach(async () => {
    t = await seedTenant();

    await asAppSuperuser(prisma, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: t.tenantId,
          slug: 'v',
          name: 'V',
          addressLine: '1',
          city: 'Sofia',
          email: 'v@playerz.test',
          lat: 42.7,
          lng: 23.3,
        },
      });
      const court = await tx.resource.create({
        data: {
          tenantId: t.tenantId,
          venueId: venue.id,
          name: 'C1',
          sport: 'PADEL',
          surface: 'HARD',
          basePriceCents: 2400,
        },
      });
      const s = await tx.openPlaySession.create({
        data: {
          tenantId: t.tenantId,
          resourceId: court.id,
          hostUserId: t.userId,
          sport: 'PADEL',
          startTs: new Date(Date.now() + 86_400_000),
          endTs: new Date(Date.now() + 90_000_000),
          maxParticipants: 4,
          currentCount: 0,
        },
      });
      sessionId = s.id;

      userIds = [];
      for (let i = 0; i < 8; i++) {
        const u = await tx.user.create({
          data: { email: `p${i}-${Date.now()}@playerz.test` },
        });
        userIds.push(u.id);
      }
    });
  });

  it('EIGHT players racing for FOUR seats: exactly four get in', async () => {
    // THE test. The read-then-write version of joinSession passes every
    // sequential test and then puts seven people on a four-a-side court —
    // all eight read currentCount, all eight pass the capacity check, all
    // eight insert. Two of them drove across Sofia for nothing.
    //
    // Every join is started BEFORE any is awaited, so they genuinely race.
    const attempts = userIds.map((userId) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE app_superuser`);
        return joinSession(tx as unknown as PrismaClient, { sessionId, userId });
      }),
    );

    const results = await Promise.allSettled(attempts);

    const joined = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(joined).toHaveLength(4);
    expect(rejected).toHaveLength(4);

    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(SessionFullError);
    }

    // And the database agrees — currentCount and the participant rows match.
    const final = await asAppSuperuser(prisma, async (tx) => ({
      count: (await tx.openPlaySession.findUniqueOrThrow({ where: { id: sessionId } }))
        .currentCount,
      participants: await tx.sessionParticipant.count({ where: { sessionId } }),
    }));

    expect(final.count).toBe(4);
    expect(final.participants).toBe(4);
  });

  it('a double-tap does not consume two seats', async () => {
    await asAppSuperuser(prisma, (tx) => joinSession(tx, { sessionId, userId: userIds[0]! }));

    await expect(
      asAppSuperuser(prisma, (tx) => joinSession(tx, { sessionId, userId: userIds[0]! })),
    ).rejects.toBeInstanceOf(AlreadyJoinedError);

    // The seat was GIVEN BACK. Without the rollback, one user
    // double-tapping silently locks a real player out of the game.
    const after = await asAppSuperuser(prisma, (tx) =>
      tx.openPlaySession.findUniqueOrThrow({ where: { id: sessionId } }),
    );
    expect(after.currentCount).toBe(1);
  });

  it('leaving frees a seat, and spamming leave cannot drive the count negative', async () => {
    await asAppSuperuser(prisma, (tx) => joinSession(tx, { sessionId, userId: userIds[0]! }));

    await asAppSuperuser(prisma, (tx) => leaveSession(tx, { sessionId, userId: userIds[0]! }));
    // Already gone — this must be a no-op, not another decrement.
    await asAppSuperuser(prisma, (tx) => leaveSession(tx, { sessionId, userId: userIds[0]! }));
    await asAppSuperuser(prisma, (tx) => leaveSession(tx, { sessionId, userId: userIds[0]! }));

    const after = await asAppSuperuser(prisma, (tx) =>
      tx.openPlaySession.findUniqueOrThrow({ where: { id: sessionId } }),
    );

    // A negative count would let the session over-fill later.
    expect(after.currentCount).toBe(0);
  });
});

describe('session chat', () => {
  const prisma = prismaTestClient();

  it('sanitises a message on the way IN, not on render', async () => {
    const t = await seedTenant();

    const { sessionId, tenantId } = await asAppSuperuser(prisma, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: t.tenantId,
          slug: 'v',
          name: 'V',
          addressLine: '1',
          city: 'Sofia',
          email: 'v@playerz.test',
          lat: 42.7,
          lng: 23.3,
        },
      });
      const court = await tx.resource.create({
        data: {
          tenantId: t.tenantId,
          venueId: venue.id,
          name: 'C',
          sport: 'PADEL',
          surface: 'HARD',
          basePriceCents: 1,
        },
      });
      const s = await tx.openPlaySession.create({
        data: {
          tenantId: t.tenantId,
          resourceId: court.id,
          hostUserId: t.userId,
          sport: 'PADEL',
          startTs: new Date(Date.now() + 86_400_000),
          endTs: new Date(Date.now() + 90_000_000),
        },
      });
      return { sessionId: s.id, tenantId: t.tenantId };
    });

    const msg = await asAppSuperuser(prisma, (tx) =>
      postChatMessage(tx, {
        tenantId,
        sessionId,
        senderUserId: t.userId,
        body: '<script>alert(1)</script>See you at 7!',
      }),
    );

    // Chat is the highest-risk surface in the product: text one user writes
    // and another user's BROWSER renders. Sanitising only at render time
    // means every future renderer must remember — and one that forgets is a
    // stored XSS.
    expect(msg.body).toBe('See you at 7!');
    expect(msg.body).not.toContain('<script>');

    // And it is stored clean, not just returned clean.
    const stored = await asAppSuperuser(prisma, (tx) =>
      tx.sessionChatMessage.findUniqueOrThrow({ where: { id: msg.id } }),
    );
    expect(stored.body).not.toContain('<script>');
  });
});
