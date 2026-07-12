/**
 * Cancellation refund policy.
 *
 * The policy is stored per-venue (`Venue.cancellationPolicyJson`) because
 * clubs genuinely differ, and it is resolved AT THE MOMENT OF CANCELLATION
 * and written onto the Cancellation row. The policy may change next month;
 * a receipt must not.
 */

export interface CancellationPolicy {
  fullRefundBeforeHours: number;
  halfRefundBeforeHours: number;
}

export const DEFAULT_POLICY: CancellationPolicy = {
  fullRefundBeforeHours: 24,
  halfRefundBeforeHours: 12,
};

export interface RefundQuote {
  refundPercent: number;
  refundAmountCents: number;
  reason: string;
}

export function parsePolicy(json: unknown): CancellationPolicy {
  const p = (json ?? {}) as Partial<CancellationPolicy>;
  return {
    fullRefundBeforeHours: p.fullRefundBeforeHours ?? DEFAULT_POLICY.fullRefundBeforeHours,
    halfRefundBeforeHours: p.halfRefundBeforeHours ?? DEFAULT_POLICY.halfRefundBeforeHours,
  };
}

export function computeRefundAmount(input: {
  bookingTotalCents: number;
  hoursUntilStart: number;
  policy: CancellationPolicy;
}): RefundQuote {
  const { bookingTotalCents, hoursUntilStart, policy } = input;

  // `>=` not `>`. Cancelling at EXACTLY 24.0 hours must give the full
  // refund the customer was promised — a strict `>` here means someone who
  // reads the terms and cancels precisely on the deadline is silently
  // charged 50%. That is the kind of bug that becomes a chargeback.
  if (hoursUntilStart >= policy.fullRefundBeforeHours) {
    return {
      refundPercent: 100,
      refundAmountCents: bookingTotalCents,
      reason: `${hoursUntilStart.toFixed(1)}h before start (>= ${policy.fullRefundBeforeHours}h)`,
    };
  }

  if (hoursUntilStart >= policy.halfRefundBeforeHours) {
    return {
      refundPercent: 50,
      // Round, don't floor: on an odd total, flooring quietly keeps a cent
      // of the player's money on every single cancellation.
      refundAmountCents: Math.round(bookingTotalCents / 2),
      reason: `${hoursUntilStart.toFixed(1)}h before start (>= ${policy.halfRefundBeforeHours}h)`,
    };
  }

  return {
    refundPercent: 0,
    refundAmountCents: 0,
    reason: `${hoursUntilStart.toFixed(1)}h before start (< ${policy.halfRefundBeforeHours}h)`,
  };
}

export function hoursUntil(startTs: Date, now: Date): number {
  return (startTs.getTime() - now.getTime()) / 3_600_000;
}
