import type { PrismaClient } from '@prisma/client';

/**
 * RLS binding helpers.
 *
 * The contract these prove: an app_user session with no `app.tenant_id`
 * set sees ZERO rows — not every row. `current_setting(x, true)` returns
 * NULL when unset, and `col = NULL` evaluates to NULL (not TRUE), so the
 * policy fails closed. That is the property tenant isolation rests on.
 */

/** Bind a transaction to a tenant, as the RLS-constrained app_user role. */
export async function asAppUser<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
    return fn(tx as unknown as PrismaClient);
  });
}

/** BYPASSRLS. Migrations, background jobs, cross-tenant teardown. */
export async function asAppSuperuser<T>(
  prisma: PrismaClient,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE app_superuser`);
    return fn(tx as unknown as PrismaClient);
  });
}

/**
 * Assert the callback returns zero rows when no tenant is bound.
 * This is the fail-closed check — if RLS were misconfigured to fail OPEN,
 * the query would return every tenant's rows and this would catch it.
 */
export async function expectRlsIsolated(
  prisma: PrismaClient,
  fn: (tx: PrismaClient) => Promise<unknown[]>,
): Promise<void> {
  const rows = await prisma.$transaction(async (tx) => {
    // Deliberately do NOT set app.tenant_id.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
    return fn(tx as unknown as PrismaClient);
  });

  if (rows.length !== 0) {
    throw new Error(
      `RLS is failing OPEN: an unscoped app_user session returned ${rows.length} row(s). ` +
        `It must return 0. Check that the table has ENABLE + FORCE ROW LEVEL SECURITY ` +
        `and a policy keyed on current_setting('app.tenant_id', true).`,
    );
  }
}
