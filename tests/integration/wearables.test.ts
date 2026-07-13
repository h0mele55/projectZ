import type { PrismaClient } from '@prisma/client';

import {
  awardActivityXp,
  connectStrava,
  handleDeauthorization,
  importActivity,
  listMyActivities,
  syncStrava,
  validAccessToken,
} from '@/app-layer/usecases/wearables';
import { totalXpFor } from '@/app-layer/usecases/gamification';
import { StravaTosViolationError } from '@/lib/wearables/strava-tos';
import { closeRedis, redis } from '@/lib/redis';

import { prismaTestClient, seedTenant, type SeededTenant } from '../helpers/db';
import { findRequest, setStravaActivities, useMswServer } from '../helpers/msw';
import { asAppSuperuser, asAppUserAs } from '../helpers/rls';

/**
 * Wearables — and above all, the Strava boundary.
 *
 * Strava is MSW-mocked (real credentials come after the roadmap). So these tests
 * prove our side of the conversation and, far more importantly, they prove the
 * ENFORCEMENT: that the database itself will not hand one athlete's Strava data
 * to another, whatever the application code does.
 */

let db: PrismaClient;
let tenant: SeededTenant;
let athlete: string;
let otherUser: string;

useMswServer();

beforeAll(() => {
  db = prismaTestClient();
});

beforeEach(async () => {
  tenant = await seedTenant();
  athlete = tenant.userId;

  const other = await asAppSuperuser(db, (tx) =>
    tx.user.create({
      data: { email: `other-${Math.random().toString(36).slice(2, 8)}@playerz.test` },
    }),
  );
  otherUser = other.id;

  await redis().flushdb();
});

afterAll(async () => {
  await closeRedis();
});

const RUN = {
  id: 12345,
  type: 'Run',
  start_date: '2026-07-01T06:30:00Z',
  elapsed_time: 1800,
  distance: 5000,
  total_elevation_gain: 40,
  average_heartrate: 150,
};

async function connect() {
  return connectStrava(db, {
    userId: athlete,
    accessToken: 'access_1',
    refreshToken: 'refresh_1',
    expiresAt: new Date(Date.now() + 3_600_000),
    athleteId: 'strava_athlete_9',
    scopes: ['activity:read'],
  });
}

// ══ THE BOUNDARY ═════════════════════════════════════════════════════

describe('the DATABASE refuses to show one athlete another athlete’s Strava data', () => {
  beforeEach(async () => {
    await connect();
    await importActivity(db, { userId: athlete, tenantId: tenant.tenantId, activity: RUN });
  });

  it('the OWNER can see their own Strava activity', async () => {
    const rows = await asAppUserAs(db, tenant.tenantId, athlete, (tx) =>
      tx.activity.findMany({ where: { userId: athlete } }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('STRAVA');
  });

  it('ANOTHER USER querying the same rows gets ZERO — not an error, not a ride', async () => {
    // THE test. The application code here is deliberately naive: it asks for
    // the athlete's activities with no ToS check at all — exactly the query a
    // careless leaderboard would make.
    //
    // Postgres refuses. The result is an empty list, so the feature looks
    // broken rather than working while quietly breaching a contract that would
    // cost every connected athlete their integration.
    const rows = await asAppUserAs(db, tenant.tenantId, otherUser, (tx) =>
      tx.activity.findMany({ where: { userId: athlete } }),
    );

    expect(rows).toEqual([]);
  });

  it('a session with NO app.user_id sees no Strava rows at all — fail-closed', async () => {
    // The 2-arg current_setting returns NULL when unset, and `userId = NULL` is
    // NULL rather than TRUE. A code path that forgets to bind the user does not
    // get everything; it gets nothing.
    const rows = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenant.tenantId);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
      return tx.activity.findMany({ where: { userId: athlete } });
    });

    expect(rows).toEqual([]);
  });

  it('a MANUAL activity IS visible to others — the restriction is Strava’s, not ours', async () => {
    // The boundary must not be so blunt that it hides data the athlete gave us
    // directly. A manually logged run is ours to display.
    await asAppSuperuser(db, (tx) =>
      tx.activity.create({
        data: {
          userId: athlete,
          tenantId: tenant.tenantId,
          source: 'MANUAL',
          sport: 'RUNNING',
          startedAt: new Date(),
          durationS: 1800,
          distanceM: 5000,
        },
      }),
    );

    const rows = await asAppUserAs(db, tenant.tenantId, otherUser, (tx) =>
      tx.activity.findMany({ where: { userId: athlete } }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('MANUAL');
  });

  it('the application layer ALSO refuses, with a comprehensible error', async () => {
    // The RLS policy makes a leak impossible. This second layer makes the
    // failure LEGIBLE — a developer gets an error naming the agreement, rather
    // than a mysteriously empty list.
    const rows = await asAppSuperuser(db, (tx) =>
      tx.activity.findMany({ where: { userId: athlete } }),
    );
    expect(rows).toHaveLength(1);

    await expect(
      listMyActivities(db, { userId: athlete, viewerUserId: otherUser }),
    ).rejects.toThrow(StravaTosViolationError);
  });
});

// ══ No XP, no leaderboard ════════════════════════════════════════════

describe('Strava data earns nothing, because XP is a cross-user display', () => {
  it('a STRAVA activity awards NO XP', async () => {
    // XP feeds a leaderboard and unlocks badges shown on a public profile —
    // both exactly what Strava forbids. This is a real product cost and the only
    // lawful answer.
    await connect();
    const { activityId } = await importActivity(db, {
      userId: athlete,
      tenantId: tenant.tenantId,
      activity: RUN,
    });

    const r = await awardActivityXp(db, {
      tenantId: tenant.tenantId,
      userId: athlete,
      activityId: activityId!,
      source: 'STRAVA',
    });

    expect(r.awarded).toBe(false);
    expect(await totalXpFor(db, athlete)).toBe(0);
  });

  it('a MANUAL activity DOES award XP', async () => {
    const manual = await asAppSuperuser(db, (tx) =>
      tx.activity.create({
        data: {
          userId: athlete,
          tenantId: tenant.tenantId,
          source: 'MANUAL',
          sport: 'RUNNING',
          startedAt: new Date(),
          durationS: 1800,
          distanceM: 5000,
        },
      }),
    );

    const r = await awardActivityXp(db, {
      tenantId: tenant.tenantId,
      userId: athlete,
      activityId: manual.id,
      source: 'MANUAL',
    });

    expect(r.awarded).toBe(true);
    expect(await totalXpFor(db, athlete)).toBeGreaterThan(0);
  });
});

// ══ Deauthorisation ══════════════════════════════════════════════════

describe('revoking actually deletes', () => {
  it('deletes the Strava data, keeps the MANUAL data, and destroys the tokens', async () => {
    await connect();
    await importActivity(db, { userId: athlete, tenantId: tenant.tenantId, activity: RUN });

    await asAppSuperuser(db, (tx) =>
      tx.activity.create({
        data: {
          userId: athlete,
          source: 'MANUAL',
          sport: 'RUNNING',
          startedAt: new Date(),
          durationS: 600,
        },
      }),
    );

    const result = await handleDeauthorization(db, { athleteId: 'strava_athlete_9' });

    expect(result.deletedActivities).toBe(1);

    const remaining = await asAppSuperuser(db, (tx) =>
      tx.activity.findMany({ where: { userId: athlete } }),
    );

    // The Strava row is GONE — not hidden behind a flag we might forget.
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.source).toBe('MANUAL');

    // A revoked connection holding a live token is a loaded gun in the database.
    const conn = await asAppSuperuser(db, (tx) =>
      tx.wearableConnection.findFirstOrThrow({ where: { userId: athlete } }),
    );
    expect(conn.revokedAt).not.toBeNull();
    expect(conn.accessTokenEnc).toBe('');
    expect(conn.refreshTokenEnc).toBe('');
  });

  it('deauthorising an athlete we do not know is a no-op, not a crash', async () => {
    const r = await handleDeauthorization(db, { athleteId: 'never_heard_of_them' });
    expect(r.deletedActivities).toBe(0);
  });

  it('a revoked connection cannot be used to sync', async () => {
    await connect();
    await handleDeauthorization(db, { athleteId: 'strava_athlete_9' });

    await expect(validAccessToken(db, athlete)).rejects.toThrow(/not connected/);
  });
});

// ══ Import ═══════════════════════════════════════════════════════════

describe('importing', () => {
  it('is idempotent — a redelivered webhook does not double the distance', async () => {
    await connect();

    const first = await importActivity(db, {
      userId: athlete,
      tenantId: tenant.tenantId,
      activity: RUN,
    });
    const second = await importActivity(db, {
      userId: athlete,
      tenantId: tenant.tenantId,
      activity: RUN,
    });

    expect(first.imported).toBe(true);
    expect(second.imported).toBe(false);

    const rows = await asAppSuperuser(db, (tx) =>
      tx.activity.findMany({ where: { userId: athlete } }),
    );
    expect(rows).toHaveLength(1);
  });

  it('does NOT import an activity type we cannot represent', async () => {
    // Coercing an AlpineSki into RUNNING would put a 40km descent into the
    // athlete's running totals with no way for them to tell where it came from.
    await connect();

    const r = await importActivity(db, {
      userId: athlete,
      tenantId: tenant.tenantId,
      activity: { ...RUN, id: 999, type: 'AlpineSki' },
    });

    expect(r.imported).toBe(false);
  });

  it('the DATABASE refuses a zero-duration activity', async () => {
    const attempt = asAppSuperuser(db, (tx) =>
      tx.activity.create({
        data: {
          userId: athlete,
          source: 'MANUAL',
          sport: 'RUNNING',
          startedAt: new Date(),
          durationS: 0,
        },
      }),
    );

    await expect(attempt).rejects.toThrow();
  });

  it('syncs a batch from Strava', async () => {
    await connect();
    setStravaActivities([RUN, { ...RUN, id: 777, distance: 10_000 }]);

    const r = await syncStrava(db, { userId: athlete, tenantId: tenant.tenantId });

    expect(r.imported).toBe(2);
    expect(findRequest('athlete/activities')).toBeDefined();
  });
});

// ══ Tokens ═══════════════════════════════════════════════════════════

describe('tokens', () => {
  it('are ENCRYPTED at rest — a leaked backup is not a stalking kit', async () => {
    await connect();

    const conn = await asAppSuperuser(db, (tx) =>
      tx.wearableConnection.findFirstOrThrow({ where: { userId: athlete } }),
    );

    expect(conn.accessTokenEnc).not.toBe('access_1');
    expect(conn.accessTokenEnc).not.toContain('access_1');
    expect(conn.refreshTokenEnc).not.toContain('refresh_1');
  });

  it('a refresh stores the NEW refresh token — Strava rotates them', async () => {
    // Strava rotates the refresh token on every refresh. Keeping the old one
    // means the SECOND refresh fails, and the athlete silently stops syncing
    // until they reconnect by hand — a bug that only appears hours later.
    await connectStrava(db, {
      userId: athlete,
      accessToken: 'expired_access',
      refreshToken: 'original_refresh',
      expiresAt: new Date(Date.now() - 1000), // already expired
      athleteId: 'strava_athlete_9',
      scopes: ['activity:read'],
    });

    const token = await validAccessToken(db, athlete);
    expect(token).toBe('strava_access_refreshed');

    const conn = await asAppSuperuser(db, (tx) =>
      tx.wearableConnection.findFirstOrThrow({ where: { userId: athlete } }),
    );

    // The stored refresh token must be the NEW one, not 'original_refresh'.
    const { decryptField } = await import('@/lib/security/encryption');
    expect(decryptField(conn.refreshTokenEnc)).toMatch(/^strava_refresh_/);
  });

  it('a still-valid token is NOT refreshed', async () => {
    await connect(); // expires in an hour

    const token = await validAccessToken(db, athlete);

    expect(token).toBe('access_1');
    // No call to Strava at all.
    expect(findRequest('oauth/token')).toBeUndefined();
  });
});
