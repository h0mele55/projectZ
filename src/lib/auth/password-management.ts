/**
 * Progressive login throttling.
 *
 * A flat "5 attempts then locked for 15 minutes" is worse than it looks in
 * both directions:
 *
 *   - too weak: an attacker with 10,000 stolen email/password pairs only
 *     needs ONE attempt per account, so a per-account counter never trips.
 *   - too harsh: it hands an attacker a free denial-of-service — spray
 *     five wrong passwords at a real customer and they cannot log in to
 *     their booking.
 *
 * So the delay ramps. The first couple of mistakes (the normal case: a typo,
 * an old password) cost nothing. Sustained guessing gets expensive fast, and
 * only a clearly automated volume reaches a hard lockout.
 */

export interface AttemptPolicy {
  /** Attempts strictly above this get `delayMs`. */
  afterFailures: number;
  delayMs: number;
  lockout?: boolean;
}

/**
 * Ordered ascending. `resolveLoginPenalty` picks the LAST rule whose
 * threshold the failure count has passed.
 */
export const LOGIN_PROGRESSIVE_POLICY: readonly AttemptPolicy[] = [
  // 1–2 failures: free. A typo must not be punished.
  { afterFailures: 2, delayMs: 5_000 },
  { afterFailures: 4, delayMs: 30_000 },
  { afterFailures: 9, delayMs: 15 * 60_000, lockout: true },
] as const;

export interface LoginPenalty {
  delayMs: number;
  lockedOut: boolean;
}

export function resolveLoginPenalty(recentFailures: number): LoginPenalty {
  let penalty: LoginPenalty = { delayMs: 0, lockedOut: false };

  for (const rule of LOGIN_PROGRESSIVE_POLICY) {
    if (recentFailures > rule.afterFailures) {
      penalty = { delayMs: rule.delayMs, lockedOut: rule.lockout === true };
    }
  }

  return penalty;
}

export class AccountLockedError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('Too many failed sign-in attempts. Try again later.');
    this.name = 'AccountLockedError';
  }
}

export class PasswordBreachedError extends Error {
  constructor(public readonly breachCount: number) {
    // Deliberately does NOT echo the password or the count to the user —
    // the count is for logs.
    super('This password has appeared in a known data breach. Choose another.');
    this.name = 'PasswordBreachedError';
  }
}
