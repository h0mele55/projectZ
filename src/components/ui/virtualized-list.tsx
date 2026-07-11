'use client';

/**
 * Epic 68 — `<VirtualizedList>` primitive.
 *
 * Reusable foundation for windowed rendering across the app.
 * Wraps `react-window`'s FixedSizeList / VariableSizeList behind
 * an ergonomic, react-window-agnostic API so consumers (DataTable
 * bodies, Combobox dropdowns, CardList grids, future surfaces)
 * never import react-window directly. If we replace react-window
 * with a different windowing engine later, the swap happens in one
 * file.
 *
 * Contract — only THREE props are required:
 *   - `itemCount`     — total number of logical items
 *   - `itemSize`      — fixed pixel height OR `(index) => height` for
 *                       variable rows (auto-routes to VariableSizeList)
 *   - `renderItem`    — `({ index, style }) => ReactNode`. The `style`
 *                       MUST be applied to the rendered row's outer
 *                       element so react-window can absolute-position
 *                       it inside the scroll viewport.
 *
 * Sizing — three modes:
 *   - Both `height` + `width` provided   → render directly without
 *                                          AutoSizer. Tests use this
 *                                          mode (jsdom has no layout).
 *   - Either dimension omitted          → wrap in `<AutoSizer>` and
 *                                          fill the parent. The parent
 *                                          MUST have a determinate
 *                                          size (e.g. flex-1, fixed
 *                                          height, or position
 *                                          constraints), otherwise
 *                                          the list collapses to 0px.
 *
 * SSR / jsdom safety — `<AutoSizer>` reports 0×0 in environments
 * without layout. When it does, react-window short-circuits and
 * renders nothing. Tests should pass explicit dimensions; production
 * code paths should mount inside a sized container (the rollout
 * docs spell out the exact pattern per host).
 *
 * What this is NOT — a 2D grid virtualizer (use `react-window`'s
 * `FixedSizeGrid` directly for those rare cases) and not a way to
 * defer rendering items by index range (it's a viewport-driven
 * window, not a paginator). Card-list rollouts that want to
 * virtualize a 3-column responsive grid group cards into rows-of-N
 * before passing to this primitive — see `docs/destructive-actions
 * .md`-style rollout doc to be added in the next prompt.
 */
import * as React from 'react';
import { FixedSizeList, VariableSizeList, type ListChildComponentProps } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';

export interface VirtualizedListRenderArgs {
  /** Logical index of the item being rendered. */
  index: number;
  /** Absolute-positioning style — MUST be spread onto the outer element. */
  style: React.CSSProperties;
}

export interface VirtualizedListProps {
  /** Total number of items in the windowed list. */
  itemCount: number;
  /**
   * Pixel height of each row. Pass a number for fixed-size rows
   * (FixedSizeList) or a function `(index) => number` for variable
   * rows (VariableSizeList). The function form is suitable when
   * row heights vary by index but are deterministic; for
   * dynamically-measured rows use react-window directly.
   */
  itemSize: number | ((index: number) => number);
  /** Render the row at `index`. Spread `style` onto the outer element. */
  renderItem: (args: VirtualizedListRenderArgs) => React.ReactNode;
  /**
   * Explicit height. When provided, AutoSizer is skipped for the
   * vertical dimension. Required for jsdom tests because jsdom has
   * no layout engine.
   */
  height?: number;
  /**
   * Explicit width. When provided, AutoSizer is skipped for the
   * horizontal dimension. Strings (e.g. `"100%"`) are forwarded
   * verbatim — react-window passes them through to its inner div.
   */
  width?: number | string;
  /**
   * Extra rows rendered above/below the visible window. Default
   * matches react-window's default of 2; bump to ~5 for surfaces
   * with fast keyboard navigation (combobox) so options pre-render
   * before the user scrolls them into view.
   */
  overscanCount?: number;
  /**
   * Stable per-index key for React reconciliation. Default is the
   * index itself, which is fine for static lists; pass a function
   * when items can shuffle / sort so React doesn't tear down rows
   * unnecessarily.
   */
  itemKey?: (index: number) => string | number;
  /** Class on the outer wrapper. */
  className?: string;
  /** Class on the inner scroll viewport (the react-window div). */
  innerClassName?: string;
  /** Accessible label, forwarded to the inner scroll viewport. */
  'aria-label'?: string;
  /** Optional `data-testid` for the outer wrapper. */
  'data-testid'?: string;
}

// react-window calls the children function with `{ index, style, data }`.
// We deliberately don't expose the `data` channel — consumers close over
// their own data via `renderItem`, which is simpler and keeps the
// primitive's API surface minimal.
type ItemComponent = React.ComponentType<ListChildComponentProps<unknown>>;

/**
 * Imperative handle exposed via `ref={...}`. Primary use case is
 * scroll-to-active for keyboard-driven surfaces (combobox, menu).
 * Variable-size mode also exposes the cache-reset hook because
 * dynamic item sizes need to invalidate when the size function
 * returns different values.
 */
export interface VirtualizedListHandle {
  /** Scroll to bring item at `index` into the visible window. */
  scrollToItem: (index: number, align?: 'auto' | 'smart' | 'center' | 'end' | 'start') => void;
  /** Scroll the viewport to a specific pixel offset. */
  scrollTo: (offset: number) => void;
  /**
   * Reset the cached item-size measurements (variable-size mode
   * only). No-op for fixed-size lists — exposed unconditionally so
   * consumers don't branch by mode.
   */
  resetAfterIndex: (index: number) => void;
}

export const VirtualizedList = React.forwardRef<VirtualizedListHandle, VirtualizedListProps>(
  function VirtualizedList(
    {
      itemCount,
      itemSize,
      renderItem,
      height,
      width,
      overscanCount = 2,
      itemKey,
      className,
      innerClassName,
      'aria-label': ariaLabel,
      'data-testid': testId,
    },
    ref,
  ) {
    // Memoise the inner row component so react-window doesn't tear
    // down its row instances on every render of the parent.
    const Row = React.useMemo<ItemComponent>(() => {
      const Component: ItemComponent = ({ index, style }) => <>{renderItem({ index, style })}</>;
      Component.displayName = 'VirtualizedListRow';
      return Component;
    }, [renderItem]);

    // Hold whichever of the two react-window list instances mounted.
    // Exposed via the imperative handle below so callers can scroll
    // to a row, reset variable-size measurements, etc.
    const innerRef = React.useRef<FixedSizeList | VariableSizeList | null>(null);

    React.useImperativeHandle(
      ref,
      () => ({
        scrollToItem: (index, align) => innerRef.current?.scrollToItem(index, align),
        scrollTo: (offset) => innerRef.current?.scrollTo(offset),
        resetAfterIndex: (index) => {
          const inst = innerRef.current;
          if (inst && 'resetAfterIndex' in inst) {
            inst.resetAfterIndex(index);
          }
        },
      }),
      [],
    );

    const renderList = (h: number, w: number | string) => {
      // `aria-label` is NOT forwarded into react-window's inner
      // viewport — its typed props don't accept arbitrary ARIA
      // attributes. We set the label on our outer wrapper div
      // instead (one source of truth) and rely on react-window's
      // own list semantics for inner-element ARIA.
      const commonProps = {
        height: h,
        width: w,
        itemCount,
        overscanCount,
        itemKey,
        className: innerClassName,
      } as const;

      if (typeof itemSize === 'function') {
        return (
          <VariableSizeList
            {...commonProps}
            itemSize={itemSize}
            ref={(inst) => {
              innerRef.current = inst;
            }}
          >
            {Row}
          </VariableSizeList>
        );
      }
      return (
        <FixedSizeList
          {...commonProps}
          itemSize={itemSize}
          ref={(inst) => {
            innerRef.current = inst;
          }}
        >
          {Row}
        </FixedSizeList>
      );
    };

    const hasExplicitHeight = typeof height === 'number';
    const hasExplicitWidth = typeof width !== 'undefined';

    if (hasExplicitHeight && hasExplicitWidth) {
      return (
        <div
          data-virtualized-list=""
          data-testid={testId}
          aria-label={ariaLabel}
          className={className}
          style={{ height, width }}
        >
          {renderList(height, width)}
        </div>
      );
    }

    // AutoSizer fills the nearest sized parent. We render an
    // intermediate div so consumers can target the wrapper for
    // styling without fighting AutoSizer's display-block default.
    //
    // AutoSizer's props are a discriminated union — `disableHeight`
    // and `disableWidth` must be literal `true` or omitted, never a
    // dynamic boolean. Branching by the explicit-dimension state
    // keeps each call typed correctly.
    return (
      <div
        data-virtualized-list=""
        data-testid={testId}
        aria-label={ariaLabel}
        className={className}
        style={{
          width: hasExplicitWidth ? (width as string | number) : '100%',
          height: hasExplicitHeight ? height : '100%',
          minHeight: 0,
        }}
      >
        {/*
                react-virtualized-auto-sizer v2.x changed two
                things from v1:

                  1. Child API: function-as-children → `renderProp`
                     prop. Same callback signature; same shape of
                     parameters.
                  2. Disable axes: v1's `disableHeight` /
                     `disableWidth` props are GONE. v2 always
                     measures both axes and reports each as
                     `number | undefined`. To "disable" an axis
                     we now just ignore the measured value and
                     use the consumer-supplied explicit dimension
                     instead.

                The three branches below model the same
                "explicit-dimension / measured-dimension" matrix
                as before; the only difference is the disable
                hints are gone.
            */}
        {hasExplicitHeight && !hasExplicitWidth && (
          <AutoSizer
            renderProp={({ width: w }) => {
              if (!w) return null;
              return renderList(height as number, w);
            }}
          />
        )}
        {!hasExplicitHeight && hasExplicitWidth && (
          <AutoSizer
            renderProp={({ height: h }) => {
              if (!h) return null;
              return renderList(h, width as number | string);
            }}
          />
        )}
        {!hasExplicitHeight && !hasExplicitWidth && (
          <AutoSizer
            renderProp={({ height: h, width: w }) => {
              if (!h || !w) return null;
              return renderList(h, w);
            }}
          />
        )}
      </div>
    );
  },
);
