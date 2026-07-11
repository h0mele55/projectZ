import { cn } from '@/lib/cn';
import { PropsWithChildren, useRef } from 'react';
import { useScrollProgress } from './hooks/use-scroll-progress';

export function ScrollContainer({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  const ref = useRef<HTMLDivElement>(null);

  const { scrollProgress, updateScrollProgress } = useScrollProgress(ref);

  return (
    <div className="relative">
      <div
        className={cn(
          // clip-path is used to fix a weird bug in WebKit where scrolled-out-of-view content is still interactible
          'scrollbar-hide h-full w-screen max-w-[calc(100vw-0.5rem)] overflow-y-scroll [clip-path:inset(0)] sm:w-auto sm:max-w-none',
          className,
        )}
        ref={ref}
        onScroll={updateScrollProgress}
      >
        {children}
      </div>
      {/* Bottom scroll fade — tokenised so the gradient blends with the
          parent surface regardless of theme. The legacy `from-white`
          broke inside any dark Modal/Sheet body. */}
      <div
        className="from-bg-default pointer-events-none absolute bottom-0 left-0 z-10 hidden h-16 w-full rounded-b-lg bg-gradient-to-t to-transparent sm:block"
        style={{ opacity: 1 - Math.pow(scrollProgress, 2) }}
      />
    </div>
  );
}
