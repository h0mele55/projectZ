/**
 * Small first-party string helpers.
 *
 * Replaces the `truncate` / `pluralize` utilities formerly pulled from
 * the `Dub utils` shim. Same input→output contract, so call sites are
 * unchanged in behaviour.
 */

/**
 * Truncate `str` to `length` characters, appending an ellipsis (`...`)
 * when it overflows. The ellipsis is counted within `length` (the kept
 * slice is `length - 3`). Returns the input untouched when it already
 * fits, and `null` for nullish input (preserving the original
 * three-state contract used by the filter primitives).
 */
export function truncate(str: string | null | undefined, length: number): string | null {
  if (!str || str.length <= length) return str ?? null;
  return `${str.slice(0, length - 3)}...`;
}

/**
 * Truncate `str` to at most `max` characters of content, appending the
 * single-glyph ellipsis `…` (U+2026, ONE character) when it overflows.
 * Unlike {@link truncate}, the `…` is NOT counted within `max` — a long
 * value renders as its first `max` characters followed by `…`. Returns the
 * input untouched when it already fits, and `null` for nullish input.
 */
export function truncateGlyph(str: string | null | undefined, max: number): string | null {
  if (str == null) return null;
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…`;
}

/**
 * Pick the singular or plural form of `word` for `count`. A custom
 * plural may be supplied; otherwise an `s` is appended.
 */
export function pluralize(word: string, count: number, options: { plural?: string } = {}): string {
  if (count === 1) return word;
  return options.plural ?? `${word}s`;
}
