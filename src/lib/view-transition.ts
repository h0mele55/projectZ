'use client';

/**
 * Route transitions, via the View Transitions API.
 *
 * ─── Zero new dependencies, on purpose ───────────────────────────────
 *
 * The reflex here is framer-motion. It is 30-plus kilobytes to cross-fade a
 * page, it needs the whole tree wrapped in AnimatePresence, and it fights the
 * App Router's streaming — the exit animation cannot run for content the server
 * has already replaced.
 *
 * `document.startViewTransition` is built into the browser. It snapshots the old
 * page, runs the DOM update, snapshots the new one, and cross-fades between them
 * — with no JavaScript animating anything, and no library.
 *
 * ─── Progressive, in the real sense ──────────────────────────────────
 *
 * Where it does not exist (Firefox, older Safari) the callback simply runs
 * immediately and the navigation is a hard cut. That is not a degraded
 * experience; it is what the app does today.
 *
 * ─── And it is DISABLED under reduced motion ─────────────────────────
 *
 * A cross-fade is motion. The CSS `prefers-reduced-motion` override in
 * globals.css cannot reach it — a view transition is not a CSS transition on an
 * element, it is a browser-level animation of a snapshot — so it must be
 * suppressed here, in JavaScript.
 */

type ViewTransitionCapableDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => { finished: Promise<void> };
};

export function supportsViewTransitions(): boolean {
  if (typeof document === 'undefined') return false;
  return typeof (document as ViewTransitionCapableDocument).startViewTransition === 'function';
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Run `update` inside a view transition when that is possible and wanted.
 *
 * ALWAYS runs `update`. That is the contract, and it is the whole safety of this
 * function: if the API is missing, or the user has asked for no motion, or the
 * transition throws, the navigation still happens. A pretty transition that can
 * swallow a navigation is a broken app.
 */
export function withViewTransition(update: () => void): void {
  const doc = document as ViewTransitionCapableDocument;

  if (!supportsViewTransitions() || prefersReducedMotion()) {
    update();
    return;
  }

  try {
    doc.startViewTransition!(update);
  } catch {
    // If the browser refuses (a transition already running, a detached
    // document), do the thing anyway. Never let the garnish eat the meal.
    update();
  }
}
