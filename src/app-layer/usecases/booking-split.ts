/**
 * Cost splitting.
 *
 * ─── The invariant that must never break ─────────────────────────────
 *
 *     sum(shareCents) === booking.totalCents
 *
 * Not "approximately". Not "within a cent". If the shares do not sum to the
 * total, somebody is charged for a booking nobody paid for, or the venue is
 * paid less than it billed — and the discrepancy compounds silently across
 * every split until an accountant finds it months later.
 *
 * It is enforced in THREE places, deliberately:
 *   1. `partitionEqually` constructs shares that sum correctly by design;
 *   2. `assertSharesSumToTotal` validates any caller-supplied custom split;
 *   3. a DB CHECK rejects a non-positive share outright.
 */

export class ShareSumMismatchError extends Error {
  readonly code = 'share_sum_mismatch';
  constructor(sum: number, total: number) {
    super(
      `Shares sum to ${sum} but the booking total is ${total}. ` +
        `A split that does not sum exactly means someone is charged for nothing, ` +
        `or the venue is paid less than it billed.`,
    );
    this.name = 'ShareSumMismatchError';
  }
}

/**
 * Split a total N ways, exactly.
 *
 * 5000¢ across 3 is 1666.67 each. Rounding each share independently gives
 * 1667 × 3 = 5001 — a cent conjured from nowhere, on every three-way split,
 * forever.
 *
 * So: floor everyone, then hand the remainder out one cent at a time. The
 * shares differ by at most a cent and sum to EXACTLY the total.
 */
export function partitionEqually(totalCents: number, ways: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error(`partitionEqually expects a non-negative integer total, got ${totalCents}`);
  }
  if (!Number.isInteger(ways) || ways < 1) {
    throw new Error(`Cannot split into ${ways} ways.`);
  }

  const base = Math.floor(totalCents / ways);
  const remainder = totalCents - base * ways;

  // The first `remainder` people pay one cent more. Someone has to.
  return Array.from({ length: ways }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function assertSharesSumToTotal(shares: readonly number[], totalCents: number): void {
  for (const s of shares) {
    if (!Number.isInteger(s) || s <= 0) {
      throw new Error(`Every share must be a positive integer number of cents; got ${s}.`);
    }
  }

  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum !== totalCents) throw new ShareSumMismatchError(sum, totalCents);
}
