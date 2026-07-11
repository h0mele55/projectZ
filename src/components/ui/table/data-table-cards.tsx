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
            role="listitem"
            data-row-id={row.id}
            onClick={clickable ? (e) => onRowClick!(row, e) : undefined}
            className={cn(
              cardVariants({ density: 'compact' }),
              'gap-tight flex flex-col',
              clickable && 'hover:bg-bg-muted/50 cursor-pointer transition-colors duration-75',
            )}
          >
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
