import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The ambient tenant for the current request.
 *
 * AsyncLocalStorage rather than a module-level variable: a module-level
 * "current tenant" is shared across concurrent requests in the same Node
 * process, so under load request A would read request B's tenant. That is
 * a cross-tenant data leak with no stack trace — the worst possible bug in
 * a multi-tenant system.
 */
export interface TenantContext {
  tenantId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function getTenantIdOrThrow(): string {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant context. A tenant-scoped query ran outside runInTenantContext() — ' +
        'RLS would return zero rows and the caller would silently see nothing.',
    );
  }
  return ctx.tenantId;
}

export function runWithTenantContext<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ tenantId }, fn);
}

/** Exposed for the middleware; tests assert nesting is rejected. */
export const tenantStorage = storage;
