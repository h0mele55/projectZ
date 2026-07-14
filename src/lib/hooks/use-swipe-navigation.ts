'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Swipe left/right to move between tabs.
 *
 * ═══ THE THING THAT MAKES THIS HARD ═══
 *
 * A horizontal swipe is not an unambiguous gesture. The user might mean
 * "next tab" — or they might mean "scroll this table sideways", "pan this map",
 * or "swipe this carousel". If we claim every horizontal drag, we BREAK all
 * three, and the user cannot reach the columns of a table they can plainly see.
 *
 * So a swipe that STARTS on a horizontally-scrollable element is not ours. We
 * walk up from the touch target looking for something that can scroll
 * horizontally, and if we find one we let the browser have the gesture.
 *
 * That check has to be on the START of the touch, not the end: by the time the
 * finger lifts, the table has already scrolled and the damage is done.
 *
 * ═══ AND THE ONE THAT MAKES IT ANNOYING ═══
 *
 * A vertical scroll is never perfectly vertical. Every downward flick has some
 * horizontal component, and a naive threshold turns "scroll the page" into
 * "change tab" — which is infuriating, because the user did not ask for it and
 * cannot see what they did wrong.
 *
 * So the gesture must be DOMINANTLY horizontal: |dx| must clearly exceed |dy|.
 */

const SWIPE_THRESHOLD_PX = 50;

/**
 * How much more horizontal than vertical the drag must be.
 *
 * At 1.5, a swipe 75px across and 50px down is still a tab change; one 60px
 * across and 50px down is a scroll. Requiring pure horizontality (a ratio of,
 * say, 4) makes the gesture feel broken; accepting anything above 1 makes the
 * page unusable.
 */
const HORIZONTAL_DOMINANCE = 1.5;

/** Can this element scroll sideways right now? */
function isHorizontallyScrollable(el: Element): boolean {
  const style = window.getComputedStyle(el);
  const overflowX = style.overflowX;

  if (overflowX !== 'auto' && overflowX !== 'scroll') return false;

  // …and has content to scroll. An `overflow-x-auto` container whose content
  // fits is not scrollable, and swallowing the gesture for it would disable
  // swipe on most of the app.
  return el.scrollWidth > el.clientWidth + 1;
}

/** Walk up from the touch target looking for something that owns the gesture. */
function startedOnScrollableChild(target: EventTarget | null, root: Element): boolean {
  let el = target instanceof Element ? target : null;

  while (el && el !== root) {
    if (isHorizontallyScrollable(el)) return true;
    el = el.parentElement;
  }

  return false;
}

export interface SwipeNavigationOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Set false to disable entirely (e.g. when there is nothing to swipe to). */
  enabled?: boolean;
}

export function useSwipeNavigation(
  ref: RefObject<HTMLElement | null>,
  { onSwipeLeft, onSwipeRight, enabled = true }: SwipeNavigationOptions,
): void {
  const start = useRef<{ x: number; y: number; claimed: boolean } | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;

      // Multi-touch is a pinch-zoom, not a swipe. Claiming it would fight the
      // user trying to read a map.
      if (e.touches.length > 1) {
        start.current = null;
        return;
      }

      start.current = {
        x: touch.clientX,
        y: touch.clientY,
        // Decide ownership at the START. By the time the finger lifts, the table
        // under it has already scrolled.
        claimed: !startedOnScrollableChild(e.target, node),
      };
    };

    const onTouchEnd = (e: TouchEvent) => {
      const from = start.current;
      start.current = null;

      if (!from || !from.claimed) return;

      const touch = e.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;

      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;

      // Dominantly horizontal, or it was a scroll that happened to drift.
      if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_DOMINANCE) return;

      // Swiping LEFT (finger moves left, dx negative) means "show me the next
      // one" — the content slides in from the right, exactly as a native pager
      // behaves. Getting this backwards is the kind of thing that feels wrong
      // instantly and is hard to name.
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    };

    // `passive: true` — we never call preventDefault, so telling the browser that
    // up front means it does not have to wait for us before scrolling. Omitting
    // it makes every scroll on the page janky.
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchend', onTouchEnd);
    };
  }, [ref, onSwipeLeft, onSwipeRight, enabled]);
}
