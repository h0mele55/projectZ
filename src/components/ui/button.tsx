'use client';

import { cn } from '@/lib/cn';
import { VariantProps } from 'class-variance-authority';
import { ReactNode, forwardRef } from 'react';
import { LoadingSpinner } from './icons';
import { Tooltip } from './tooltip';
import { buttonVariants } from './button-variants';

export { buttonVariants };

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  text?: ReactNode | string;
  textWrapperClassName?: string;
  shortcutClassName?: string;
  loading?: boolean;
  icon?: ReactNode;
  shortcut?: string;
  right?: ReactNode;
  disabledTooltip?: string | ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      text,
      variant = 'primary',
      size,
      className,
      textWrapperClassName,
      shortcutClassName,
      loading,
      icon,
      shortcut,
      disabledTooltip,
      right,
      children,
      ...props
    }: ButtonProps,
    forwardedRef,
  ) => {
    const content = text ?? children;

    if (disabledTooltip) {
      return (
        <Tooltip content={disabledTooltip}>
          <div
            className={cn(
              'flex cursor-not-allowed items-center justify-center gap-x-2',
              // R22-PR-A — radius mirror (12→10px).
              'border-border-subtle bg-bg-subtle text-content-subtle rounded-full border text-sm',
              // R20-PR-C — horizontal padding mirrors the airy
              // density scale (xs/sm don't size up; md/lg do).
              // R20-PR-E — graded font-weight ladder also mirrors
              // the cva size scale.
              // R20-PR-F density correction: md px-4→px-3, lg px-6→px-4.
              // button-density-tighter (2026-05-15) second pass:
              // xs → px-2, sm/md → px-2.5, lg → px-3.
              size === 'xs' && 'h-7 px-2 text-[11px] font-medium',
              size === 'sm' && 'h-8 px-2.5 text-xs font-medium',
              size === 'lg' && 'h-10 px-3 font-bold',
              !size && 'h-9 px-2.5 font-semibold',
              className,
            )}
          >
            {icon}
            {content && (
              <div
                className={cn(
                  'min-w-0 truncate',
                  // Icons passed as CHILDREN (e.g. <Button><Mail/>Invite</Button>
                  // or a brand <svg>) land in this label div. Tailwind's
                  // preflight makes `svg { display: block }`, which stacks
                  // the icon ABOVE the text on its own row. Force any direct
                  // svg child inline so icon + text share one row, vertically
                  // centred, with a small gap to whichever side the text is on.
                  // The canonical `icon` prop renders OUTSIDE this div and is
                  // unaffected; text-only labels still truncate normally.
                  '[&>svg]:inline-block [&>svg]:align-middle',
                  '[&>svg:not(:first-child)]:ml-1.5 [&>svg:not(:last-child)]:mr-1.5',
                  shortcut && 'flex-1 text-left',
                  textWrapperClassName,
                )}
              >
                {content}
              </div>
            )}
            {shortcut && (
              <kbd
                className={cn(
                  'border-border-subtle bg-bg-subtle text-content-subtle hidden rounded border px-2 py-0.5 text-xs font-light md:inline-block',
                  shortcutClassName,
                )}
              >
                {shortcut}
              </kbd>
            )}
          </div>
        </Tooltip>
      );
    }

    return (
      <button
        ref={forwardedRef}
        type={props.onClick ? 'button' : 'submit'}
        className={cn(
          props.disabled || loading
            ? cn(
                'gap-tight flex items-center justify-center whitespace-nowrap',
                // R22-PR-A — radius mirror (12→10px).
                'border-border-subtle bg-bg-subtle text-content-subtle rounded-full border',
                'cursor-not-allowed text-sm outline-none',
                // R20-PR-C — mirror the airy density scale from
                // button-variants.ts. These classes drive the disabled
                // branch which does NOT route through the cva variant
                // (cn-only fallback for a non-interactive shape), so
                // they must move in lockstep. The R20-PR-C ratchet
                // asserts the two scales agree.
                //
                // R20-PR-E — graded font-weight ladder also mirrored
                // here (medium for xs/sm, semibold for md, bold for
                // lg). Locked by the R20-PR-E ratchet.
                //
                // R20-PR-F — density correction. md/lg tightened
                // (px-4→px-3 and px-6→px-4; lg gap-2.5→gap-tight)
                // because the PR-C airy padding read as "idle space"
                // on dense toolbars. Locked by R20-PR-F ratchet.
                //
                // button-density-tighter (2026-05-15) — second
                // tightening pass; mirrors the cva size scale.
                size === 'xs' && 'h-7 gap-1 rounded-md px-2 text-[11px] font-medium',
                size === 'sm' && 'h-8 gap-1.5 px-2.5 text-xs font-medium',
                size === 'lg' && 'gap-tight h-10 px-3 font-bold',
                !size && 'gap-tight h-9 px-2.5 font-semibold',
              )
            : buttonVariants({ variant, size }),
          className,
        )}
        disabled={props.disabled || loading}
        {...props}
      >
        {/**
         * Label centering (2026-05-31).
         *
         * The button is `justify-center` and hugs its content
         * (inline-flex, no forced width), so the WHOLE content unit —
         * `[icon][gap][label]` — is centred as one symmetric group
         * with equal padding on both sides. A leading `+ Asset`
         * therefore reads as a tidy centred unit (the `+` counted with
         * the word), not the word alone centred with the icon hanging
         * off-centre to the left.
         *
         * An earlier approach mirrored each side weight with an
         * invisible "balance ghost" to centre the LABEL (treating a
         * leading icon as decoration). That was reverted on user
         * feedback: the ghosts widened the button with one-sided blank
         * space and the `+ word` unit didn't read as centred. The
         * simplest correct rule — centre the content unit, no ghosts —
         * is what ships now. `shortcut` buttons remain the one
         * intentional exception (label left, kbd right) via the
         * `flex-1 text-left` wrapper below.
         */}
        {loading ? <LoadingSpinner className="h-4 w-4" /> : icon ? icon : null}
        {content && (
          <div
            className={cn(
              'min-w-0 truncate',
              // Icons passed as CHILDREN (e.g. <Button><Mail/>Invite</Button>
              // or a brand <svg>) land in this label div. Tailwind's
              // preflight makes `svg { display: block }`, stacking the icon
              // ABOVE the text on its own row. Force any direct svg child
              // inline so icon + text share one row, vertically centred,
              // with a small gap to whichever side the text is on. The
              // canonical `icon` prop renders OUTSIDE this div and is
              // unaffected; text-only labels still truncate normally.
              '[&>svg]:inline-block [&>svg]:align-middle',
              '[&>svg:not(:first-child)]:ml-1.5 [&>svg:not(:last-child)]:mr-1.5',
              shortcut && 'flex-1 text-left',
              textWrapperClassName,
            )}
          >
            {content}
          </div>
        )}
        {shortcut && (
          <kbd
            className={cn(
              'hidden rounded px-2 py-0.5 text-xs font-light transition-all duration-75 md:inline-block',
              {
                'bg-[var(--brand-default)] text-white/70 group-hover:bg-[var(--brand-muted)]':
                  variant === 'primary',
                'bg-bg-elevated text-content-muted': variant === 'secondary',
                'bg-bg-muted text-content-muted': variant === 'ghost',
                'bg-black/25 text-white/80': variant === 'destructive',
                'bg-bg-error text-content-error': variant === 'destructive-outline',
              },
              shortcutClassName,
            )}
          >
            {shortcut}
          </kbd>
        )}
        {right}
      </button>
    );
  },
);

Button.displayName = 'Button';

export { Button };
