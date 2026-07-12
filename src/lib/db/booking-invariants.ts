/**
 * Booking invariants, mirrored from the database CHECK constraints.
 *
 * The DATABASE is where the guarantee lives (`booking_span_valid`). These
 * exist so a bad request fails as a 400 with a useful message instead of a
 * 500 from a constraint violation — not because the app is the guard.
 *
 * If these ever disagree with the constraint, the constraint wins and the
 * user gets an ugly error. `booking-exclusion.test.ts` pins the DB side;
 * `booking-invariants.test.ts` pins this side against the same numbers.
 */

/** A PENDING booking holds its slot. It must not hold it forever. */
export const PENDING_TTL_MINUTES = 15;

/** Mirrors `endTs - startTs <= INTERVAL '4 hours'`. */
export const MAX_BOOKING_HOURS = 4;

export function computeExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PENDING_TTL_MINUTES * 60_000);
}

export class InvalidBookingSpanError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidBookingSpanError';
  }
}

export function assertBookingSpanValid(span: { startTs: Date; endTs: Date }): void {
  const { startTs, endTs } = span;

  if (!(startTs instanceof Date) || Number.isNaN(startTs.getTime())) {
    throw new InvalidBookingSpanError('startTs is not a valid date');
  }
  if (!(endTs instanceof Date) || Number.isNaN(endTs.getTime())) {
    throw new InvalidBookingSpanError('endTs is not a valid date');
  }

  if (endTs.getTime() <= startTs.getTime()) {
    throw new InvalidBookingSpanError('A booking must end after it starts.');
  }

  const hours = (endTs.getTime() - startTs.getTime()) / 3_600_000;
  if (hours > MAX_BOOKING_HOURS) {
    throw new InvalidBookingSpanError(
      `A booking may not exceed ${MAX_BOOKING_HOURS} hours (requested ${hours.toFixed(1)}).`,
    );
  }
}
