'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { PullToRefresh } from './PullToRefresh';
import { ScrollToTop } from './ScrollToTop';

/**
 * The two affordances every long list page wants, in one client island.
 *
 * ─── router.refresh(), not SWR mutate() ──────────────────────────────
 *
 * The obvious wiring for pull-to-refresh is "call the page's SWR mutate()". Our
 * list pages are SERVER COMPONENTS: they have no SWR key, no client cache, and
 * nothing to mutate. The data was fetched on the server and streamed as HTML.
 *
 * `router.refresh()` is the App Router equivalent — it re-runs the server
 * component and streams the new markup in, preserving client state and scroll
 * position. Reaching for SWR here would mean adding a client-side fetch of data
 * the server already has, purely so that pull-to-refresh had something to call.
 *
 * It returns void, so we wrap it in a promise that resolves on the next frame:
 * the refresh indicator must stay up long enough to be seen, or the gesture
 * feels like it did nothing.
 */
export function MobileListAffordances() {
  const router = useRouter();

  const refresh = useCallback(async () => {
    router.refresh();

    // `router.refresh()` is fire-and-forget. Without a small floor the spinner
    // appears and vanishes within a frame, and the user cannot tell whether the
    // pull registered — so they pull again.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }, [router]);

  return (
    <>
      <PullToRefresh onRefresh={refresh} />
      <ScrollToTop />
    </>
  );
}
