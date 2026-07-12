import { z } from 'zod';

/**
 * Shared Zod primitives.
 *
 * These exist so that "a court id" means the same thing on every route. A
 * per-route `z.string()` is how a slug ends up where an id belongs.
 */

/// Prisma ids are cuid, not uuid — see docs/implementation-notes/p04.
export const cuidSchema = z.string().regex(/^c[a-z0-9]{20,32}$/i, 'Expected a cuid');

export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single hyphens only');

/// Money is ALWAYS integer cents. A float price is a rounding bug waiting
/// for a busy Saturday.
export const pricingCentsSchema = z.number().int().min(0).max(10_000_00);

export const currencySchema = z.enum(['EUR', 'BGN']);

export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Not a valid IANA timezone' },
);

export const sportSchema = z.enum([
  'TENNIS',
  'PADEL',
  'BADMINTON',
  'FOOTBALL5',
  'BASKETBALL',
  'VOLLEYBALL',
  'TABLE_TENNIS',
]);

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
