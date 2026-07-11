/**
 * Module augmentation for @tanstack/react-table — extends `ColumnMeta`
 * with the custom fields read by the DataTable / Table primitives
 * (`src/components/ui/table/`).
 *
 * Lives in `src/types/` alongside the other ambient declarations
 * (`globals.d.ts`): a `.d.ts` carries no runtime exports, so it must
 * stay out of the table directory — the table-platform barrel
 * guardrails require every `.ts`/`.tsx` file there to be re-exported
 * from `index.ts`, which an ambient declaration cannot be.
 */
import '@tanstack/react-table';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    /** When true, the cell text will NOT be clipped with a truncation ellipsis. */
    disableTruncate?: boolean;
    /** Optional tooltip text rendered next to the column header label. */
    headerTooltip?: string;
  }
}
