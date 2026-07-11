import { RefObject, useCallback, useEffect, useState } from 'react';
import { useResizeObserver } from './use-resize-observer';

/**
 * Compute a `[0..1]` progress value for how far through a scrollable
 * element the user has scrolled. Returns both the current progress
 * and the `updateScrollProgress` callback the consumer wires to the
 * container's `onScroll` handler.
 *
 * ## Why manual onScroll wiring (not an auto-listener)
 *
 * The hook deliberately does NOT register its own scroll listener.
 * The consumer owns the event binding — usually by spreading the
 * callback as `onScroll={updateScrollProgress}` directly on the
 * scrollable element. This keeps the listener local to the exact
 * node being scrolled (avoiding document-level bubbling), lets
 * callers coalesce with other scroll handlers, and stays in sync
 * with the ref's mount/unmount naturally.
 *
 * The hook DOES auto-recompute on resize via the internal
 * {@link useResizeObserver}, because layout changes move the
 * end-of-scroll target without firing a scroll event.
 *
 * ## Edge cases
 *
 *   - Empty container (scrollSize === clientSize): progress is `1`
 *     (nothing to scroll → treat as "fully seen") so opacity / fade
 *     overlays behave sensibly.
 *   - Unmounted ref: updater is a no-op.
 *   - SSR: initial state is `1`; the ResizeObserver's own guard
 *     short-circuits until hydration.
 *
 * ## Usage
 *
 *   const ref = useRef<HTMLDivElement>(null);
 *   const { scrollProgress, updateScrollProgress } = useScrollProgress(ref);
 *   return (
 *     <>
 *       <div ref={ref} onScroll={updateScrollProgress}>...</div>
 *       <Fade opacity={1 - scrollProgress} />
 *     </>
 *   );
 */
export function useScrollProgress(
  ref: RefObject<HTMLElement | null>,
  { direction = 'vertical' }: { direction?: 'vertical' | 'horizontal' } = {},
) {
  const [scrollProgress, setScrollProgress] = useState(1);

  const updateScrollProgress = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const scroll = direction === 'vertical' ? node.scrollTop : node.scrollLeft;
    const scrollSize = direction === 'vertical' ? node.scrollHeight : node.scrollWidth;
    const clientSize = direction === 'vertical' ? node.clientHeight : node.clientWidth;

    setScrollProgress(
      scrollSize === clientSize ? 1 : Math.min(Math.max(scroll / (scrollSize - clientSize), 0), 1),
    );
    // `ref` identity is stable by React contract, so omitting it
    // from deps matches the ref-stability guarantee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction]);

  // Recompute on resize: layout changes can move the scroll end-point
  // without dispatching a scroll event.
  const resizeObserverEntry = useResizeObserver(ref);
  useEffect(() => {
    updateScrollProgress();
  }, [resizeObserverEntry, updateScrollProgress]);

  return { scrollProgress, updateScrollProgress };
}
