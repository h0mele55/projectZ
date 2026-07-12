import {
  DEFAULT_POLICY,
  computeRefundAmount,
  hoursUntil,
  parsePolicy,
} from '@/app-layer/usecases/refund';

const q = (hours: number, total = 2400, policy = DEFAULT_POLICY) =>
  computeRefundAmount({ bookingTotalCents: total, hoursUntilStart: hours, policy });

describe('cancellation refund policy', () => {
  it('100% at EXACTLY 24.0 hours — the boundary belongs to the customer', () => {
    // A strict `>` here silently charges 50% to the person who read the
    // terms and cancelled precisely on the deadline. That is a chargeback.
    expect(q(24.0)).toMatchObject({ refundPercent: 100, refundAmountCents: 2400 });
  });

  it('100% at 25.5 hours', () => {
    expect(q(25.5).refundPercent).toBe(100);
  });

  it('50% at exactly 12.0 hours', () => {
    expect(q(12.0)).toMatchObject({ refundPercent: 50, refundAmountCents: 1200 });
  });

  it('50% at 20.0 hours', () => {
    expect(q(20.0).refundPercent).toBe(50);
  });

  it('50% at 23.9 hours — just inside the full-refund cutoff', () => {
    expect(q(23.9).refundPercent).toBe(50);
  });

  it('0% at 11.9 hours', () => {
    expect(q(11.9)).toMatchObject({ refundPercent: 0, refundAmountCents: 0 });
  });

  it('0% after the booking has already started', () => {
    expect(q(-3).refundPercent).toBe(0);
  });

  it('a 50% refund of an ODD total rounds rather than losing a cent', () => {
    // 2401 / 2 = 1200.5. Flooring quietly keeps a cent of the player's
    // money on every single cancellation.
    expect(q(15, 2401).refundAmountCents).toBe(1201);
  });

  it('honours a venue policy override', () => {
    const generous = { fullRefundBeforeHours: 48, halfRefundBeforeHours: 24 };
    expect(q(30, 2400, generous).refundPercent).toBe(50);
    expect(q(50, 2400, generous).refundPercent).toBe(100);
  });

  it('falls back to the default when the venue policy is absent or partial', () => {
    expect(parsePolicy(null)).toEqual(DEFAULT_POLICY);
    expect(parsePolicy({ fullRefundBeforeHours: 48 })).toEqual({
      fullRefundBeforeHours: 48,
      halfRefundBeforeHours: 12,
    });
  });

  it('every quote explains itself', () => {
    // "Why did I only get half back?" needs an answer on the receipt.
    expect(q(20).reason).toMatch(/20\.0h before start/);
  });

  it('hoursUntil is signed', () => {
    const now = new Date('2026-07-15T10:00:00Z');
    expect(hoursUntil(new Date('2026-07-16T10:00:00Z'), now)).toBe(24);
    expect(hoursUntil(new Date('2026-07-15T08:00:00Z'), now)).toBe(-2);
  });
});
