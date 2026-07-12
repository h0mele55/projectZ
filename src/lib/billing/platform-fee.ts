import type { PlanTier } from '@prisma/client';

/**
 * The platform's cut of a booking.
 *
 * ─── Money is ALWAYS integer cents ───────────────────────────────────
 *
 * `2400 * 0.05` is `120.00000000000001` in IEEE-754. Store that, sum a
 * thousand of them, and the books do not balance — by an amount too small to
 * notice and too persistent to explain.
 *
 * The fee is computed in basis points with a single division and one rounding
 * step at the very end. Never `amount * 0.05`. A `money-integer-discipline`
 * ratchet fails the build on float arithmetic over a `*Cents` value.
 */

/** Basis points: 500 = 5.00%. */
export const PLATFORM_FEE_BPS: Record<PlanTier, number> = {
  FREE: 500, // 5%
  CLUB: 300, // 3%
  PRO: 150, // 1.5%
};

export function platformFeeCents(totalCents: number, tier: PlanTier): number {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error(`platformFeeCents expects a non-negative integer, got ${totalCents}`);
  }

  const bps = PLATFORM_FEE_BPS[tier];

  // `totalCents * bps` is an exact integer product. Only the final division
  // can lose a fraction, and Math.round resolves it once, consistently —
  // rather than truncating in the venue's favour on every single booking.
  return Math.round((totalCents * bps) / 10_000);
}

/**
 * The venue's take.
 *
 * Defined as `total - fee`, NOT as an independent percentage.
 *
 * Computing both sides separately means they can round apart and fail to sum
 * to the amount actually charged — leaving a cent that exists on the
 * customer's card statement and in neither ledger.
 */
export function venuePayoutCents(totalCents: number, tier: PlanTier): number {
  return totalCents - platformFeeCents(totalCents, tier);
}

/**
 * A refund reverses the transfer PROPORTIONALLY.
 *
 * Refund half a booking and the venue gives back half its payout while the
 * platform gives back half its fee.
 *
 * Refunding the customer in full while keeping the fee means the venue funds
 * our commission out of its own pocket, for a booking that never happened.
 */
export function refundSplit(
  totalCents: number,
  refundCents: number,
  tier: PlanTier,
): { feeReversedCents: number; transferReversedCents: number } {
  if (refundCents > totalCents) {
    throw new Error(`Refund ${refundCents} exceeds the total ${totalCents}.`);
  }
  if (totalCents === 0) return { feeReversedCents: 0, transferReversedCents: 0 };

  const fee = platformFeeCents(totalCents, tier);
  const feeReversed = Math.round((fee * refundCents) / totalCents);

  // Derived by subtraction, so the two halves ALWAYS sum to exactly the amount
  // being refunded. No cent can fall between them.
  const transferReversed = refundCents - feeReversed;

  return { feeReversedCents: feeReversed, transferReversedCents: transferReversed };
}
