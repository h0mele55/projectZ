import type { PrismaClient } from '@prisma/client';

import { runAsSuperuser, runInTenantContext } from '@/lib/db/rls-middleware';

import type { RequestContext } from './types';

/**
 * The only two ways a use case gets a database handle.
 *
 * `executeInTenant` binds the transaction to the tenant so Postgres RLS
 * applies. A repository that reaches for the global prisma client instead
 * runs UNSCOPED — and because the policies fail closed, it sees zero rows
 * rather than raising. The caller gets an empty list and no error, which is
 * exactly the kind of bug that reaches production.
 *
 * That is why there is no third way, and why `executeAsSuperuser` is
 * deliberately verbose to type: every cross-tenant read should be obvious
 * in review.
 */

export async function executeInTenant<T>(
  ctx: RequestContext,
  fn: (ctx: RequestContext, db: PrismaClient) => Promise<T>,
): Promise<T> {
  if (!ctx.tenantId) {
    throw new Error(
      'executeInTenant called without a tenantId. A tenant-scoped use case ran on a ' +
        'route that never resolved a tenant — RLS would return zero rows and the caller ' +
        'would silently see nothing.',
    );
  }
  return runInTenantContext(ctx.tenantId, (db) => fn(ctx, db));
}

/**
 * BYPASSRLS. Migrations, background jobs, platform admin, sign-in (which
 * must read a User before any tenant is selected).
 */
export async function executeAsSuperuser<T>(
  ctx: RequestContext,
  fn: (ctx: RequestContext, db: PrismaClient) => Promise<T>,
): Promise<T> {
  return runAsSuperuser((db) => fn(ctx, db));
}
