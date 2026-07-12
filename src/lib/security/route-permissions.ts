import type { Permission } from '@/lib/permissions';

/**
 * Route → required permission.
 *
 * The table is the security boundary. Hiding a nav link (see `AppNav`) is a
 * UI courtesy — the URL is still typeable, and `curl` does not read your
 * navigation. This is what actually denies.
 *
 * DEFAULT DENY on mutations: `requiredPermission()` returns a permission for
 * any write under `/api/t/:slug/`, and the guardrail
 * (`route-permission-coverage`) fails the build if a mutating route exists
 * with no rule. A new admin endpoint cannot ship unprotected by omission —
 * which is exactly how these holes are usually created.
 */

export interface RoutePermission {
  pattern: RegExp;
  methods: readonly string[];
  permission: Permission;
}

export const ROUTE_PERMISSIONS: readonly RoutePermission[] = [
  // ── Venue administration ──────────────────────────────────────────
  {
    pattern: /^\/api\/t\/[^/]+\/admin\/venues/,
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    permission: 'admin.venue_manage',
  },
  {
    pattern: /^\/api\/t\/[^/]+\/admin\/staff/,
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    permission: 'admin.staff_manage',
  },
  {
    pattern: /^\/api\/t\/[^/]+\/admin\/pricing/,
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    permission: 'admin.pricing_manage',
  },
  {
    pattern: /^\/api\/t\/[^/]+\/admin\/courts/,
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    permission: 'courts.manage',
  },

  // ── Bookings ──────────────────────────────────────────────────────
  //
  // ORDER MATTERS. `/bookings/:id/refund` also matches `/bookings`, so the
  // more specific rules MUST come first — `requiredPermission` returns the
  // first match. Reversed, a refund would only require `bookings.create`,
  // and any PLAYER could refund themselves.
  {
    pattern: /^\/api\/t\/[^/]+\/bookings\/[^/]+\/refund/,
    methods: ['POST'],
    permission: 'payments.refund',
  },
  {
    pattern: /^\/api\/t\/[^/]+\/bookings\/[^/]+\/cancel/,
    methods: ['POST'],
    permission: 'bookings.cancel',
  },
  {
    pattern: /^\/api\/t\/[^/]+\/bookings/,
    methods: ['POST'],
    permission: 'bookings.create',
  },

  // ── Players / credit ──────────────────────────────────────────────
  {
    pattern: /^\/api\/t\/[^/]+\/players\/[^/]+\/credit/,
    methods: ['POST', 'PUT', 'PATCH'],
    permission: 'players.credit_adjust',
  },

  // ── Open play ─────────────────────────────────────────────────────
  {
    pattern: /^\/api\/t\/[^/]+\/sessions\/[^/]+\/moderate/,
    methods: ['POST', 'DELETE'],
    permission: 'openplay.moderate',
  },
  {
    pattern: /^\/api\/t\/[^/]+\/sessions/,
    methods: ['POST'],
    permission: 'openplay.host',
  },
] as const;

export function requiredPermission(pathname: string, method: string): Permission | null {
  const m = method.toUpperCase();
  for (const rule of ROUTE_PERMISSIONS) {
    if (rule.methods.includes(m) && rule.pattern.test(pathname)) {
      return rule.permission;
    }
  }
  return null;
}
