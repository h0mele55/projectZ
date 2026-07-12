import { z } from 'zod';

import { MAX_BOOKING_HOURS } from '@/lib/db/booking-invariants';

import { cuidSchema } from './common';

/**
 * The booking span is validated in three places, on purpose:
 *
 *   1. here (Zod)  — a 400 with a useful message
 *   2. the app     — assertBookingSpanValid()
 *   3. POSTGRES    — the booking_span_valid CHECK constraint
 *
 * Only (3) is a guarantee. (1) and (2) exist so the user gets a sentence
 * instead of a 500. If they ever disagree, the database wins.
 */
export const createBookingSchema = z
  .object({
    courtId: cuidSchema,
    startTs: z.coerce.date(),
    endTs: z.coerce.date(),
    participants: z
      .array(
        z.object({
          userId: cuidSchema.optional(),
          guestName: z.string().min(1).max(120).optional(),
          guestEmail: z.string().email().optional(),
        }),
      )
      .max(20)
      .default([]),
    /// Client-generated. The difference between a flaky network and a
    /// double charge.
    idempotencyKey: z.string().uuid(),
    guestContact: z
      .object({
        name: z.string().min(1).max(120),
        email: z.string().email(),
        phone: z.string().min(5).max(32).optional(),
      })
      .optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((b) => b.endTs > b.startTs, {
    message: 'A booking must end after it starts.',
    path: ['endTs'],
  })
  .refine((b) => b.endTs.getTime() - b.startTs.getTime() <= MAX_BOOKING_HOURS * 3_600_000, {
    message: `A booking may not exceed ${MAX_BOOKING_HOURS} hours.`,
    path: ['endTs'],
  });

// NOTE: "a booking must be attributable to someone" (an authenticated user
// OR guest contact details) is deliberately NOT enforced here. Whether the
// caller is signed in lives in the RequestContext, not in the request body,
// and a schema cannot see it. P09's createBooking use case owns that rule —
// putting a half-version of it here would give a false sense that the input
// is fully validated.

export const cancelBookingSchema = z.object({
  bookingId: cuidSchema,
  reason: z.string().max(500).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
