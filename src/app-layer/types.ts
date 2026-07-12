import type { Role } from '@prisma/client';

import type { Permission } from '@/lib/permissions';

/**
 * The request context every use case receives.
 *
 * It is the ONLY carrier of identity and tenancy into the app layer. A use
 * case never reads a session, a cookie, or a header itself — that keeps the
 * app layer testable without a web server, and makes "who is asking?" a
 * parameter rather than ambient state.
 */
export interface RequestContext {
  /** Null for anonymous traffic: public venue search, guest booking. */
  userId: string | null;
  /** Null on non-tenant routes (the public venue index). */
  tenantId: string | null;
  tenantSlug: string | null;
  role: Role | null;
  /** Tenant-scoped permissions, resolved from the role + any custom role. */
  permissions: readonly Permission[];
  /** Cross-tenant / platform permissions. */
  appPermissions: readonly string[];
  requestId: string;
  locale: 'bg' | 'en';
}

export function hasPermission(ctx: RequestContext, permission: Permission): boolean {
  return ctx.permissions.includes(permission);
}
