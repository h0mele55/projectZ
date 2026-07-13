import type { PrismaClient } from '@prisma/client';

import {
  awardXp,
  clawback,
  evaluateAchievements,
  rebuildFromEvents,
  totalXpFor,
} from '@/app-layer/usecases/gamification';
import { leaderboardKey, playerRank, topPlayers } from '@/lib/gamification/leaderboard';
import { pgErrorCode } from '@/lib/db/pg-errors';
import { closeRedis, redis } from '@/lib/redis';

import { prismaTestClient, seedTenant, type SeededTenant } from '../helpers/db';
import { asAppSuperuser } from '../helpers/rls';

/**
 * The gamification engine, against a real Postgres AND a real Redis.
 *
 * Redis is NOT mocked here. A fake ZSET would prove nothing about ZINCRBY vs
 * ZADD — which is the single most consequential line in leaderboard.ts, and the
 * kind of thing that only a real sorted set can tell you.
 */

let db: PrismaClient;
let tenant: SeededTenant;

beforeAll(() => {
  db = prismaTestClient();
});

beforeEach(async () => {
  tenant = await seedTenant();
  // A leaderboard is a cache. Wiping it between tests is exactly what a Redis
  // eviction does in production, which is the point.
  await redis().flushdb();
});

afterAll(async () => {
  await closeRedis();
});

async function seedUser(): Promise<string> {
  const u = await asAppSuperuser(db, (tx) =>
    tx.user.create({
      data: { email: `p-${Math.random().toString(36).slice(2, 10)}@playerz.test` },
    }),
  );
  return u.id;
}

// ══ Idempotency ══════════════════════════════════════════════════════

describe('an event is paid for exactly ONCE', () => {
  it('a redelivered webhook does not pay twice', async () => {
    // The bug this whole design exists to prevent. Awarding XP is triggered by
    // webhooks and cron jobs, all of which retry. Without the dedupe key, one
    // completed booking pays out once per retry and the leaderboard ranks
    // whoever's events got retried most.
    const key = 'booking_completed:bk_123';

    const first = await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: key,
    });

    const second = await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: key,
    });

    expect(first.awarded).toBe(true);
    expect(first.points).toBe(50);

    // Not an error — a normal, expected outcome.
    expect(second.awarded).toBe(false);
    expect(second.points).toBe(0);

    expect(await totalXpFor(db, tenant.userId)).toBe(50);
    expect(await db.xpEvent.count({ where: { userId: tenant.userId } })).toBe(1);
  });

  it('the LEADERBOARD is not inflated by the duplicate either', async () => {
    // The nastiest version of the bug: the database dedupes correctly but the
    // ZSET is incremented anyway. Postgres would be right and the leaderboard
    // wrong — the worst of both, and nothing would look broken.
    const key = 'booking_completed:bk_456';

    for (let i = 0; i < 5; i++) {
      await awardXp(db, {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        type: 'BOOKING_COMPLETED',
        dedupeKey: key,
      });
    }

    const rank = await playerRank(tenant.userId, 'alltime', { tenantId: tenant.tenantId });

    expect(rank?.score).toBe(50); // NOT 250
    expect(await totalXpFor(db, tenant.userId)).toBe(50);
  });

  it('CONCURRENT deliveries of the same event still pay once', async () => {
    // Two workers pick up the same message. `createMany({skipDuplicates})`
    // resolves this inside the statement (ON CONFLICT DO NOTHING) rather than
    // in a catch block — a unique violation would ABORT the transaction and any
    // recovery read in the catch could not run. (P09, P10, and now here.)
    const key = 'booking_completed:bk_race';

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        awardXp(db, {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          type: 'BOOKING_COMPLETED',
          dedupeKey: key,
        }),
      ),
    );

    expect(results.filter((r) => r.awarded)).toHaveLength(1);
    expect(await totalXpFor(db, tenant.userId)).toBe(50);
  });

  it('DIFFERENT bookings each pay', async () => {
    // The dedupe key must not be so coarse that it blocks legitimate earning.
    for (const id of ['bk_1', 'bk_2', 'bk_3']) {
      await awardXp(db, {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        type: 'BOOKING_COMPLETED',
        dedupeKey: `booking_completed:${id}`,
      });
    }

    expect(await totalXpFor(db, tenant.userId)).toBe(150);
  });

  it('the DATABASE refuses a duplicate key, not just the application', async () => {
    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: 'booking_completed:bk_db',
    });

    const raw = asAppSuperuser(db, (tx) =>
      tx.xpEvent.create({
        data: {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          type: 'BOOKING_COMPLETED',
          points: 50,
          dedupeKey: 'booking_completed:bk_db',
        },
      }),
    );

    await expect(raw.catch((e) => pgErrorCode(e))).resolves.toBe('23505');
  });
});

// ══ The XP log is a ledger ═══════════════════════════════════════════

describe('XP is a ledger, not a counter', () => {
  it('REFUSES an UPDATE to a past award', async () => {
    // "Why am I level 7?" must be answerable by replaying the rows. An editable
    // log cannot answer it, and a clawback becomes a silent subtraction.
    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: 'booking_completed:bk_immutable',
    });

    const attempt = asAppSuperuser(db, (tx) =>
      tx.$executeRawUnsafe(
        `UPDATE xp_event SET points = 999999 WHERE "userId" = $1`,
        tenant.userId,
      ),
    );

    await expect(attempt.catch((e) => pgErrorCode(e))).resolves.toBe('23514');
    expect(await totalXpFor(db, tenant.userId)).toBe(50);
  });

  it('a clawback APPENDS a negative event; the original survives', async () => {
    const key = 'booking_completed:bk_refunded';

    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: key,
    });
    expect(await totalXpFor(db, tenant.userId)).toBe(50);

    const result = await clawback(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      originalDedupeKey: key,
      reason: 'booking refunded',
    });

    expect(result.clawedBack).toBe(true);
    expect(result.points).toBe(-50);
    expect(await totalXpFor(db, tenant.userId)).toBe(0);

    // BOTH facts are on the record: the award and its reversal.
    const events = await db.xpEvent.findMany({
      where: { userId: tenant.userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.points)).toEqual([50, -50]);
  });

  it('a redelivered REFUND webhook does not claw back twice', async () => {
    const key = 'booking_completed:bk_double_refund';

    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: key,
    });

    await clawback(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      originalDedupeKey: key,
      reason: 'refunded',
    });
    const second = await clawback(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      originalDedupeKey: key,
      reason: 'refunded again',
    });

    // Otherwise the player ends on MINUS 50 for one refunded booking.
    expect(second.clawedBack).toBe(false);
    expect(await totalXpFor(db, tenant.userId)).toBe(0);
  });

  it('clawing back an award that never happened is a no-op, not an error', async () => {
    // A booking can be refunded before it was ever completed — no XP was
    // awarded, so there is nothing to reverse.
    const r = await clawback(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      originalDedupeKey: 'booking_completed:never_awarded',
      reason: 'refunded',
    });

    expect(r.clawedBack).toBe(false);
    expect(await totalXpFor(db, tenant.userId)).toBe(0);
  });

  it('a total never goes negative', async () => {
    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'ADJUSTMENT',
      points: -500,
      dedupeKey: 'admin:punish',
    });

    // levelForXp refuses negative input by design, so a negative total would be
    // a crash on the profile page rather than a small number.
    expect(await totalXpFor(db, tenant.userId)).toBe(0);
  });
});

// ══ The leaderboard ══════════════════════════════════════════════════

describe('the leaderboard', () => {
  it('ACCUMULATES points rather than replacing them', async () => {
    // ZINCRBY vs ZADD. ZADD would SET the score to the value of the most recent
    // event — a player's rank would reflect their last booking, not their year.
    // No mock of Redis would have caught this.
    for (const id of ['bk_a', 'bk_b', 'bk_c']) {
      await awardXp(db, {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        type: 'BOOKING_COMPLETED',
        dedupeKey: `booking_completed:${id}`,
      });
    }

    const rank = await playerRank(tenant.userId, 'alltime', { tenantId: tenant.tenantId });
    expect(rank?.score).toBe(150); // not 50
  });

  it('ranks players against each other', async () => {
    const rival = await seedUser();

    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: rival,
      type: 'BOOKING_COMPLETED',
      dedupeKey: 'booking_completed:r1',
    });

    for (const id of ['m1', 'm2', 'm3']) {
      await awardXp(db, {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        type: 'BOOKING_COMPLETED',
        dedupeKey: `booking_completed:${id}`,
      });
    }

    const top = await topPlayers('alltime', { tenantId: tenant.tenantId }, { limit: 10 });

    expect(top[0]!.userId).toBe(tenant.userId);
    expect(top[0]!.rank).toBe(1);
    expect(top[1]!.userId).toBe(rival);
    expect(top[1]!.rank).toBe(2);

    const mine = await playerRank(tenant.userId, 'alltime', { tenantId: tenant.tenantId });
    expect(mine?.rank).toBe(1);
  });

  it('a player who is not on the board returns null, NOT rank 0', async () => {
    // Rank 0 would render as "ranked last" for someone who has simply never
    // played — which is a different and much more discouraging statement.
    const stranger = await seedUser();

    expect(await playerRank(stranger, 'alltime', { tenantId: tenant.tenantId })).toBeNull();
  });

  it('a tenant board does not leak into the global one', async () => {
    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: 'booking_completed:scoped',
    });

    const tenantKey = leaderboardKey('alltime', { tenantId: tenant.tenantId });
    const globalKey = leaderboardKey('alltime', {});

    expect(tenantKey).not.toBe(globalKey);

    // The player appears on BOTH — a club board and the national one — but they
    // are separate keys with separate scores.
    expect(await redis().zscore(tenantKey, tenant.userId)).toBe('50');
    expect(await redis().zscore(globalKey, tenant.userId)).toBe('50');
  });

  it('is REBUILDABLE from Postgres after Redis is wiped', async () => {
    // The property that makes Redis disposable. An eviction, a flush, a fresh
    // instance — all of it costs one rebuild rather than a season's standings.
    for (const id of ['bk_x', 'bk_y']) {
      await awardXp(db, {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        type: 'BOOKING_COMPLETED',
        dedupeKey: `booking_completed:${id}`,
      });
    }
    expect((await playerRank(tenant.userId, 'alltime', { tenantId: tenant.tenantId }))?.score).toBe(
      100,
    );

    // Redis falls over.
    await redis().flushdb();
    expect(await playerRank(tenant.userId, 'alltime', { tenantId: tenant.tenantId })).toBeNull();

    // Rebuild from the event log.
    const restored = await rebuildFromEvents(db, 'alltime', { tenantId: tenant.tenantId });

    expect(restored).toBe(1);
    expect((await playerRank(tenant.userId, 'alltime', { tenantId: tenant.tenantId }))?.score).toBe(
      100,
    );
  });

  it('a rebuild REPLACES rather than adding — running it twice is safe', async () => {
    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: 'booking_completed:rb',
    });

    await rebuildFromEvents(db, 'alltime', { tenantId: tenant.tenantId });
    await rebuildFromEvents(db, 'alltime', { tenantId: tenant.tenantId });

    // Without the DEL, every rebuild would double everyone's score.
    expect((await playerRank(tenant.userId, 'alltime', { tenantId: tenant.tenantId }))?.score).toBe(
      50,
    );
  });

  it('a player whose net XP is zero does not appear on the board', async () => {
    // A ZSET happily stores a score of 0 or below, so a refunded player would
    // otherwise sit at the bottom of the board as a permanent monument to it.
    const key = 'booking_completed:bk_zeroed';

    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: key,
    });
    await clawback(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      originalDedupeKey: key,
      reason: 'refunded',
    });

    const count = await rebuildFromEvents(db, 'alltime', { tenantId: tenant.tenantId });

    expect(count).toBe(0);
    expect(await playerRank(tenant.userId, 'alltime', { tenantId: tenant.tenantId })).toBeNull();
  });

  it('a Redis OUTAGE does not stop a player earning XP', async () => {
    // The XP is in Postgres; the board can be rebuilt. Failing the write
    // because the CACHE is down would mean a Redis outage stops the entire
    // earning system.
    await redis().quit();

    const r = await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: 'booking_completed:during_outage',
    });

    expect(r.awarded).toBe(true);
    expect(await totalXpFor(db, tenant.userId)).toBe(50);

    await closeRedis();
  });
});

// ══ Achievements ═════════════════════════════════════════════════════

describe('achievements', () => {
  async function seedAchievements() {
    await asAppSuperuser(db, (tx) =>
      tx.achievement.createMany({
        data: [
          {
            code: 'first_steps',
            name: 'First Steps',
            description: 'Complete your first booking.',
            xpReward: 25,
            ruleJson: { type: 'COUNT', event: 'BOOKING_COMPLETED', threshold: 1 },
          },
          {
            code: 'regular',
            name: 'Regular',
            description: 'Complete three bookings.',
            xpReward: 50,
            ruleJson: { type: 'COUNT', event: 'BOOKING_COMPLETED', threshold: 3 },
          },
          {
            code: 'broken_rule',
            name: 'Broken',
            description: 'Has a typo in its rule.',
            xpReward: 1000,
            ruleJson: { type: 'NOT_A_REAL_RULE', threshold: 1 },
          },
        ],
        skipDuplicates: true,
      }),
    );
  }

  it('unlocks when the threshold is met, and pays its reward', async () => {
    await seedAchievements();

    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: 'booking_completed:a1',
    });

    const unlocked = await evaluateAchievements(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
    });

    expect(unlocked).toContain('first_steps');
    expect(unlocked).not.toContain('regular'); // needs 3

    // 50 (booking) + 25 (badge reward)
    expect(await totalXpFor(db, tenant.userId)).toBe(75);
  });

  it('does NOT re-grant a badge — or its XP — on every subsequent evaluation', async () => {
    // The infinite tap. Without the unique constraint and the locked-only
    // filter, "complete a booking" would pay its 25 XP bonus again on every
    // booking thereafter, forever.
    await seedAchievements();

    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: 'booking_completed:b1',
    });

    await evaluateAchievements(db, { tenantId: tenant.tenantId, userId: tenant.userId });
    const again = await evaluateAchievements(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
    });
    await evaluateAchievements(db, { tenantId: tenant.tenantId, userId: tenant.userId });

    expect(again).toEqual([]);
    expect(await totalXpFor(db, tenant.userId)).toBe(75); // not 100, 125, …
    expect(await db.userAchievement.count({ where: { userId: tenant.userId } })).toBe(1);
  });

  it('a badge with an UNKNOWN rule stays locked rather than unlocking for everyone', async () => {
    // A typo in a badge's ruleJson must fail CLOSED. Failing open would hand a
    // 1000 XP badge to every player on the platform.
    await seedAchievements();

    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: 'booking_completed:c1',
    });

    const unlocked = await evaluateAchievements(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
    });

    expect(unlocked).not.toContain('broken_rule');
  });

  it('CONCURRENT evaluations grant the badge exactly once', async () => {
    await seedAchievements();

    await awardXp(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      type: 'BOOKING_COMPLETED',
      dedupeKey: 'booking_completed:d1',
    });

    await Promise.all(
      Array.from({ length: 5 }, () =>
        evaluateAchievements(db, { tenantId: tenant.tenantId, userId: tenant.userId }),
      ),
    );

    expect(await db.userAchievement.count({ where: { userId: tenant.userId } })).toBe(1);
    expect(await totalXpFor(db, tenant.userId)).toBe(75);
  });
});
