'use client';

import { useEffect, useState } from 'react';

/**
 * Has the user asked us to stop moving things?
 *
 * ─── Why a JS hook when the CSS already handles it ───────────────────
 *
 * `globals.css` flattens every CSS animation and transition to 1ms under
 * `prefers-reduced-motion: reduce`, and a ratchet keeps it there
 * (tests/guardrails/motion-safety.test.ts). That covers everything the browser
 * animates on our behalf.
 *
 * It does NOT cover motion we ask for in JAVASCRIPT:
 *
 *   element.scrollIntoView({ behavior: 'smooth' })
 *   window.scrollTo({ behavior: 'smooth' })
 *   document.startViewTransition(...)
 *
 * The CSS override cannot reach those. A smooth scroll is not a CSS transition;
 * it is the browser's own scrolling behaviour, and it will happily animate for a
 * user who has explicitly asked it not to.
 *
 * People set this preference because motion makes them ILL — vestibular
 * disorders, migraine. A page that lurches sideways to bring a tab into view is,
 * for them, a page that makes them feel sick. It is not a stylistic preference.
 *
 * ─── SSR ─────────────────────────────────────────────────────────────
 *
 * Returns `false` on the server. That is the safe default only because every
 * motion we start is triggered by an EFFECT or an INTERACTION, never during
 * render — so nothing has moved by the time the real value arrives.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');

    setPrefersReduced(query.matches);

    // The preference can change WHILE the app is open — a user toggles it in
    // system settings, or plugs in an external display with a different profile.
    // Reading it once on mount means we keep animating at somebody who has just
    // asked us to stop.
    const onChange = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return prefersReduced;
}

/**
 * The `behavior` to hand to a scroll API.
 *
 * `'auto'` is not "let the browser decide" — it means INSTANT. That is exactly
 * what a reduced-motion user wants: they still get taken to the right place, they
 * simply do not get dragged there.
 */
export function scrollBehavior(prefersReduced: boolean): ScrollBehavior {
  return prefersReduced ? 'auto' : 'smooth';
}
