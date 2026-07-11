import { cn } from '@/lib/cn';

/**
 * R22-PR-D — `background: "gray"` was hardcoded on every spinner
 * segment, so the spinner read the same washed grey regardless of
 * the surrounding context (primary button with white text → grey
 * spinner = visual mismatch). Switching to `currentColor` lets the
 * spinner inherit the parent's text colour: a primary loading
 * button now spins WHITE, a secondary spins in
 * `text-content-emphasis`, a destructive spins WHITE on red, a
 * ghost spins in its muted text tone. One token,
 * variant-aware automatically.
 */
export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('h-5 w-5', className)}>
      <div
        style={{
          position: 'relative',
          top: '50%',
          left: '50%',
        }}
        className={cn('loading-spinner', 'h-5 w-5', className)}
      >
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            style={{
              animationDelay: `${-1.2 + 0.1 * i}s`,
              background: 'currentColor',
              position: 'absolute',
              borderRadius: '1rem',
              width: '30%',
              height: '8%',
              left: '-10%',
              top: '-4%',
              transform: `rotate(${30 * i}deg) translate(120%)`,
            }}
            className="animate-spinner"
          />
        ))}
      </div>
    </div>
  );
}
