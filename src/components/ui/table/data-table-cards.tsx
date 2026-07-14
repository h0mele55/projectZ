'use client';

/**
 * Mobile PR-2 — `<DataTableCards>`: the canonical small-screen rendering of a
 * `<DataTable>`. Below `md` a wide table can't fit a 375px viewport without
 * truncating or forcing horizontal scroll, so each row collapses to a CARD:
 * every visible column reads as a `label → value` line (full names wrap,
 * nothing is cut). `<DataTable>` renders THIS instead of the table on phones
 * (gated by `useIsBelowMd`), so only one tree is ever in the DOM.
 *
 * It renders from the SAME tanstack `table` instance the desktop `<Table>`
 * uses, so sort/filter/selection state stay in lockstep — a presentation swap,
 * not a fork.
 *
 * Columns whose header isn't a plain string (the selection checkbox, the
 * row-action chevron, icon-only columns) carry no label and render full-width
 * — selection lands at the top of the card, actions at the bottom.
 */
import * as React from 'react';
import { flexRender, type Row, type Table as TanstackTable } from '@tanstack/react-table';

import { cn } from '@/lib/cn';
import { cardVariants } from '@/components/ui/card';
import { ChevronRight } from 'lucide-react';

export interface DataTableCardsProps<T> {
  table: TanstackTable<T>;
  onRowClick?: (row: Row<T>, e: React.MouseEvent) => void;
  className?: string;
}

export function DataTableCards<T>({ table, onRowClick, className }: DataTableCardsProps<T>) {
  const rows = table.getRowModel().rows;

  return (
    <div
      className={cn('gap-default flex flex-col', className)}
      role="list"
      data-testid="data-table-cards"
    >
      {rows.map((row) => {
        const clickable = !!onRowClick;
        return (
          <div
            key={row.id}
            // A clickable card IS a button; a read-only one is a list item.
            role={clickable ? 'button' : 'listitem'}
            data-row-id={row.id}
            onClick={clickable ? (e) => onRowClick!(row, e) : undefined}
            /*
             * A clickable card was a bare <div> with onClick: no role, no
             * tabIndex, no key handler. A keyboard user could not reach the row
             * and a screen-reader user was never told it was actionable — the
             * entire mobile list was unusable for them, silently.
             *
             * `role="button"` + tabIndex + Enter/Space is the minimum that makes
             * a non-<button> element actually operable. (A real <button> cannot
             * be used here: it may not contain the interactive cells — a kebab
             * menu, a checkbox — that these cards render.)
             */
            {...(clickable
              ? {
                  tabIndex: 0,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    // Space scrolls the page by default. A row that scrolls the
                    // list instead of opening is worse than one that does nothing.
                    e.preventDefault();
                    onRowClick!(row, e as unknown as React.MouseEvent);
                  },
                }
              : {})}
            className={cn(
              cardVariants({ density: 'compact' }),
              'gap-tight flex flex-col',
              // 44px floor. Below that a tap lands between rows as often as on
              // one, and the miss scrolls the list — the opposite of what was
              // wanted.
              clickable && 'relative min-h-11 pr-9',
              clickable &&
                'hover:bg-bg-muted/50 focus-visible:ring-focus-ring cursor-pointer transition-colors duration-75 focus-visible:ring-2 focus-visible:outline-none',
            )}
          >
            {clickable && (
              /* The affordance. Without it a card looks like a read-only summary,
                 and the user never discovers the row opens. */
              <ChevronRight
                aria-hidden
                className="text-content-subtle pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
              />
            )}
            {row.getVisibleCells().map((cell) => {
              const header = cell.column.columnDef.header;
              const label = typeof header === 'string' && header.trim() ? header : null;
              const value = flexRender(cell.column.columnDef.cell, cell.getContext());
              return (
                <div
                  key={cell.id}
                  className={cn(
                    'gap-default flex min-w-0 text-sm',
                    label ? 'items-baseline justify-between' : 'items-center',
                  )}
                >
                  {label && (
                    <span className="text-content-muted shrink-0 text-xs font-medium tracking-wide uppercase">
                      {label}
                    </span>
                  )}
                  <span
                    className={cn(
                      'min-w-0 break-words',
                      label ? 'text-content-default text-right' : 'text-content-default flex-1',
                    )}
                  >
                    {value}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
