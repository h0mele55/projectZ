/**
 * Epic 58 — reporting preset catalogue.
 *
 * A minimal, curated library of time-range presets the reporting
 * pages and list filters can opt into. Each preset is a pure
 * `resolve(now)` function — no ambient clock — so they're safe to
 * use both on the server (for default URL-state hydration) and in
 * tests (pass a frozen `now`).
 *
 * Every boundary is UTC: a preset built "now" on a server in one
 * timezone and "now" on a client in another produces the same
 * `YYYY-MM-DD` boundaries, so URL-synced filters stay stable.
 *
 * Why these presets?
 *   - **Today / Yesterday** — evidence expiry checks, daily digests.
 *   - **Last N days** — dashboard trendlines.
 *   - **Month / Quarter / Year to date** — reporting periods.
 *   - **Previous month / quarter / year** — period-over-period comparisons.
 *
 * What's NOT here:
 *   - Anything locale-specific ("this work week") — the app is UTC-first.
 *   - "All time" — callers pass an explicit null-ended range for that.
 *   - Calendar exotica (fiscal quarters, 4-5-4) — per-tenant presets
 *     can be layered on later; the catalogue stays small by design.
 */

import { addUtcDays, startOfUtcDay } from './date-utils';
import type { DateRangeValue, ResolvableDateRangePreset } from './types';

// ─── Internal helpers ─────────────────────────────────────────────────

function utcDate(year: number, monthZeroBased: number, day: number): Date {
  return new Date(Date.UTC(year, monthZeroBased, day));
}

function startOfUtcMonth(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function startOfUtcQuarter(date: Date): Date {
  const m = date.getUTCMonth();
  const qStartMonth = m - (m % 3);
  return utcDate(date.getUTCFullYear(), qStartMonth, 1);
}

function startOfUtcYear(date: Date): Date {
  return utcDate(date.getUTCFullYear(), 0, 1);
}

/** Last day of the month that contains `date`, UTC. */
function endOfUtcMonth(date: Date): Date {
  return addUtcDays(utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 1), -1);
}

/** Last day of the quarter that contains `date`, UTC. */
function endOfUtcQuarter(date: Date): Date {
  const m = date.getUTCMonth();
  const qStartMonth = m - (m % 3);
  return addUtcDays(utcDate(date.getUTCFullYear(), qStartMonth + 3, 1), -1);
}

/** Last day of the year that contains `date`, UTC. */
function endOfUtcYear(date: Date): Date {
  return utcDate(date.getUTCFullYear(), 11, 31);
}

// ─── Resolvers (exported so callers can build custom preset lists) ────

export function resolveToday(now: Date): DateRangeValue {
  const d = startOfUtcDay(now);
  return { from: d, to: d };
}

export function resolveYesterday(now: Date): DateRangeValue {
  const d = addUtcDays(startOfUtcDay(now), -1);
  return { from: d, to: d };
}

/** Inclusive range covering the last `n` days, ending today. */
export function resolveLastNDays(n: number, now: Date): DateRangeValue {
  const today = startOfUtcDay(now);
  const from = addUtcDays(today, -(Math.max(1, n) - 1));
  return { from, to: today };
}

export function resolveMonthToDate(now: Date): DateRangeValue {
  return { from: startOfUtcMonth(now), to: startOfUtcDay(now) };
}

export function resolveQuarterToDate(now: Date): DateRangeValue {
  return { from: startOfUtcQuarter(now), to: startOfUtcDay(now) };
}

export function resolveYearToDate(now: Date): DateRangeValue {
  return { from: startOfUtcYear(now), to: startOfUtcDay(now) };
}

export function resolveLastMonth(now: Date): DateRangeValue {
  const thisMonth = startOfUtcMonth(now);
  const lastMonthEnd = addUtcDays(thisMonth, -1);
  return {
    from: startOfUtcMonth(lastMonthEnd),
    to: endOfUtcMonth(lastMonthEnd),
  };
}

export function resolveLastQuarter(now: Date): DateRangeValue {
  const thisQuarter = startOfUtcQuarter(now);
  const lastQuarterEnd = addUtcDays(thisQuarter, -1);
  return {
    from: startOfUtcQuarter(lastQuarterEnd),
    to: endOfUtcQuarter(lastQuarterEnd),
  };
}

export function resolveLastYear(now: Date): DateRangeValue {
  const lastYearAnchor = addUtcDays(startOfUtcYear(now), -1);
  return {
    from: startOfUtcYear(lastYearAnchor),
    to: endOfUtcYear(lastYearAnchor),
  };
}

// ─── Catalogue ────────────────────────────────────────────────────────

/**
 * The default preset list most reporting surfaces start from.
 * Ordered by typical frequency of use. Callers can `filter()` or
 * `concat()` as needed.
 */
export const DEFAULT_DATE_RANGE_PRESETS: ResolvableDateRangePreset[] = [
  {
    id: 'today',
    label: 'Today',
    shortcut: 'd',
    resolve: resolveToday,
  },
  {
    id: 'yesterday',
    label: 'Yesterday',
    shortcut: 'y',
    resolve: resolveYesterday,
  },
  {
    id: 'last-7-days',
    label: 'Last 7 days',
    shortcut: '7',
    resolve: (now) => resolveLastNDays(7, now),
  },
  {
    id: 'last-30-days',
    label: 'Last 30 days',
    shortcut: '3',
    resolve: (now) => resolveLastNDays(30, now),
  },
  {
    id: 'last-90-days',
    label: 'Last 90 days',
    shortcut: '9',
    resolve: (now) => resolveLastNDays(90, now),
  },
  {
    id: 'month-to-date',
    label: 'Month to date',
    shortcut: 'm',
    resolve: resolveMonthToDate,
  },
  {
    id: 'quarter-to-date',
    label: 'Quarter to date',
    shortcut: 'q',
    resolve: resolveQuarterToDate,
  },
  {
    id: 'year-to-date',
    label: 'Year to date',
    shortcut: 'a',
    resolve: resolveYearToDate,
  },
  {
    id: 'last-month',
    label: 'Last month',
    resolve: resolveLastMonth,
  },
  {
    id: 'last-quarter',
    label: 'Last quarter',
    resolve: resolveLastQuarter,
  },
  {
    id: 'last-year',
    label: 'Last year',
    resolve: resolveLastYear,
  },
];

/**
 * Build a fresh catalogue with only the requested preset ids,
 * preserving the canonical order. Unknown ids are silently dropped so
 * callers can pass a stable config list across app versions without
 * defensive filtering.
 */
export function selectDateRangePresets(ids: string[]): ResolvableDateRangePreset[] {
  const requested = new Set(ids);
  return DEFAULT_DATE_RANGE_PRESETS.filter((p) => requested.has(p.id));
}
