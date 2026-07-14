'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { haptic } from '@/lib/haptics';

/**
 * Pull down at the top of a list to refresh it.
 *
 * ═══ THE ONE RULE ═══
 *
 * IT ONLY ARMS WHEN THE PAGE IS ALREADY SCROLLED TO THE TOP.
 *
 * Skip that check and the gesture fires while the user is halfway down a list,
 * dragging their thumb to scroll UP. They did not ask to refresh; the list
 * reloads under them, their scroll position is lost, and the item they were
 * reaching for is gone. It is the single most infuriating way to get this wrong,
 * and it is the default behaviour if you simply listen for a downward drag.
 *
 * ═══ AND THE ONE THAT IS EASY TO MISS ═══
 *
 * The browser has its OWN pull-to-refresh, and on Chrome for Android it will
 * happily reload the whole page while ours is trying to run — two refreshes, one
 * of which throws away the app.
 *
 * `overscroll-behavior-y: contain` on the scroll container is what disables it.
 * That is set in globals.css, and the guard in
 * tests/guardrails/no-horizontal-drift-patterns.test.ts locks the -x half; this
 * hook is useless without the -y half.
 */

/** How far the user must pull before it fires. */
const TRIGGER_PX = 70;

/** Resistance: the indicator moves slower than the finger, so the pull feels weighted. */
const RESISTANCE = 2.5;

/** Beyond this, the indicator stops following — pulling further does nothing. */
const MAX_PULL_PX = 120;

export interface PullToRefreshState {
  /** 0..1 — how close to firing. Drives the spinner's rotation/opacity. */
  progress: number;
  /** How far to translate the content down, in px. */
  offset: number;
  /** The refresh is running. */
  isRefreshing: boolean;
}

export function usePullToRefresh(
  onRefresh: () => Promise<unknown>,
  opts: { enabled?: boolean } = {},
): PullToRefreshState {
  const { enabled = true } = opts;

  const [state, setState] = useState<PullToRefreshState>({
    progress: 0,
    offset: 0,
    isRefreshing: false,
  });

  const startY = useRef<number | null>(null);
  const armed = useRef(false);
  const fired = useRef(false);
  const refreshing = useRef(false);

  const run = useCallback(async () => {
    if (refreshing.current) return;

    refreshing.current = true;
    setState({ progress: 1, offset: TRIGGER_PX, isRefreshing: true });

    try {
      await onRefresh();
    } finally {
      refreshing.current = false;
      setState({ progress: 0, offset: 0, isRefreshing: false });
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const atTop = () => window.scrollY <= 0;

    const onTouchStart = (e: TouchEvent) => {
      // ARM ONLY AT THE TOP. This is the whole rule. Checking on touchMOVE
      // instead would arm the gesture the moment the user scrolls back to the
      // top mid-drag — which is exactly what they do when flicking upward.
      armed.current = atTop() && !refreshing.current;
      fired.current = false;
      startY.current = e.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!armed.current || startY.current === null || refreshing.current) return;

      const y = e.touches[0]?.clientY;
      if (y === undefined) return;

      const raw = y - startY.current;

      // Pulling UP is a normal scroll. Only downward drags are ours.
      if (raw <= 0) {
        setState((s) => (s.offset === 0 ? s : { ...s, progress: 0, offset: 0 }));
        return;
      }

      // If the page has scrolled away from the top mid-gesture, the user is
      // scrolling, not pulling. Stand down.
      if (!atTop()) {
        armed.current = false;
        setState({ progress: 0, offset: 0, isRefreshing: false });
        return;
      }

      const offset = Math.min(raw / RESISTANCE, MAX_PULL_PX);
      const progress = Math.min(offset / TRIGGER_PX, 1);

      // Fire the haptic when the threshold is CROSSED, once — not on every
      // subsequent move event. A phone buzzing sixty times a second is not
      // feedback, it is a fault.
      if (progress >= 1 && !fired.current) {
        fired.current = true;
        haptic('tap');
      }

      setState({ progress, offset, isRefreshing: false });
    };

    const onTouchEnd = () => {
      const shouldRefresh = armed.current && fired.current;

      armed.current = false;
      startY.current = null;

      if (shouldRefresh) {
        void run();
      } else {
        setState({ progress: 0, offset: 0, isRefreshing: false });
      }
    };

    // Passive: we never preventDefault. `overscroll-behavior-y: contain` in CSS
    // is what stops the browser's own pull-to-refresh — NOT preventDefault, which
    // would also kill normal scrolling and make the page feel broken.
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, run]);

  return state;
}
