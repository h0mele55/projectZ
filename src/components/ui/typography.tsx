/**
 * Typography primitives — PR-3.
 *
 * One source of truth for headings and link styling across the app.
 * Pages should never hand-roll `<h1 className="text-2xl font-bold">`
 * or inline link `hover:text-[var(--brand-default)]` styling — reach
 * for these primitives instead so the type scale stays finite and
 * the design system can evolve in one place.
 *
 * Type scale (deliberately small — three levels for headings, one for
 * the eyebrow label, one for caption text):
 *
 *   <Heading level={1}>        text-2xl semibold (page titles)
 *   <Heading level={2}>        text-lg  semibold (major sections)
 *   <Heading level={3}>        text-sm  semibold (sub-sections / panels)
 *   <Eyebrow>                  text-xs  semibold uppercase tracking-wider muted
 *   <Caption>                  text-sm  muted (descriptive copy)
 *   <TextLink>                 link styling for inline + table cell links
 *
 * Notes:
 *   - Heading L1 weight is `font-semibold` (600), not `font-bold` (700).
 *     Most of the codebase used bold; this is a deliberate, gentle
 *     reduction in visual weight that makes the product feel calmer.
 *   - All colour goes through semantic tokens (`text-content-emphasis`
 *     etc.) so the light theme paints correctly.
 *   - Headings render with the corresponding semantic tag by default
 *     (`level={1}` → `<h1>`, etc.) but can be overridden via `as`
 *     when an outer-level heading already exists in the section.
 */

'use client';

import { cn } from '@/lib/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ElementType,
  type HTMLAttributes,
} from 'react';

// ─── Heading ─────────────────────────────────────────────────────────

const headingVariants = cva('text-content-emphasis', {
  variants: {
    level: {
      1: 'text-2xl font-semibold tracking-tight',
      2: 'text-lg font-semibold',
      3: 'text-sm font-semibold',
    },
    tone: {
      default: 'text-content-emphasis',
      muted: 'text-content-muted',
    },
  },
  defaultVariants: {
    level: 1,
    tone: 'default',
  },
});

type HeadingLevel = 1 | 2 | 3;
type HeadingTone = 'default' | 'muted';
type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div';

interface HeadingProps
  extends
    Omit<HTMLAttributes<HTMLHeadingElement>, 'className'>,
    Omit<VariantProps<typeof headingVariants>, 'level' | 'tone'> {
  /** Visual + semantic level. The rendered tag follows the level by
   * default — override via `as` when the outer level already exists. */
  level?: HeadingLevel;
  /** Element override. Defaults to the `<hN>` matching `level`.
   * Use sparingly: a heading-shaped element that ISN'T a real heading
   * (e.g. inside a card whose card-title is the actual heading) should
   * pass `as="div"` so it doesn't pollute the document outline. */
  as?: HeadingTag;
  tone?: HeadingTone;
  className?: string;
}

const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(function Heading(
  { level = 1, tone = 'default', as, className, children, ...rest },
  ref,
) {
  const Tag = (as ?? (`h${level}` as HeadingTag)) as ElementType;
  return (
    <Tag ref={ref} className={cn(headingVariants({ level, tone }), className)} {...rest}>
      {children}
    </Tag>
  );
});

// ─── Eyebrow ─────────────────────────────────────────────────────────

interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  className?: string;
}

// Roadmap-4 PR-3 — Eyebrow intrinsic styling lock.
//
// Every Eyebrow renders with the same weight / size / tracking /
// color and the same `mb-1` spacing below it. The primitive owns
// all five — consumers never override them via inline className.
//
// Audit found 17 sites passing `mb-1`, 3 passing
// `block mb-1 text-content-subtle`, 2 passing `block mb-2`, 1
// passing `px-3 pt-4 pb-1`. All of those overrides become
// no-ops here (they're already what the primitive does) or
// migrate to a different mechanism (the sidebar's `px-3 pt-4
// pb-1` exists because the eyebrow inside SidebarNav needs
// section padding — handled there separately).
const EYEBROW_INTRINSIC =
  'block mb-1 text-xs font-semibold uppercase tracking-wider text-content-muted';

const Eyebrow = forwardRef<HTMLSpanElement, EyebrowProps>(function Eyebrow(
  { className, children, ...rest },
  ref,
) {
  return (
    <span ref={ref} className={cn(EYEBROW_INTRINSIC, className)} {...rest}>
      {children}
    </span>
  );
});

// ─── Caption ─────────────────────────────────────────────────────────

interface CaptionProps extends HTMLAttributes<HTMLParagraphElement> {
  className?: string;
}

const Caption = forwardRef<HTMLParagraphElement, CaptionProps>(function Caption(
  { className, children, ...rest },
  ref,
) {
  return (
    <p ref={ref} className={cn('text-content-muted text-sm', className)} {...rest}>
      {children}
    </p>
  );
});

// ─── TextLink ────────────────────────────────────────────────────────

const textLinkVariants = cva(
  'inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:rounded-sm',
  {
    variants: {
      tone: {
        default: 'text-content-emphasis font-medium hover:text-[var(--brand-default)]',
        muted: 'text-content-muted hover:text-content-emphasis',
        brand: 'text-[var(--brand-default)] hover:text-[var(--brand-emphasis)]',
        // Roadmap-4 PR-10 — `link` is the conventional inline-link
        // affordance: brand-coloured at rest, brand-emphasis +
        // underlined on hover. Use when the surrounding paragraph
        // reads "click here to ..." — i.e. the link is mid-text and
        // the click target needs visual affirmation. The other
        // tones (default, muted, brand) are for chrome (sidebar
        // nav, headings, table cell links) where the click target
        // is already communicated by the layout context.
        link: 'text-[var(--brand-default)] hover:text-[var(--brand-emphasis)] hover:underline',
        underline: 'text-content-default underline underline-offset-2 hover:text-content-emphasis',
      },
    },
    defaultVariants: {
      tone: 'default',
    },
  },
);

interface TextLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>, VariantProps<typeof textLinkVariants> {
  className?: string;
}

const TextLink = forwardRef<HTMLAnchorElement, TextLinkProps>(function TextLink(
  { className, tone = 'default', children, ...rest },
  ref,
) {
  return (
    <a ref={ref} className={cn(textLinkVariants({ tone }), className)} {...rest}>
      {children}
    </a>
  );
});

export { Heading, Eyebrow, Caption, TextLink, headingVariants, textLinkVariants };
export type { HeadingProps, EyebrowProps, CaptionProps, TextLinkProps };
