import type { Role } from '@prisma/client';

/**
 * The request context every use case receives. It is the ONLY carrier of
 * identity and tenancy into the app layer — a use case never reads a
 * session or a header itself.
 *
 * P07 populates this from NextAuth + the tenant-access middleware.
 */
export interface RequestContext {
  /** Null for anonymous/guest traffic (public venue search, guest booking). */
  userId: string | null;
  /** Null on non-tenant-scoped routes (e.g. the public venue index). */
  tenantId: string | null;
  role: Role | null;
  /** Tenant-scoped permissions, e.g. "bookings.create". */
  permissions: readonly string[];
  /** Cross-tenant/platform permissions. */
  appPermissions: readonly string[];
  requestId: string;
  locale: 'bg' | 'en';
}

export function hasPermission(ctx: RequestContext, permission: string): boolean {
  return ctx.permissions.includes(permission) || ctx.appPermissions.includes(permission);
}
