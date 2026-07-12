import type { PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from './prisma';
import { getTenantContext, runWithTenantContext } from './tenant-context';

/**
 * Bind a transaction to a tenant so Postgres RLS applies.
 *
 * Everything on the request path goes through here. A repository that
 * queries outside this wrapper runs as a role with no `app.tenant_id` set,
 * and the fail-closed policy returns zero rows — the caller sees an empty
 * list rather than a loud error, which is exactly the kind of bug that
 * reaches production.
 */

/**
 * Prisma ids are cuid: `c` + base36. Validated BEFORE the value reaches
 * the database.
 *
 * The parameterised `set_config($1)` below already makes injection
 * impossible, so this is defence in depth, not the primary control. What
 * it actually buys is a loud, early failure: a caller passing a slug, an
 * email, or `'; DROP TABLE --` gets an exception naming the problem,
 * instead of a session bound to a nonsense tenant that silently matches no
 * rows.
 */
const CUID_RE = /^c[a-z0-9]{20,32}$/i;

export class InvalidTenantIdError extends Error {
  constructor(value: string) {
    super(
      `Refusing to bind a tenant context to a malformed tenant id: ${JSON.stringify(value)}. ` +
        `Expected a cuid.`,
    );
    this.name = 'InvalidTenantIdError';
  }
}

export class NestedTenantContextError extends Error {
  constructor(outer: string, inner: string) {
    super(
      `Nested runInTenantContext: already bound to ${outer}, refused to re-bind to ${inner}. ` +
        `Nesting silently narrows or widens the tenant scope halfway through a request — ` +
        `if you genuinely need cross-tenant access, use the app_superuser path explicitly.`,
    );
    this.name = 'NestedTenantContextError';
  }
}

/**
 * Run `fn` inside a transaction with `app.tenant_id` set and the RLS-bound
 * `app_user` role assumed.
 *
 * `SET LOCAL` / `set_config(..., true)` are transaction-scoped: both are
 * released automatically when the transaction commits OR rolls back. There
 * is deliberately no RESET in a finally block — a leaked binding is
 * impossible by construction, and an explicit RESET would be dead code
 * that implies otherwise.
 */
export async function runInTenantContext<T>(
  tenantId: string,
  fn: (tx: PrismaClient) => Promise<T>,
  client: PrismaClient = defaultPrisma,
): Promise<T> {
  if (!CUID_RE.test(tenantId)) {
    throw new InvalidTenantIdError(tenantId);
  }

  const existing = getTenantContext();
  if (existing && existing.tenantId !== tenantId) {
    throw new NestedTenantContextError(existing.tenantId, tenantId);
  }

  return runWithTenantContext(tenantId, () =>
    client.$transaction(async (tx) => {
      // Parameterised — the tenant id is never string-concatenated into SQL.
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
      return fn(tx as unknown as PrismaClient);
    }),
  );
}

/**
 * BYPASSRLS. Migrations, background jobs, cross-tenant admin.
 *
 * Deliberately verbose to call. Every use site should be obvious in review
 * — this is the one path that can read across tenant boundaries.
 */
export async function runAsSuperuser<T>(
  fn: (tx: PrismaClient) => Promise<T>,
  client: PrismaClient = defaultPrisma,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE app_superuser`);
    return fn(tx as unknown as PrismaClient);
  });
}
