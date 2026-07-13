import { redis } from '@/lib/redis';

/**
 * Leaderboards, on Redis sorted sets.
 *
 * ─── Redis is a CACHE. Postgres is the truth. ────────────────────────
 *
 * Every rank here is DERIVED from the `xp_event` table and can be rebuilt from
 * it at any time (`rebuildLeaderboard`). Nothing is stored only in Redis.
 *
 * That is not architectural fastidiousness — it is the difference between a
 * Redis eviction being a non-event and being a catastrophe. Redis is configured
 * with a memory limit; under pressure it evicts keys. If the leaderboard were
 * the source of truth, an eviction would silently delete a season's standings
 * and there would be no way to get them back. Because it is a cache, an
 * eviction costs one rebuild.
 *
 * The same reasoning means a Redis OUTAGE must not fail a write. `awardXp`
 * records to Postgres and then updates Redis best-effort — a leaderboard that
 * is briefly stale is a far smaller problem than XP that was never recorded.
 *
 * ─── Why ZSET and not a Postgres ORDER BY ────────────────────────────
 *
 * `ZREVRANK` is O(log N) for "what rank am I?" — the query every player makes
 * about themselves. In Postgres that is a window function over the whole table:
 * fine at a thousand players, a sequential scan and a sort at a hundred
 * thousand, on a query that runs on every profile view.
 */

export type LeaderboardPeriod = 'weekly' | 'monthly' | 'alltime';

/**
 * Period keys are computed in EUROPE/SOFIA, not UTC.
 *
 * The product is Bulgarian. A week that rolls over at 02:00 or 03:00 local
 * (depending on daylight saving) is a week that ends in the middle of Saturday
 * night — precisely when people are out playing. Players would see their score
 * reset mid-evening, which reads as a bug because it is one.
 */
export const LEADERBOARD_TZ = 'Europe/Sofia';

/** The civil date in Sofia, as {year, month, day} — not the UTC date. */
function sofiaParts(at: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: LEADERBOARD_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const [year, month, day] = fmt.format(at).split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

/**
 * ISO week number, computed on the Sofia civil date.
 *
 * ISO weeks start on MONDAY and belong to the year containing their Thursday —
 * which is why 1 January is sometimes in week 52 of the previous year. Getting
 * this wrong makes the first week of January merge into the last week of
 * December, and two separate weeks' scores land in one bucket.
 */
export function isoWeekKey(at: Date): string {
  const { year, month, day } = sofiaParts(at);

  // Work in UTC on the SOFIA civil date, so no further timezone maths applies.
  const d = new Date(Date.UTC(year, month - 1, day));

  // Shift to the Thursday of this ISO week: that is the day whose year names
  // the week.
  const dayNum = d.getUTCDay() || 7; // Sunday is 7, not 0
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);

  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export function monthKey(at: Date): string {
  const { year, month } = sofiaParts(at);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The Redis key. The ONLY place leaderboard key names are constructed.
 *
 * A key built ad-hoc at a call site is a key that will one day be built
 * slightly differently, and the two will silently be different leaderboards.
 * (Same reasoning as `realtime/channels.ts`.)
 */
export function leaderboardKey(
  period: LeaderboardPeriod,
  scope: { tenantId?: string | null } = {},
  at: Date = new Date(),
): string {
  // A tenant leaderboard ("best players at OUR club") and the global one are
  // different boards. Mixing them would rank a club's members against the whole
  // country on their own club's page.
  const scopePart = scope.tenantId ? `t:${scope.tenantId}` : 'global';

  switch (period) {
    case 'weekly':
      return `lb:${scopePart}:w:${isoWeekKey(at)}`;
    case 'monthly':
      return `lb:${scopePart}:m:${monthKey(at)}`;
    case 'alltime':
      return `lb:${scopePart}:all`;
  }
}

/** Weekly and monthly boards expire; all-time does not. */
function ttlSeconds(period: LeaderboardPeriod): number | null {
  switch (period) {
    // Kept well past the end of the period so "last week's winners" still
    // renders, then reclaimed on its own. Without a TTL, every week ever played
    // stays in memory forever and Redis eventually starts evicting the boards
    // people are actually looking at.
    case 'weekly':
      return 60 * 60 * 24 * 21; // 3 weeks
    case 'monthly':
      return 60 * 60 * 24 * 100;
    case 'alltime':
      return null;
  }
}

const ALL_PERIODS: LeaderboardPeriod[] = ['weekly', 'monthly', 'alltime'];

/**
 * Add points to every board a player appears on.
 *
 * BEST EFFORT. A Redis failure is swallowed: the XP is already in Postgres, and
 * the board can be rebuilt. Failing the write because the leaderboard cache is
 * down would mean a Redis outage stops people from earning XP at all.
 */
export async function addPoints(input: {
  userId: string;
  tenantId?: string | null;
  points: number;
  at?: Date;
}): Promise<void> {
  const at = input.at ?? new Date();

  try {
    const pipeline = redis().pipeline();

    for (const period of ALL_PERIODS) {
      for (const scope of [{}, { tenantId: input.tenantId }]) {
        // Skip the tenant board when the event has no tenant.
        if ('tenantId' in scope && !scope.tenantId) continue;

        const key = leaderboardKey(period, scope, at);

        // ZINCRBY, not ZADD. ZADD would SET the score to `points`, wiping
        // everything the player had earned before and replacing it with the
        // value of their most recent booking.
        pipeline.zincrby(key, input.points, input.userId);

        const ttl = ttlSeconds(period);
        if (ttl) pipeline.expire(key, ttl);
      }
    }

    await pipeline.exec();
  } catch {
    // Swallowed deliberately. See the header note.
  }
}

export interface LeaderboardEntry {
  userId: string;
  score: number;
  rank: number;
}

export async function topPlayers(
  period: LeaderboardPeriod,
  scope: { tenantId?: string | null } = {},
  opts: { limit?: number; at?: Date } = {},
): Promise<LeaderboardEntry[]> {
  // Bounded. An unbounded ZREVRANGE on a national leaderboard would serialise
  // every player in the country into one JSON response.
  const limit = Math.min(opts.limit ?? 20, 100);
  const key = leaderboardKey(period, scope, opts.at);

  const raw = await redis().zrevrange(key, 0, limit - 1, 'WITHSCORES');

  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({
      userId: raw[i]!,
      score: Number(raw[i + 1]),
      rank: i / 2 + 1,
    });
  }

  return entries;
}

/**
 * One player's rank. O(log N) — this runs on every profile view.
 *
 * Returns null when the player is not on the board at all, which is NOT the
 * same as rank 0 and must not render as "ranked last".
 */
export async function playerRank(
  userId: string,
  period: LeaderboardPeriod,
  scope: { tenantId?: string | null } = {},
  at?: Date,
): Promise<{ rank: number; score: number } | null> {
  const key = leaderboardKey(period, scope, at);

  const [rank, score] = await Promise.all([
    redis().zrevrank(key, userId),
    redis().zscore(key, userId),
  ]);

  if (rank === null || score === null) return null;

  // Redis ranks are 0-based; humans are not.
  return { rank: rank + 1, score: Number(score) };
}

/**
 * Rebuild a board from Postgres.
 *
 * This is what makes Redis disposable. An eviction, a flush, a new Redis
 * instance — all of it costs one call to this, rather than a season's standings.
 *
 * Deliberately takes the rows rather than querying: the caller owns the tenant
 * scoping and the date window, and this function stays a pure Redis operation
 * that can be tested without a database.
 */
export async function rebuildLeaderboard(
  period: LeaderboardPeriod,
  scope: { tenantId?: string | null },
  totals: Array<{ userId: string; points: number }>,
  at: Date = new Date(),
): Promise<void> {
  const key = leaderboardKey(period, scope, at);

  const pipeline = redis().pipeline();

  // DEL first. Without it, a rebuild ADDS to whatever stale scores are already
  // there and every rebuild doubles everyone's points.
  pipeline.del(key);

  if (totals.length > 0) {
    const args: (string | number)[] = [];
    for (const t of totals) args.push(t.points, t.userId);
    pipeline.zadd(key, ...args);
  }

  const ttl = ttlSeconds(period);
  if (ttl) pipeline.expire(key, ttl);

  await pipeline.exec();
}
