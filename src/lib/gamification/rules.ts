/**
 * What earns points, and what a level is worth.
 *
 * ─── The only rule that really matters ───────────────────────────────
 *
 * XP is awarded for things the player ACTUALLY DID and CANNOT UNDO CHEAPLY.
 *
 * A gamification system is a bounty on whatever it measures. Award XP for
 * *making* a booking and you have paid people to make bookings — they will book
 * and cancel all day. Award it for a booking that was COMPLETED, and the only
 * way to farm XP is to turn up and play, which is the behaviour we wanted in
 * the first place.
 *
 * So every earning event below is tied to a fact that is expensive to fake:
 * a completed booking, a played match, a review backed by proof of visit.
 */

export type XpEventType =
  | 'BOOKING_COMPLETED'
  | 'MATCH_PLAYED'
  | 'REVIEW_PUBLISHED'
  | 'SESSION_HOSTED'
  | 'STREAK_WEEK'
  | 'PROFILE_COMPLETED'
  | 'FIRST_BOOKING'
  /// Compensating entries. See `clawback`.
  | 'ADJUSTMENT';

export const XP_TABLE: Record<XpEventType, number> = {
  BOOKING_COMPLETED: 50,
  MATCH_PLAYED: 30,
  // Lower than a booking ON PURPOSE. A review is cheap to produce and a
  // valuable thing to have, which is exactly the combination that invites
  // low-effort spam if it pays well. It is also capped at one per booking by
  // the proof-of-visit rule, so this cannot be farmed regardless.
  REVIEW_PUBLISHED: 20,
  SESSION_HOSTED: 40,
  STREAK_WEEK: 100,
  PROFILE_COMPLETED: 25,
  FIRST_BOOKING: 100,
  // Awarded by an admin, or by a clawback. Amount is supplied by the caller.
  ADJUSTMENT: 0,
};

/**
 * Levels.
 *
 * ─── Why the curve is quadratic, not linear ──────────────────────────
 *
 * `xpForLevel(n) = 100 * n²`
 *
 * Linear levelling (every level costs the same) means a player who has played
 * for two years levels up as often as one in their first week. The number stops
 * carrying information: everyone is level 400 eventually, and it says nothing
 * about anyone.
 *
 * A quadratic curve makes early levels quick (the new player sees progress on
 * their first visit, which is the entire point of the first week) and later
 * levels genuinely slow. Level 5 is 1,600 XP — about thirty completed bookings.
 * Level 20 is 36,100 — several hundred. That is a number worth showing.
 */
export function xpForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error(`Level must be a positive integer; got ${level}`);
  }
  return 100 * (level - 1) * (level - 1);
}

/** The level a given XP total buys. Level 1 starts at 0 XP. */
export function levelForXp(totalXp: number): number {
  if (!Number.isInteger(totalXp) || totalXp < 0) {
    throw new Error(`XP must be a non-negative integer; got ${totalXp}`);
  }

  // Invert 100(L-1)² ≤ xp  →  L = floor(sqrt(xp/100)) + 1
  return Math.floor(Math.sqrt(totalXp / 100)) + 1;
}

/** How far through the current level a player is, 0..1 — for a progress bar. */
export function levelProgress(totalXp: number): {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  fraction: number;
} {
  const level = levelForXp(totalXp);
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);

  const span = ceiling - floor;
  const into = totalXp - floor;

  return {
    level,
    xpIntoLevel: into,
    xpForNextLevel: span,
    // span is never 0 for level ≥ 1 (the curve is strictly increasing), but
    // guarding costs nothing and a NaN in a progress bar is a visible bug.
    fraction: span > 0 ? into / span : 0,
  };
}
