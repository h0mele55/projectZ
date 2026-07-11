/**
 * Filter State — pure functions for managing filter state and URL synchronization.
 *
 * This module bridges the enterprise filter type system (Filter/ActiveFilter)
 * with URL-driven state management (useUrlFilters). All functions are pure,
 * framework-agnostic, and fully testable without React.
 *
 * Architecture:
 *   URL params ←→ FilterState ←→ ActiveFilter[] ←→ Filter UI
 */

import type { ActiveFilter, FilterOption } from './types';

// ── Types ───────────────────────────────────────────────────────────

/**
 * The serializable state of all active filters.
 * Keys are filter keys, values are arrays of selected values.
 *
 * Example:
 *   { status: ["OPEN", "IN_PROGRESS"], category: ["Technical"] }
 */
export type FilterState = Record<string, string[]>;

/**
 * Configuration for URL parameter serialization.
 */
export interface FilterUrlConfig {
  /** Separator for multi-value params. Default: "," */
  separator?: string;
  /** Prefix for filter params (e.g., "f_" → "f_status=OPEN"). Default: "" */
  prefix?: string;
  /** Additional URL params to preserve when syncing (e.g., "q", "cursor"). */
  preserveParams?: string[];
}

// ── URL ↔ FilterState ───────────────────────────────────────────────

/**
 * Parse URL search params into a FilterState.
 *
 * @param searchParams - URLSearchParams or raw query string
 * @param filterKeys - The filter keys to extract
 * @param config - URL serialization config
 */
export function parseUrlToFilterState(
  searchParams: URLSearchParams | string,
  filterKeys: string[],
  config: FilterUrlConfig = {},
): FilterState {
  const params =
    typeof searchParams === 'string' ? new URLSearchParams(searchParams) : searchParams;

  const sep = config.separator ?? ',';
  const prefix = config.prefix ?? '';
  const state: FilterState = {};

  for (const key of filterKeys) {
    const paramKey = `${prefix}${key}`;
    const raw = params.get(paramKey);
    if (raw) {
      state[key] = raw.split(sep).filter(Boolean);
    }
  }

  return state;
}

/**
 * Serialize a FilterState into URLSearchParams.
 *
 * @param state - The filter state to serialize
 * @param config - URL serialization config
 * @param existingParams - Optional existing params to merge with
 */
export function filterStateToUrlParams(
  state: FilterState,
  config: FilterUrlConfig = {},
  existingParams?: URLSearchParams,
): URLSearchParams {
  const params = existingParams ? new URLSearchParams(existingParams) : new URLSearchParams();

  const sep = config.separator ?? ',';
  const prefix = config.prefix ?? '';

  // Remove old filter params
  for (const key of Object.keys(state)) {
    params.delete(`${prefix}${key}`);
  }

  // Set new values
  for (const [key, values] of Object.entries(state)) {
    const paramKey = `${prefix}${key}`;
    if (values.length > 0) {
      params.set(paramKey, values.join(sep));
    } else {
      params.delete(paramKey);
    }
  }

  return params;
}

// ── FilterState ↔ ActiveFilter[] ────────────────────────────────────

/**
 * Convert FilterState into ActiveFilter[] for use with Filter.Select/Filter.List.
 */
export function filterStateToActiveFilters(state: FilterState): ActiveFilter[] {
  return Object.entries(state)
    .filter(([, values]) => values.length > 0)
    .map(([key, values]) => ({
      key,
      values,
      operator: values.length > 1 ? ('IS_ONE_OF' as const) : ('IS' as const),
    }));
}

/**
 * Convert ActiveFilter[] back into FilterState.
 */
export function activeFiltersToFilterState(activeFilters: ActiveFilter[]): FilterState {
  const state: FilterState = {};
  for (const filter of activeFilters) {
    if (filter.values.length > 0) {
      state[filter.key] = filter.values.map(String);
    }
  }
  return state;
}

// ── State Mutation Helpers ──────────────────────────────────────────

/**
 * Add a value to a filter key. Returns a new FilterState.
 */
export function addFilterValue(
  state: FilterState,
  key: string,
  value: string | string[],
): FilterState {
  const existing = state[key] ?? [];
  const toAdd = Array.isArray(value) ? value : [value];
  const newValues = [...new Set([...existing, ...toAdd])];
  return { ...state, [key]: newValues };
}

/**
 * Remove a value from a filter key. Returns a new FilterState.
 * Removes the key entirely if no values remain.
 */
export function removeFilterValue(state: FilterState, key: string, value: string): FilterState {
  const existing = state[key] ?? [];
  const newValues = existing.filter((v) => v !== value);
  if (newValues.length === 0) {
    const { [key]: _, ...rest } = state;
    return rest;
  }
  return { ...state, [key]: newValues };
}

/**
 * Remove all values for a filter key. Returns a new FilterState.
 */
export function removeFilter(state: FilterState, key: string): FilterState {
  const { [key]: _, ...rest } = state;
  return rest;
}

/**
 * Clear all filters. Returns an empty FilterState.
 */
export function clearAllFilters(): FilterState {
  return {};
}

/**
 * Toggle a value in a filter key (add if missing, remove if present).
 */
export function toggleFilterValue(state: FilterState, key: string, value: string): FilterState {
  const existing = state[key] ?? [];
  return existing.includes(value)
    ? removeFilterValue(state, key, value)
    : addFilterValue(state, key, value);
}

/**
 * Set a single value for a filter key (replaces existing values).
 */
export function setFilterValue(state: FilterState, key: string, value: string): FilterState {
  if (!value) {
    return removeFilter(state, key);
  }
  return { ...state, [key]: [value] };
}

// ── Query Helpers ───────────────────────────────────────────────────

/**
 * Check whether a filter key has active values.
 */
export function isFilterActive(state: FilterState, key: string): boolean {
  return (state[key]?.length ?? 0) > 0;
}

/**
 * Check if a specific value is selected for a filter key.
 */
export function isValueSelected(state: FilterState, key: string, value: string): boolean {
  return state[key]?.includes(value) ?? false;
}

/**
 * Count total number of active filter values across all keys.
 */
export function countActiveFilters(state: FilterState): number {
  return Object.values(state).reduce((sum, values) => sum + values.length, 0);
}

/**
 * Count number of active filter keys (not individual values).
 */
export function countActiveFilterKeys(state: FilterState): number {
  return Object.keys(state).filter((k) => (state[k]?.length ?? 0) > 0).length;
}

/**
 * Check if any filters are active.
 */
export function hasActiveFilters(state: FilterState): boolean {
  return Object.values(state).some((values) => values.length > 0);
}

// ── Compatibility Bridge ────────────────────────────────────────────

/**
 * Convert a flat `Record<string, string>` (the shape the legacy
 * `CompactFilterBar` produced, and the shape `useUrlFilters` still
 * returns for non-array URL params) into the canonical `FilterState`
 * that `useFilterContext` / `FilterToolbar` consume.
 *
 * The flat shape has single values per key; this normalises to arrays
 * so FilterState stays multi-value-first.
 *
 * Name is kept for backwards compatibility with existing call sites
 * and tests.
 */
export function fromCompactFilterState(flat: Record<string, string>): FilterState {
  const state: FilterState = {};
  for (const [key, value] of Object.entries(flat)) {
    if (value) {
      state[key] = [value];
    }
  }
  return state;
}

/**
 * Convert `FilterState` back to a flat `Record<string, string>` where
 * each key maps to a comma-joined value. Used at the URL-sync
 * boundary and for the `useUrlFilters` fallback. Name preserved for
 * backwards compatibility.
 */
export function toCompactFilterState(state: FilterState): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, values] of Object.entries(state)) {
    if (values.length > 0) {
      flat[key] = values.join(',');
    }
  }
  return flat;
}

/**
 * Extract filter-relevant options from a data array.
 * Useful for generating dynamic filter options from API responses.
 */
export function extractFilterOptions<T>(
  data: T[],
  key: keyof T & string,
  labelFn?: (value: T[keyof T]) => string,
): FilterOption[] {
  const seen = new Set<string>();
  const options: FilterOption[] = [];

  for (const item of data) {
    const value = String(item[key]);
    if (value && !seen.has(value)) {
      seen.add(value);
      options.push({
        value,
        label: labelFn ? labelFn(item[key]) : value,
      });
    }
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}
