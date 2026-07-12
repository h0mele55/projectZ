/**
 * Cursor-based pagination utilities for Prisma.
 *
 * Standard order: [{ createdAt: 'desc' }, { id: 'desc' }]
 * Cursor encodes { createdAt, id } as base64 JSON.
 * Where condition: (createdAt < cursor.createdAt) OR (createdAt == cursor.createdAt AND id < cursor.id)
 */

export interface CursorPayload {
  createdAt: string; // ISO-8601
  id: string;
}

/**
 * Encode a cursor from the last item in a result set.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode a cursor string back to { createdAt, id }.
 * Returns null if invalid.
 */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.createdAt === 'string' &&
      typeof parsed.id === 'string'
    ) {
      // Validate createdAt is a valid date
      const date = new Date(parsed.createdAt);
      if (isNaN(date.getTime())) return null;
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a Prisma `where` clause for cursor-based pagination.
 * Works with orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
 *
 * For descending order, the condition is:
 *   (createdAt < cursor.createdAt) OR
 *   (createdAt == cursor.createdAt AND id < cursor.id)
 */
export function buildCursorWhere(
  cursorString: string | undefined | null,
): Record<string, unknown> | null {
  if (!cursorString) return null;

  const cursor = decodeCursor(cursorString);
  if (!cursor) return null;

  const cursorDate = new Date(cursor.createdAt);

  return {
    OR: [
      { createdAt: { lt: cursorDate } },
      {
        AND: [{ createdAt: cursorDate }, { id: { lt: cursor.id } }],
      },
    ],
  };
}

/**
 * Standard orderBy clause for cursor pagination.
 * Must be stable (createdAt + id) and consistent with buildCursorWhere.
 */
export const CURSOR_ORDER_BY = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

/**
 * Default and maximum limit values.
 */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Clamp a limit value to [1, MAX_LIMIT], defaulting to DEFAULT_LIMIT.
 */
export function clampLimit(limit?: number | null): number {
  if (limit == null || isNaN(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(limit, MAX_LIMIT));
}

/**
 * Compute pageInfo from a result set.
 *
 * Strategy: fetch limit + 1 items, if we get more than limit,
 * there's a next page. Remove the extra item and compute nextCursor
 * from the last item.
 */
export function computePageInfo<T extends { createdAt: Date; id: string }>(
  items: T[],
  limit: number,
): { trimmedItems: T[]; nextCursor: string | undefined; hasNextPage: boolean } {
  const hasNextPage = items.length > limit;
  const trimmedItems = hasNextPage ? items.slice(0, limit) : items;
  const lastItem = trimmedItems[trimmedItems.length - 1];

  const nextCursor =
    hasNextPage && lastItem
      ? encodeCursor({
          createdAt: lastItem.createdAt.toISOString(),
          id: lastItem.id,
        })
      : undefined;

  return { trimmedItems, nextCursor, hasNextPage };
}

/**
 * Standard pagination defaults — single import point for UX consistency.
 */
export const PAGINATION_DEFAULTS = {
  limit: DEFAULT_LIMIT,
  maxLimit: MAX_LIMIT,
  orderBy: CURSOR_ORDER_BY,
} as const;
