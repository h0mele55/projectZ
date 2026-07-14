'use client';

/**
 * `EntityDetailLayout` — reusable detail-page shell.
 *
 * Inflect's domain detail pages (controls, risks, policies, vendors,
 * audits, …) share a structural pattern even though their content
 * differs sharply: a back link, a title, a meta row of badges, a
 * right-side action area, an optional tab bar, and a content slot
 * that swaps based on the active tab. The shell extracts those
 * shared concerns into one component so future detail pages adopt
 * a consistent shape without a copy-paste header.
 *
 * What this is NOT:
 *
 *   - A JSON-driven generic "render any entity" meta-framework.
 *     Domain-specific panels (TraceabilityPanel, LinkedTasksPanel,
 *     TestPlansPanel, the controls-overview metadata grid, the
 *     risk inherent-vs-residual scorer) STAY in the page that
 *     owns them. The shell carries layout, not business content.
 *
 *   - A renderer that decides which tabs to show. The page provides
 *     the tab list + active tab + change handler; the shell paints
 *     them.
 *
 *   - A data fetcher. Pages run their own queries and pass the
 *     resulting `loading` / `error` / `empty` flags to the shell.
 *
 * Visual: stays inside the existing token vocabulary (no new colour
 * scales). Header layout matches the prior controls page. Tabs use
 * the same active-bar pattern (border-b accent + emphasis text).
 *
 * The same shell handles the "no tabs" case (simply omit the `tabs`
 * prop) — useful for risks-style pages that stack sections instead.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cardVariants } from '@/components/ui/card';

import { cn } from '@/lib/cn';
import { scrollBehavior, usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';
import { useSwipeNavigation } from '@/lib/hooks/use-swipe-navigation';
import { type BreadcrumbItem } from '@/components/ui/breadcrumbs';
import { PageHeader } from '@/components/layout/PageHeader';

// ─── Tab descriptor ───────────────────────────────────────────────

export interface EntityDetailTab<TKey extends string = string> {
  /** Stable identifier for the tab. Drives `activeTab` matching. */
  key: TKey;
  /** Visible tab label. */
  label: string;
  /** Optional count badge (e.g. tasks count). Hidden when undefined. */
  count?: number;
  /** When true, the tab is disabled (greyed, not clickable). */
  disabled?: boolean;
}

// ─── Public props ────────────────────────────────────────────────

export interface EntityDetailLayoutProps<TKey extends string = string> {
  /**
   * Breadcrumb trail rendered ABOVE the title. When supplied, prefer
   * this over `back` — breadcrumbs convey ancestor depth that a single
   * back link can't. The two are not mutually exclusive: passing both
   * shows breadcrumbs above + the back link below them, but the
   * canonical pattern is to use one or the other.
   */
  breadcrumbs?: ReadonlyArray<BreadcrumbItem>;
  /**
   * Back-navigation affordance rendered above the title. Two forms:
   *
   *   - `{ href, label }` — static link (legacy, still supported).
   *   - `{ smart: true }` — RQ4-4 smart back affordance: forwards to
   *     `<PageHeader>` which mounts `<BackAffordance>`, resolving the
   *     destination from the in-tab referrer (or canonical parent on
   *     a cold load / deep link).
   */
  back?: { href: string; label: string } | { smart: true };
  /** Title of the detail page. Plain string OR rich element. */
  title: ReactNode;
  /**
   * Meta row beneath the title — typically a row of status badges
   * (status / applicability / sync state). Optional.
   */
  meta?: ReactNode;
  /**
   * Right-side action area in the header — typically status
   * combobox + primary action buttons. Optional.
   */
  actions?: ReactNode;

  // ── Lifecycle ─────────────────────────────────────────────────

  /**
   * When true, render the loading skeleton instead of the body.
   * The skeleton mirrors the eventual layout (header + tab bar +
   * content card) so the page doesn't visibly "jump" on load.
   */
  loading?: boolean;
  /**
   * Inline error message rendered in place of the body. The shell
   * intentionally does NOT echo back arbitrary error JSON — the
   * caller passes the user-facing string.
   */
  error?: string | null;
  /**
   * Empty-state copy rendered when the entity wasn't found. Pass a
   * string for the default rendering or omit for "Not found.".
   */
  empty?: {
    message: string;
  } | null;

  // ── Tab bar ───────────────────────────────────────────────────

  /**
   * Tab list. Omit for pages that don't use tabs (the shell
   * renders children directly under the header).
   */
  tabs?: ReadonlyArray<EntityDetailTab<TKey>>;
  /** Currently selected tab key. Required when `tabs` is provided. */
  activeTab?: TKey;
  /** Tab-change handler. Required when `tabs` is provided. */
  onTabChange?: (tab: TKey) => void;

  // ── Body ─────────────────────────────────────────────────────

  /** Outer wrapper className override. */
  className?: string;
  /** Stable id forwarded to the outer container (for E2E selectors). */
  id?: string;
  /**
   * Page body. When tabs are configured this is the active tab's
   * content; the page typically conditionally renders based on
   * `activeTab`. When tabs are omitted, this is the entire body.
   */
  children: ReactNode;
  /**
   * Roadmap-2 PR-5 — opt-in master-detail right rail.
   *
   * When supplied AND the viewport is ≥ `xl` (1280px), the body
   * renders as a 2-column grid: main content 1fr, rail 320px,
   * gap-default between, both columns scrollable independently.
   * Below `xl` the rail collapses below the main column —
   * mobile and small desktops keep the current single-column
   * behaviour.
   *
   * Use this slot for content that ABOUT the entity but is not
   * the entity itself: linked tasks, recent activity, quick
   * actions, related entities. Anything the user would want
   * to act on without losing place inside the main content.
   *
   * Pages that don't need a rail simply don't pass it — the
   * shell falls back to the prior single-column shape and no
   * test or call site changes.
   */
  rail?: ReactNode;
}

// ─── Component ──────────────────────────────────────────────────

export function EntityDetailLayout<TKey extends string = string>({
  breadcrumbs,
  back,
  title,
  meta,
  actions,
  loading,
  error,
  empty,
  tabs,
  activeTab,
  onTabChange,
  className,
  id,
  children,
  rail,
}: EntityDetailLayoutProps<TKey>) {
  const t = useTranslations('common');

  const tabStripRef = useRef<HTMLElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  /**
   * BRING THE ACTIVE TAB INTO VIEW.
   *
   * The strip is `overflow-x-auto`, so with six tabs on a phone only the first
   * two or three are visible. Deep-link to the fifth — which is exactly what a
   * notification link or a shared URL does — and the user lands on a page whose
   * selected tab is off-screen. The content is right and nothing on screen says
   * why, so it reads as the wrong page.
   *
   * `inline: 'nearest'` scrolls the strip horizontally by the least amount that
   * makes the tab visible. `block: 'nearest'` is the part people forget: without
   * it the browser also scrolls the PAGE vertically to centre the tab, yanking
   * the user away from the content they came to read.
   */
  useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip || !activeTab) return;

    const active = strip.querySelector<HTMLElement>(`#tab-${CSS.escape(String(activeTab))}`);
    if (!active) return;

    active.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      // A smooth scroll is the browser's own behaviour, NOT a CSS transition —
      // the global prefers-reduced-motion override in globals.css cannot reach
      // it. It would happily animate at a user who has asked it not to.
      behavior: scrollBehavior(prefersReducedMotion),
    });
  }, [activeTab, prefersReducedMotion]);

  /**
   * SWIPE BETWEEN TABS.
   *
   * Native tab views page sideways; a web app that does not feels like a website
   * with tabs drawn on it.
   *
   * The gesture is deliberately NOT claimed when it starts on a horizontally
   * scrollable child — a wide table, a map. Otherwise the user cannot reach the
   * columns of a table they can plainly see, because every attempt changes the
   * tab instead. See use-swipe-navigation.ts.
   */
  const panelRef = useRef<HTMLDivElement | null>(null);

  const tabIndex = tabs && activeTab ? tabs.findIndex((tab) => tab.key === activeTab) : -1;

  const goToTab = (delta: number) => {
    if (!tabs || tabIndex < 0 || !onTabChange) return;

    // Do NOT wrap around. A swipe past the last tab landing on the first is
    // disorienting: the user swipes "forward" and travels backwards through the
    // whole strip. Native pagers stop at the ends, and so do we.
    const next = tabs[tabIndex + delta];
    if (!next || next.disabled) return;

    onTabChange(next.key);
  };

  useSwipeNavigation(panelRef, {
    enabled: Boolean(tabs && tabs.length > 1 && onTabChange),
    onSwipeLeft: () => goToTab(1),
    onSwipeRight: () => goToTab(-1),
  });
  // v2-fu-4 — render the breadcrumbs / back link in EVERY state
  // (loading / error / empty / main). Previously the loading
  // skeleton, error block, and empty block returned early before
  // the PageHeader was rendered, leaving the user without any
  // navigation affordance for the duration of the data fetch.
  // The header is now always present; only the body changes.
  const headerNode = (
    <PageHeader
      breadcrumbs={breadcrumbs}
      back={back}
      title={loading || error || empty ? '' : title}
      meta={loading || error || empty ? undefined : meta}
      actions={loading || error || empty ? undefined : actions}
      data-testid="entity-detail-header"
    />
  );

  if (loading) {
    return (
      <div
        className={cn('space-y-section animate-fadeIn', className)}
        aria-busy="true"
        data-entity-detail-layout
        data-testid="entity-detail-loading"
      >
        {headerNode}
        <DetailLoadingSkeleton tabCount={tabs?.length ?? 4} />
      </div>
    );
  }
  if (error) {
    return (
      <div className={cn('space-y-section animate-fadeIn', className)} data-entity-detail-layout>
        {headerNode}
        <div
          className="text-content-error p-12 text-center"
          role="alert"
          data-testid="entity-detail-error"
        >
          {error}
        </div>
      </div>
    );
  }
  if (empty) {
    return (
      <div className={cn('space-y-section animate-fadeIn', className)} data-entity-detail-layout>
        {headerNode}
        <div
          className="text-content-subtle p-12 text-center text-sm"
          data-testid="entity-detail-empty"
        >
          {empty.message}
        </div>
      </div>
    );
  }

  return (
    <div
      id={id}
      className={cn('space-y-section animate-fadeIn', className)}
      data-entity-detail-layout
    >
      {/* Header */}
      {headerNode}

      {/* Tab bar (optional) */}
      {tabs && tabs.length > 0 && (
        <nav
          ref={tabStripRef}
          className="border-border-default flex gap-1 overflow-x-auto border-b"
          role="tablist"
          aria-label={t('table.detailSections')}
          data-testid="entity-detail-tabs"
        >
          {tabs.map((t) => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${t.key}`}
                disabled={t.disabled}
                className={cn(
                  'border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition',
                  isActive
                    ? 'text-content-emphasis border-[var(--brand-default)]'
                    : 'text-content-muted hover:text-content-emphasis border-transparent',
                  t.disabled && 'cursor-not-allowed opacity-50',
                )}
                onClick={() => {
                  if (!t.disabled && onTabChange) onTabChange(t.key);
                }}
                data-testid={`tab-${t.key}`}
                id={`tab-${t.key}`}
              >
                {t.label}
                {t.count !== undefined && <TabCount value={t.count} />}
              </button>
            );
          })}
        </nav>
      )}

      {/* Body — wraps in a 2-column grid when a `rail` slot
                is provided (Roadmap-2 PR-5). The grid kicks in at
                `xl` (1280px); below that the rail stacks under the
                main column so phones/laptops keep the prior
                single-column shape.

                PR-12: every body container carries
                `space-y-section` so multiple sibling cards
                (risk-detail, traceability, treatment plan, …)
                breathe at the canonical 32px rhythm. Without it
                the cards rendered with zero vertical gap between
                them — pages that own multi-card stacks looked
                fused together. */}
      {rail ? (
        // Right-rail roadmap Phase 1 — a flex row, not a
        // fixed-track grid: the rail's width is owned by the
        // rail content (`<AsidePanel>` renders 320px expanded
        // or 44px collapsed), so collapsing the panel reflows
        // the main column with no shared state. Below xl the
        // row stacks; `<AsidePanel>` itself degrades to a
        // `<Sheet>` there.
        <div
          className="gap-default flex flex-col xl:flex-row"
          data-testid="entity-detail-rail-grid"
        >
          {tabs && activeTab ? (
            <div
              role="tabpanel"
              id={`tabpanel-${activeTab}`}
              aria-labelledby={`tab-${activeTab}`}
              data-testid="entity-detail-tabpanel"
              className="space-y-section min-w-0 xl:flex-1"
            >
              {children}
            </div>
          ) : (
            <div data-testid="entity-detail-body" className="space-y-section min-w-0 xl:flex-1">
              {children}
            </div>
          )}
          <aside
            className="space-y-default flex-shrink-0 xl:sticky xl:top-20 xl:self-start"
            aria-label={t('table.context')}
            data-testid="entity-detail-rail"
          >
            {rail}
          </aside>
        </div>
      ) : tabs && activeTab ? (
        <div
          ref={panelRef}
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          data-testid="entity-detail-tabpanel"
          className="space-y-section"
        >
          {children}
        </div>
      ) : (
        <div data-testid="entity-detail-body" className="space-y-section">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Tab count ────────────────────────────────────────────────────
//
// Roadmap-4 PR-7 — canonical tab-count rendering.
//
// Tab labels carry an optional count (e.g. "Tasks (12)") that
// communicates "how many things will I find under this tab". The
// rendering is centralised here for two reasons:
//
//   1. Visual consistency. The count sits one step weaker than the
//      label's tone — `text-xs` (vs `text-sm` on the label) plus
//      `opacity-60` so the count dims relative to whatever tone the
//      label inherited (selected = emphasis, unselected = muted).
//      The opacity-on-inherit trick is deliberate: a fixed
//      `text-content-subtle` would look the same regardless of
//      selection state, killing the active-tab affordance.
//
//   2. Digit-width stability. `tabular-nums` keeps every digit at
//      the same width, so a count that ticks 9 → 10 doesn't shift
//      the tab-bar layout sideways. The detail page no longer
//      twitches as live counts update in the background.
//
// New tab bars MUST mount this helper instead of hand-rolling the
// `({n})` shape — the ratchet at
// `tests/guards/tab-count-discipline.test.ts` enforces that and the
// class string above.

function TabCount({ value }: { value: number }) {
  return (
    <span className="ml-1 text-xs tabular-nums opacity-60" data-tab-count>
      ({value})
    </span>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────
//
// Pulled out so test code can mount it directly + so the shell
// doesn't grow JSX at the top of its render. The skeleton mirrors
// the layout: header + tab bar + content card.

function DetailLoadingSkeleton({ tabCount }: { tabCount: number }) {
  // v2-fu-4 — the surrounding wrapper + breadcrumbs/back link are
  // owned by the parent `<EntityDetailLayout>` so the skeleton can
  // focus on the body shape (title placeholder + tab strip + content
  // card). The header (breadcrumbs + back) renders unchanged in all
  // states, giving the user navigation affordance during the fetch.
  return (
    <>
      <div className="space-y-tight">
        <div className="bg-bg-elevated/60 h-7 w-64 animate-pulse rounded" />
      </div>
      <div className="border-border-default flex gap-1 border-b">
        {Array.from({ length: tabCount }).map((_, i) => (
          <div key={i} className="bg-bg-elevated/60 mx-1 h-8 w-20 animate-pulse rounded" />
        ))}
      </div>
      <div className={cn(cardVariants(), 'space-y-default')}>
        <div className="gap-section grid grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="bg-bg-elevated/60 h-3 w-16 animate-pulse rounded" />
              <div className="bg-bg-elevated/60 h-4 w-full animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
