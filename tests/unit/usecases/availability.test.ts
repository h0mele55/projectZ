import {
  MAX_RANGE_DAYS,
  RangeTooWideError,
  computeSlots,
  type AvailabilityWindow,
} from '@/app-layer/usecases/availability';

const SOFIA = 'Europe/Sofia';

/** Open 09:00–17:00 every day, venue-local. */
const openAllWeek: AvailabilityWindow[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  openMinutes: 9 * 60,
  closeMinutes: 17 * 60,
}));

const base = {
  timezone: SOFIA,
  slotStepMinutes: 30,
  minBookingMinutes: 60,
  basePriceCents: 1000,
  windows: openAllWeek,
  booked: [],
};

describe('slot materialisation', () => {
  it('1. an empty court, 09:00–17:00, 30-min steps, 60-min slots → 15 windows', () => {
    // Start times 09:00, 09:30 … 16:00. The last VALID start is 16:00
    // (ending 17:00); 16:30 would end at 17:30, past closing.
    const slots = computeSlots({
      ...base,
      from: new Date('2026-07-15T00:00:00Z'),
      to: new Date('2026-07-16T00:00:00Z'),
    });

    expect(slots).toHaveLength(15);
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it('2. a booking blocks its own slot AND the overlapping neighbours', () => {
    const slots = computeSlots({
      ...base,
      from: new Date('2026-07-15T00:00:00Z'),
      to: new Date('2026-07-16T00:00:00Z'),
      // 10:00–11:00 Sofia = 07:00–08:00 UTC in July (UTC+3).
      booked: [
        { startTs: new Date('2026-07-15T07:00:00Z'), endTs: new Date('2026-07-15T08:00:00Z') },
      ],
    });

    const blocked = slots.filter((s) => !s.available);

    // 09:30–10:30, 10:00–11:00 and 10:30–11:30 all overlap the booking.
    // Marking only the exact 10:00 slot would let a player book 09:30 and
    // collide at INSERT — the UI would be offering a slot the database
    // then rejects.
    expect(blocked).toHaveLength(3);
    expect(blocked.every((s) => s.blockedReason === 'booked')).toBe(true);
  });

  it('2b. a booking that merely ABUTS a slot does not block it', () => {
    // Mirrors the Postgres EXCLUDE constraint's half-open '[)' range. If
    // the app disagreed with the database here, the UI would hide a slot
    // that is actually bookable.
    const slots = computeSlots({
      ...base,
      from: new Date('2026-07-15T00:00:00Z'),
      to: new Date('2026-07-16T00:00:00Z'),
      // 09:00–10:00 Sofia = 06:00–07:00 UTC.
      booked: [
        { startTs: new Date('2026-07-15T06:00:00Z'), endTs: new Date('2026-07-15T07:00:00Z') },
      ],
    });

    const tenAm = slots.find((s) => s.startTs.toISOString() === '2026-07-15T07:00:00.000Z');
    expect(tenAm?.available).toBe(true);
  });

  it('3. an exception row REPLACES the recurring rule for that date', () => {
    // A holiday closure must not be additively merged with "we're open
    // Wednesdays" — it must override it.
    const closed: AvailabilityWindow[] = [
      ...openAllWeek,
      {
        dayOfWeek: 3,
        openMinutes: 0,
        closeMinutes: 0,
        exceptionDate: new Date('2026-07-15T00:00:00Z'),
      },
    ];

    const slots = computeSlots({
      ...base,
      windows: closed,
      from: new Date('2026-07-15T00:00:00Z'),
      to: new Date('2026-07-16T00:00:00Z'),
    });

    expect(slots).toHaveLength(0);
  });

  it('4. DST — 09:00 local is a DIFFERENT absolute instant across the changeover', () => {
    // THE bug this engine exists to avoid.
    //
    // Sofia is UTC+2 in winter and UTC+3 in summer. Building slots against
    // a fixed offset (or the server's timezone) is correct on a laptop in
    // Sofia, correct in a UTC CI runner for half the year, and then shifts
    // every slot by an hour at the end of March. Players arrive an hour
    // late for their court.
    const winter = computeSlots({
      ...base,
      from: new Date('2026-01-14T00:00:00Z'),
      to: new Date('2026-01-15T00:00:00Z'),
    });
    const summer = computeSlots({
      ...base,
      from: new Date('2026-07-15T00:00:00Z'),
      to: new Date('2026-07-16T00:00:00Z'),
    });

    // Winter: 09:00 EET (UTC+2) = 07:00Z. Summer: 09:00 EEST (UTC+3) = 06:00Z.
    expect(winter[0]!.startTs.toISOString()).toBe('2026-01-14T07:00:00.000Z');
    expect(summer[0]!.startTs.toISOString()).toBe('2026-07-15T06:00:00.000Z');

    // Both are 09:00 to a human standing at the venue — which is the point.
    expect(winter).toHaveLength(summer.length);
  });

  it('5. a window whose effectiveFrom is in the future produces no slots today', () => {
    const future: AvailabilityWindow[] = [
      {
        dayOfWeek: 3,
        openMinutes: 9 * 60,
        closeMinutes: 17 * 60,
        effectiveFrom: new Date('2027-01-01T00:00:00Z'),
      },
    ];

    const slots = computeSlots({
      ...base,
      windows: future,
      from: new Date('2026-07-15T00:00:00Z'),
      to: new Date('2026-07-16T00:00:00Z'),
    });

    expect(slots).toHaveLength(0);
  });

  it('6. a range wider than 14 days is REJECTED', () => {
    // An unbounded range materialises unbounded slots — a trivial DoS: one
    // unauthenticated GET asking for ten years of availability.
    expect(() =>
      computeSlots({
        ...base,
        from: new Date('2026-07-15T00:00:00Z'),
        to: new Date('2026-09-15T00:00:00Z'),
      }),
    ).toThrow(RangeTooWideError);

    // …and exactly 14 days is fine.
    expect(() =>
      computeSlots({
        ...base,
        from: new Date('2026-07-15T00:00:00Z'),
        to: new Date(Date.UTC(2026, 6, 15 + MAX_RANGE_DAYS)),
      }),
    ).not.toThrow();
  });

  it('prices each slot through the rule engine', () => {
    const slots = computeSlots({
      ...base,
      from: new Date('2026-07-18T00:00:00Z'), // a Saturday
      to: new Date('2026-07-19T00:00:00Z'),
      pricingRules: [
        {
          id: 'weekend',
          name: 'Weekend',
          priority: 200,
          conditionsJson: { dayOfWeek: [0, 6] },
          multiplier: 1.5,
          fixedPriceCents: null,
        },
      ],
    });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.priceCents === 1500)).toBe(true);
  });
});
