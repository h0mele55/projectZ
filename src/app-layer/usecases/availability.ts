import { fromZonedTime, toZonedTime } from 'date-fns-tz';

import { computePrice, type PriceContext, type PricingRuleRow } from './pricing';

/**
 * Slot materialisation.
 *
 * ─── The timezone trap ──────────────────────────────────────────────
 *
 * A court's opening hours are a WALL-CLOCK fact: "09:00 to 22:00, local
 * time". They are not an instant. Sofia is UTC+2 in winter and UTC+3 in
 * summer, so "09:00 local" is a different absolute moment depending on the
 * date — and on the two changeover days it is a different offset for
 * bookings a few hours apart.
 *
 * The naive implementation — `new Date(day + 'T09:00:00Z')`, or worse,
 * building dates in the SERVER's timezone — is correct on a laptop in
 * Sofia, correct in CI (UTC) for half the year, and then quietly shifts
 * every slot by an hour at the end of March. Players show up an hour late.
 *
 * So: opening hours are interpreted in the VENUE's timezone and converted
 * to absolute UTC per day. `fromZonedTime` does the offset lookup for that
 * specific date, which is the only way to get the changeover days right.
 */

export const MAX_RANGE_DAYS = 14;

export class RangeTooWideError extends Error {
  constructor(days: number) {
    super(
      `Requested ${days} days of availability; the maximum is ${MAX_RANGE_DAYS}. ` +
        `An unbounded range materialises unbounded slots and is a trivial DoS.`,
    );
    this.name = 'RangeTooWideError';
  }
}

export interface AvailabilityWindow {
  dayOfWeek: number;
  /** Venue-local clock, minutes from midnight. */
  openMinutes: number;
  closeMinutes: number;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  /** A one-off override for a single date (holiday, maintenance). */
  exceptionDate?: Date | null;
}

export interface BookedRange {
  startTs: Date;
  endTs: Date;
}

export interface Slot {
  startTs: Date;
  endTs: Date;
  priceCents: number;
  available: boolean;
  blockedReason?: string;
}

export interface SlotOptions {
  from: Date;
  to: Date;
  timezone: string;
  slotStepMinutes: number;
  minBookingMinutes: number;
  basePriceCents: number;
  windows: readonly AvailabilityWindow[];
  booked: readonly BookedRange[];
  pricingRules?: readonly PricingRuleRow[];
  playerTags?: readonly string[];
  membershipLevel?: string | null;
}

/** Half-open overlap: [a,b) vs [c,d). Back-to-back does NOT overlap. */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  // Mirrors the Postgres EXCLUDE constraint's '[)' range exactly. If this
  // disagreed with the database, the UI would offer a slot the INSERT then
  // rejects — the worst kind of bug: it looks like a race, and it isn't.
  return aStart < bEnd && bStart < aEnd;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeSlots(opts: SlotOptions): Slot[] {
  const {
    from,
    to,
    timezone,
    slotStepMinutes,
    minBookingMinutes,
    basePriceCents,
    windows,
    booked,
  } = opts;

  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
  if (days > MAX_RANGE_DAYS) throw new RangeTooWideError(days);

  const slots: Slot[] = [];

  for (let d = 0; d < days; d++) {
    // Walk days in the VENUE's calendar, not the server's.
    const dayStartUtc = new Date(from.getTime() + d * 86_400_000);
    const localDay = toZonedTime(dayStartUtc, timezone);
    const dayOfWeek = localDay.getDay();
    const dateKey = ymd(localDay);

    // An exception row for this date REPLACES the recurring rule. A holiday
    // closure must not be additively merged with "we're open Mondays".
    const exceptions = windows.filter(
      (w) => w.exceptionDate && ymd(toZonedTime(w.exceptionDate, timezone)) === dateKey,
    );

    const applicable =
      exceptions.length > 0
        ? exceptions
        : windows.filter((w) => {
            if (w.exceptionDate) return false;
            if (w.dayOfWeek !== dayOfWeek) return false;
            if (w.effectiveFrom && dayStartUtc < w.effectiveFrom) return false;
            if (w.effectiveTo && dayStartUtc > w.effectiveTo) return false;
            return true;
          });

    for (const w of applicable) {
      for (let m = w.openMinutes; m + minBookingMinutes <= w.closeMinutes; m += slotStepMinutes) {
        const startTs = localMinutesToUtc(localDay, m, timezone);
        const endTs = localMinutesToUtc(localDay, m + minBookingMinutes, timezone);

        if (endTs <= from || startTs >= to) continue;

        const clash = booked.find((b) => overlaps(startTs, endTs, b.startTs, b.endTs));

        const priceCtx: PriceContext = {
          basePriceCents,
          localDayOfWeek: dayOfWeek,
          localStartMinutes: m,
          localEndMinutes: m + minBookingMinutes,
          playerTags: opts.playerTags,
          membershipLevel: opts.membershipLevel,
        };

        const { finalPriceCents } = computePrice(opts.pricingRules ?? [], priceCtx);

        slots.push({
          startTs,
          endTs,
          priceCents: finalPriceCents,
          available: !clash,
          ...(clash ? { blockedReason: 'booked' } : {}),
        });
      }
    }
  }

  return slots.sort((a, b) => a.startTs.getTime() - b.startTs.getTime());
}

/**
 * Venue-local wall-clock minutes on a given local day → absolute UTC.
 *
 * `fromZonedTime` resolves the offset FOR THAT DATE, which is the whole
 * point: on 2026-03-29 Sofia jumps from UTC+2 to UTC+3, and a slot at 09:00
 * before and after the switch are different absolute instants.
 */
function localMinutesToUtc(localDay: Date, minutes: number, timezone: string): Date {
  const y = localDay.getFullYear();
  const mo = localDay.getMonth();
  const d = localDay.getDate();
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;

  // Construct the naive local wall-clock, then ask what instant that is IN
  // the venue's zone.
  const naive = new Date(y, mo, d, h, min, 0, 0);
  return fromZonedTime(naive, timezone);
}
