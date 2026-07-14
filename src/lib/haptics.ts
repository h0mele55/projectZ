'use client';

/**
 * Haptic feedback.
 *
 * A short vibration when a gesture COMMITS — the moment pull-to-refresh passes
 * its threshold, a swipe lands, a destructive action fires. It is the difference
 * between an app that feels like a native one and an app that feels like a web
 * page: the phone answers you.
 *
 * ─── Deliberately tiny ───────────────────────────────────────────────
 *
 * `navigator.vibrate` is the only API that exists cross-platform, and iOS Safari
 * does NOT implement it. So on roughly half our users' phones this is a no-op,
 * and it must be a SILENT one — a haptics module that throws, or that logs a
 * warning on every tap, is worse than no haptics at all.
 *
 * That is also why nothing in the app may DEPEND on it. It is a garnish. If it
 * does not fire, the gesture still worked.
 */

/** The vocabulary. Deliberately small — an app with nine distinct buzzes is noise. */
export type HapticPattern =
  /** A gesture committed: pull-to-refresh fired, a swipe landed. */
  | 'tap'
  /** Something succeeded. */
  | 'success'
  /** Something was refused, or is about to be destructive. */
  | 'warning';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  // 10ms. Long enough to feel, short enough not to be a buzz. A "vibration" the
  // user consciously notices is a vibration that is too long.
  tap: 10,
  success: [10, 40, 10],
  warning: [20, 60, 20],
};

export function haptic(pattern: HapticPattern = 'tap'): void {
  // SSR, and browsers without the API (notably every iPhone). Silence, not an
  // error — this is a garnish, and a garnish must never be able to break a page.
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;

  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Some browsers throw when the page is not visible, or when the user has
    // vibration disabled at the OS level. Neither is our problem to report.
  }
}
