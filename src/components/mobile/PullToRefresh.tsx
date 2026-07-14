'use client';

import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { usePullToRefresh } from '@/lib/hooks/use-pull-to-refresh';

/**
 * The pull-to-refresh affordance.
 *
 * The hook owns the gesture; this owns the pixels. See use-pull-to-refresh.ts —
 * in particular the rule that it only arms when the page is ALREADY at the top,
 * without which the list reloads under a user who was merely scrolling up.
 */
export function PullToRefresh({
  onRefresh,
  enabled = true,
}: {
  onRefresh: () => Promise<unknown>;
  enabled?: boolean;
}) {
  const { progress, offset, isRefreshing } = usePullToRefresh(onRefresh, { enabled });

  if (progress === 0 && !isRefreshing) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
      style={{
        // Follows the finger. `translateY` and not `top`, because a transform is
        // composited and does not force layout on every touchmove — the
        // difference between a gesture that tracks the thumb and one that lags.
        transform: `translateY(${offset}px)`,
      }}
    >
      <div
        className={cn(
          'bg-bg-elevated border-border-strong mt-2 flex size-9 items-center justify-center',
          'rounded-full border shadow-lg',
        )}
        style={{
          // Fades in as the pull deepens, so the user can see how close they are
          // to the threshold rather than guessing.
          opacity: Math.min(progress, 1),
        }}
      >
        <Loader2
          className={cn('text-content-muted size-4', isRefreshing && 'animate-spin')}
          style={
            isRefreshing
              ? undefined
              : // Before it fires, the spinner ROTATES WITH THE PULL. That is the
                // affordance: it tells the user the gesture is being received and
                // how much further to go.
                { transform: `rotate(${progress * 270}deg)` }
          }
          aria-hidden
        />
      </div>
    </div>
  );
}
