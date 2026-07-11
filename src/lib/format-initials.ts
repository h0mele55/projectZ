/**
 * Derive avatar-style initials from a free-text label.
 *
 * Used today by the org-switcher trigger to render a 2-character
 * monogram for the current organization. The contract is
 * deliberately small and predictable so the visual output is
 * stable as long as the input string is.
 *
 * Algorithm:
 *   1. Trim and collapse internal whitespace runs to single spaces.
 *   2. Split on whitespace.
 *   3. Multi-word input → first character of each of the first two
 *      words. Single-word input → first two characters.
 *   4. Uppercase. Return a string of length 0–2.
 *
 * Edge cases handled:
 *   - Empty / whitespace-only input → empty string (caller picks a
 *     fallback, typically "?" or a default icon).
 *   - Mixed casing → uppercase normalised.
 *   - Tab / newline separators → treated as whitespace.
 *   - Numbers / punctuation in the name → preserved at their
 *     position (uppercase of digit/punct is the same character).
 *   - Multi-codepoint emoji / surrogate pairs → indexed via the
 *     iterator semantics of Array.from() so a single emoji counts
 *     as one initial rather than half.
 *
 * Examples:
 *   formatInitials('Acme Corp')              → 'AC'
 *   formatInitials('  acme   corp  ')        → 'AC'
 *   formatInitials('GitHub Inc.')            → 'GI'
 *   formatInitials('lowercase')              → 'LO'
 *   formatInitials('A')                      → 'A'
 *   formatInitials('')                       → ''
 *   formatInitials('Three Word Org')         → 'TW'  (first two words only)
 */
export function formatInitials(label: string | null | undefined): string {
  if (!label) return '';

  const trimmed = label.trim();
  if (trimmed.length === 0) return '';

  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return '';

  if (words.length >= 2) {
    return (firstCodePoint(words[0]) + firstCodePoint(words[1])).toUpperCase();
  }

  // Single word — take the first two code points (handles surrogate
  // pairs / emoji correctly via Array.from iteration).
  const codePoints = Array.from(words[0]);
  return codePoints.slice(0, 2).join('').toUpperCase();
}

function firstCodePoint(s: string): string {
  return Array.from(s)[0] ?? '';
}
