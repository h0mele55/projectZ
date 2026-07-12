import {
  PLATFORM_FEE_BPS,
  platformFeeCents,
  refundSplit,
  venuePayoutCents,
} from '@/lib/billing/platform-fee';

describe('platformFeeCents', () => {
  it('charges the tier rate', () => {
    // €24.00 booking
    expect(platformFeeCents(2400, 'FREE')).toBe(120); // 5%
    expect(platformFeeCents(2400, 'CLUB')).toBe(72); // 3%
    expect(platformFeeCents(2400, 'PRO')).toBe(36); // 1.5%
  });

  it('never produces a fractional cent, however awkward the total', () => {
    // 1.5% of 3333¢ is 49.995¢ — the exact case where `total * 0.015` gives
    // 49.995000000000005 and an unguarded pipeline stores a float in an Int
    // column, or silently truncates.
    const fee = platformFeeCents(3333, 'PRO');

    expect(Number.isInteger(fee)).toBe(true);
    expect(fee).toBe(50); // rounded, once, at the end
  });

  it.each([1, 7, 33, 99, 101, 1_234, 99_999, 1_000_000])(
    'fee + payout === total for %i cents (no cent is ever conjured or lost)',
    (total) => {
      for (const tier of ['FREE', 'CLUB', 'PRO'] as const) {
        const fee = platformFeeCents(total, tier);
        const payout = venuePayoutCents(total, tier);

        // The invariant. If these two ever fail to sum to the amount actually
        // charged, there is a cent on the customer's card statement that
        // exists in NEITHER ledger.
        expect(fee + payout).toBe(total);
        expect(Number.isInteger(payout)).toBe(true);
        expect(payout).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it('takes nothing from a free booking', () => {
    expect(platformFeeCents(0, 'FREE')).toBe(0);
    expect(venuePayoutCents(0, 'FREE')).toBe(0);
  });

  it('rejects a non-integer or negative total rather than rounding it', () => {
    // A float reaching here means money was handled as a float somewhere
    // upstream. Fail loudly at the boundary instead of laundering it.
    expect(() => platformFeeCents(24.5, 'FREE')).toThrow(/non-negative integer/);
    expect(() => platformFeeCents(-100, 'FREE')).toThrow(/non-negative integer/);
  });

  it('the PRO tier is genuinely cheaper than FREE (the tiers are not decorative)', () => {
    expect(PLATFORM_FEE_BPS.PRO).toBeLessThan(PLATFORM_FEE_BPS.CLUB);
    expect(PLATFORM_FEE_BPS.CLUB).toBeLessThan(PLATFORM_FEE_BPS.FREE);
  });
});

describe('refundSplit', () => {
  it('gives back the whole fee on a full refund', () => {
    const { feeReversedCents, transferReversedCents } = refundSplit(2400, 2400, 'FREE');

    expect(feeReversedCents).toBe(120); // all of our 5%
    expect(transferReversedCents).toBe(2280); // all of the venue's share
    expect(feeReversedCents + transferReversedCents).toBe(2400);
  });

  it('splits a partial refund proportionally', () => {
    // Half the booking refunded → half our fee, half the venue's payout.
    const { feeReversedCents, transferReversedCents } = refundSplit(2400, 1200, 'FREE');

    expect(feeReversedCents).toBe(60);
    expect(transferReversedCents).toBe(1140);
    expect(feeReversedCents + transferReversedCents).toBe(1200);
  });

  it.each([
    [2400, 1],
    [2400, 799],
    [3333, 1111],
    [999, 333],
    [10_000, 3_333],
  ])(
    'the two reversals always sum to EXACTLY the refund (%i total, %i refunded)',
    (total, refund) => {
      for (const tier of ['FREE', 'CLUB', 'PRO'] as const) {
        const { feeReversedCents, transferReversedCents } = refundSplit(total, refund, tier);

        // Derived by subtraction, so no cent can fall between them. Computing
        // both independently would let them round apart — and the customer
        // would be refunded a cent more or less than the two reversals total.
        expect(feeReversedCents + transferReversedCents).toBe(refund);
        expect(Number.isInteger(feeReversedCents)).toBe(true);
        expect(Number.isInteger(transferReversedCents)).toBe(true);
      }
    },
  );

  it('never reverses more fee than we actually took', () => {
    const total = 2400;
    const fee = platformFeeCents(total, 'FREE');

    for (let refund = 0; refund <= total; refund += 137) {
      const { feeReversedCents } = refundSplit(total, refund, 'FREE');
      expect(feeReversedCents).toBeLessThanOrEqual(fee);
    }
  });

  it('refuses to refund more than was charged', () => {
    expect(() => refundSplit(2400, 2401, 'FREE')).toThrow(/exceeds the total/);
  });
});
