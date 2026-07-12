import {
  InvalidBookingSpanError,
  MAX_BOOKING_HOURS,
  PENDING_TTL_MINUTES,
  assertBookingSpanValid,
  computeExpiresAt,
} from '@/lib/db/booking-invariants';

const T0 = new Date('2026-07-12T09:00:00.000Z');
const hoursAfter = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe('computeExpiresAt', () => {
  it('gives a PENDING booking exactly 15 minutes to complete checkout', () => {
    expect(computeExpiresAt(T0).toISOString()).toBe('2026-07-12T09:15:00.000Z');
    expect(PENDING_TTL_MINUTES).toBe(15);
  });
});

describe('assertBookingSpanValid', () => {
  it('accepts a normal one-hour booking', () => {
    expect(() => assertBookingSpanValid({ startTs: T0, endTs: hoursAfter(1) })).not.toThrow();
  });

  it('accepts a span of exactly the maximum', () => {
    // Boundary: the DB CHECK is `<= INTERVAL '4 hours'`, so 4.0 is legal.
    // Off-by-one here would reject a booking the database happily accepts.
    expect(() =>
      assertBookingSpanValid({ startTs: T0, endTs: hoursAfter(MAX_BOOKING_HOURS) }),
    ).not.toThrow();
  });

  it('rejects a span one minute over the maximum', () => {
    expect(() =>
      assertBookingSpanValid({
        startTs: T0,
        endTs: new Date(hoursAfter(MAX_BOOKING_HOURS).getTime() + 60_000),
      }),
    ).toThrow(InvalidBookingSpanError);
  });

  it('rejects a zero-length booking', () => {
    expect(() => assertBookingSpanValid({ startTs: T0, endTs: T0 })).toThrow(
      /must end after it starts/,
    );
  });

  it('rejects a booking that ends before it starts', () => {
    expect(() => assertBookingSpanValid({ startTs: hoursAfter(2), endTs: T0 })).toThrow(
      InvalidBookingSpanError,
    );
  });

  it('rejects an invalid date rather than silently producing NaN hours', () => {
    expect(() =>
      assertBookingSpanValid({ startTs: new Date('nonsense'), endTs: hoursAfter(1) }),
    ).toThrow(/not a valid date/);
  });
});
