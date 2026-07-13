import { XP_TABLE, levelForXp, levelProgress, xpForLevel } from '@/lib/gamification/rules';
import { isoWeekKey, leaderboardKey, monthKey } from '@/lib/gamification/leaderboard';

describe('the level curve', () => {
  it('level 1 starts at zero — a new player is not in debt', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelForXp(0)).toBe(1);
  });

  it('early levels come quickly, later ones do not', () => {
    // The whole reason the curve is quadratic. A new player must see progress
    // on their FIRST visit; a two-year veteran must not level up as often as
    // they do, or the number stops carrying information.
    const firstBooking = 50 + 100; // BOOKING_COMPLETED + FIRST_BOOKING
    expect(levelForXp(firstBooking)).toBeGreaterThan(1);

    // Level 20 is a serious commitment — ~800 completed bookings' worth.
    expect(xpForLevel(20)).toBe(36_100);
  });

  it('levelForXp inverts xpForLevel exactly, at every boundary', () => {
    for (let level = 1; level <= 50; level++) {
      const floor = xpForLevel(level);

      // Exactly on the boundary → that level.
      expect(levelForXp(floor)).toBe(level);
      // One XP short → the previous level. This is the off-by-one that would
      // otherwise let a player flicker between two levels on the profile page.
      if (floor > 0) expect(levelForXp(floor - 1)).toBe(level - 1);
    }
  });

  it('is monotonic — more XP never means a lower level', () => {
    let previous = 0;
    for (let xp = 0; xp < 50_000; xp += 137) {
      const level = levelForXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('rejects nonsense rather than inventing an answer', () => {
    expect(() => levelForXp(-1)).toThrow(/non-negative/);
    expect(() => levelForXp(1.5)).toThrow(/non-negative integer/);
    expect(() => xpForLevel(0)).toThrow(/positive integer/);
  });
});

describe('levelProgress', () => {
  it('reports a fraction between 0 and 1, never NaN', () => {
    for (const xp of [0, 1, 99, 100, 2_500, 40_000]) {
      const p = levelProgress(xp);

      expect(Number.isNaN(p.fraction)).toBe(false);
      expect(p.fraction).toBeGreaterThanOrEqual(0);
      expect(p.fraction).toBeLessThan(1);
      expect(p.xpForNextLevel).toBeGreaterThan(0);
    }
  });

  it('is at 0 exactly on a level boundary', () => {
    expect(levelProgress(xpForLevel(5)).fraction).toBe(0);
    expect(levelProgress(xpForLevel(5)).level).toBe(5);
  });
});

describe('the XP table', () => {
  it('pays for things that are EXPENSIVE to fake', () => {
    // A gamification system is a bounty on whatever it measures. Nothing here
    // pays for an action a player can perform and undo for free — there is no
    // BOOKING_CREATED, only BOOKING_COMPLETED.
    expect(XP_TABLE).not.toHaveProperty('BOOKING_CREATED');
    expect(XP_TABLE.BOOKING_COMPLETED).toBeGreaterThan(0);
  });

  it('pays LESS for a review than for turning up', () => {
    // A review is cheap to produce. If it paid better than playing, we would
    // have bought ourselves a review farm.
    expect(XP_TABLE.REVIEW_PUBLISHED).toBeLessThan(XP_TABLE.BOOKING_COMPLETED);
  });
});

describe('leaderboard period keys', () => {
  it('bucket by the SOFIA civil date, not UTC', () => {
    // 22:30 UTC on 6 July is already 7 July in Sofia (UTC+3 in summer). A key
    // computed in UTC puts this in the wrong day — and near a month boundary,
    // the wrong MONTH, silently splitting one month's scores across two boards.
    const lateUtc = new Date('2026-07-31T22:30:00Z'); // → 1 Aug in Sofia

    expect(monthKey(lateUtc)).toBe('2026-08');
  });

  it('ISO weeks start on Monday and belong to the year of their Thursday', () => {
    // 1 Jan 2027 is a Friday → ISO week 53 of 2026, not week 1 of 2027.
    // Getting this wrong merges the first week of January into the last week of
    // December and lands two weeks' scores in one bucket.
    expect(isoWeekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');

    // 4 Jan 2027 is the Monday of week 1.
    expect(isoWeekKey(new Date('2027-01-04T12:00:00Z'))).toBe('2027-W01');
  });

  it('a week is stable across all seven of its days', () => {
    const monday = new Date('2026-07-13T09:00:00Z');
    const sunday = new Date('2026-07-19T09:00:00Z');

    expect(isoWeekKey(monday)).toBe(isoWeekKey(sunday));
  });

  it('a tenant board and the global board are DIFFERENT boards', () => {
    // Mixing them would rank a club's members against the whole country on
    // their own club's page.
    const global = leaderboardKey('weekly', {});
    const tenant = leaderboardKey('weekly', { tenantId: 'ten_1' });

    expect(global).not.toBe(tenant);
    expect(tenant).toContain('ten_1');
  });

  it('all-time has no date in the key', () => {
    const a = leaderboardKey('alltime', {}, new Date('2026-01-01T00:00:00Z'));
    const b = leaderboardKey('alltime', {}, new Date('2027-06-01T00:00:00Z'));

    expect(a).toBe(b);
  });
});
