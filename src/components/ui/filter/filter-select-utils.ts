/**
 * Pure decision helpers backing `FilterSelect`.
 *
 * Separated from `filter-select.tsx` so the branching logic is unit-testable
 * under the node-env jest runner (tsconfig `jsx: "preserve"` blocks requiring
 * a `.tsx` file at runtime). Keep these functions React-free and side-effect
 * free — the component composes state around them.
 *
 * Internal module: consumed by `filter-select.tsx`, not exposed from the
 * barrel. Adding these to the public API would duplicate work that
 * `useFilterContext` already performs at the page level.
 */

import { isValidElement, type ReactNode } from 'react';
import type { ActiveFilterInput, Filter, FilterOption } from './types';
import { normalizeActiveFilter, parseRangeToken } from './types';

// ─── single-select decision ──────────────────────────────────────────

/**
 * A filter is single-select when either:
 *  - its definition explicitly sets `singleSelect: true`, OR
 *  - the picker isn't in advanced mode *and* the filter isn't marked
 *    `multiple: true`.
 *
 * `isAdvancedFilter` is FilterSelect's page-level toggle for expert UX — in
 * that mode every non-explicitly-single-select filter becomes multi-select so
 * power users can stack `IS`/`IS_NOT` operators.
 */
export function isSingleSelect(
  filter: Pick<Filter, 'singleSelect' | 'multiple'> | null | undefined,
  opts: { isAdvancedFilter?: boolean } = {},
): boolean {
  if (!filter) return false;
  if (filter.singleSelect) return true;
  return !opts.isAdvancedFilter && !filter.multiple;
}

// ─── per-filter empty-state resolution ───────────────────────────────

/**
 * Type guard: distinguishes a `Record<filterKey, ReactNode>` override map
 * from a single shared `ReactNode` empty-state. Uses React's `isValidElement`
 * so that legitimate element objects don't accidentally read as records.
 */
export function isEmptyStateObject(
  emptyState: ReactNode | Record<string, ReactNode>,
): emptyState is Record<string, ReactNode> {
  return typeof emptyState === 'object' && emptyState !== null && !isValidElement(emptyState);
}

/**
 * Resolve the empty state for the currently-drilled-in filter, falling back
 * to the shared empty state when no per-key override applies. Callers
 * typically pass `selectedFilterKey ?? "default"`.
 */
export function resolveEmptyStateFor(
  emptyState: ReactNode | Record<string, ReactNode> | undefined,
  selectedFilterKey: string | null,
  fallback: ReactNode = 'No matching options',
): ReactNode {
  if (!emptyState) return fallback;
  if (isEmptyStateObject(emptyState)) {
    const key = selectedFilterKey ?? 'default';
    return emptyState[key] ?? fallback;
  }
  return emptyState;
}

// ─── option membership ──────────────────────────────────────────────

/**
 * Is `value` currently one of the selected values for `key` in `activeFilters`?
 * Uses `normalizeActiveFilter` so legacy `{ key, value }` / `{ key, values }`
 * shapes work without the caller converting first.
 */
export function isOptionSelectedIn(
  activeFilters: ActiveFilterInput[] | undefined,
  key: string,
  value: FilterOption['value'],
): boolean {
  if (!activeFilters) return false;
  const raw = activeFilters.find((f) => f.key === key);
  if (!raw) return false;
  return normalizeActiveFilter(raw).values.includes(value);
}

// ─── range helpers ──────────────────────────────────────────────────

/**
 * Does the given range token represent at least one applied bound?
 * The sentinel `"|"` (both ends blank) returns false; `"30|"` / `"|70"` /
 * `"30|70"` return true.
 */
export function hasAppliedRange(token: string | undefined | null): boolean {
  const { min, max } = parseRangeToken(token);
  return min != null || max != null;
}

/**
 * Extract the currently-applied range token for a filter, if any.
 * Returns `undefined` when the filter isn't a range, isn't in active state,
 * or has no values. `normalizeActiveFilter` handles legacy shapes.
 */
export function activeRangeTokenFor(
  filter: Pick<Filter, 'type' | 'key'> | null | undefined,
  activeFilters: ActiveFilterInput[] | undefined,
): string | undefined {
  if (!filter || filter.type !== 'range' || !activeFilters) return undefined;
  const raw = activeFilters.find((f) => f.key === filter.key);
  if (!raw) return undefined;
  const [first] = normalizeActiveFilter(raw).values;
  return typeof first === 'string' ? first : undefined;
}
