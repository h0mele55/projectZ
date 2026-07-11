/**
 * Epic 58 — date-picker module entry.
 *
 * The foundation layer (types + utilities + preset catalogue) is the
 * public contract every product surface should import from. The
 * vendored UI components (calendar / trigger / single + range
 * picker / presets panel) re-export here too, but new consumers
 * should prefer the typed facade: `DateValue`, `DateRangeValue`,
 * `DEFAULT_DATE_RANGE_PRESETS`, etc.
 */

// ─── Foundation — types, utilities, presets ──────────────────────────

export type {
  CalendarProps,
  ControlledDateRangeProps,
  ControlledDateValueProps,
  DateConstraints,
  DatePreset,
  DateRange,
  DateRangePreset,
  DateRangeValue,
  DateValue,
  PickerProps,
  Preset,
  PresetMeta,
  ResolvableDatePreset,
  ResolvableDateRangePreset,
} from './types';

export {
  addUtcDays,
  clampDate,
  endOfUtcDay,
  fromDateRangeValue,
  isAfter,
  isBefore,
  isDateInRange,
  isRangeEqual,
  isSameUtcDay,
  isValidDate,
  materializeDatePreset,
  materializeDateRangePreset,
  normalizeRange,
  parseRangeToken,
  parseYMD,
  startOfUtcDay,
  toDateRangeValue,
  toRangeToken,
  toYMD,
} from './date-utils';

export {
  DEFAULT_DATE_RANGE_PRESETS,
  resolveLastMonth,
  resolveLastNDays,
  resolveLastQuarter,
  resolveLastYear,
  resolveMonthToDate,
  resolveQuarterToDate,
  resolveToday,
  resolveYearToDate,
  resolveYesterday,
  selectDateRangePresets,
} from './presets-catalogue';

// ─── UI surfaces (vendored components pending foundation adoption) ────

export * from './calendar';
export * from './date-picker';
export * from './date-range-picker';
export { DatePickerContext } from './shared';
