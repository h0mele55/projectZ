import { type NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { checkTenantAccess, type TokenClaims } from '@/lib/auth/guard';
import { requiredPermission } from '@/lib/security/route-permissions';

/**
 * Edge middleware.
 *
 * ORDER MATTERS, and it is the reverse of what feels natural:
 *
 *   1. health probes first — a liveness check that needs a valid session is
 *      not a liveness check, and a rate-limited one will get your pods
 *      killed during an incident, precisely when you least want that.
 *   2. read the token once.
 *   3. tenant access — is this your club at all?
 *   4. permission — are you allowed to do THIS to it?
 *
 * Steps 3 and 4 are defence in depth, not the defence. Postgres RLS is the
 * guarantee: even if this file were deleted, a query bound to the wrong
 * tenant returns zero rows. What the middleware buys is a clean 403 instead
 * of a baffling empty page, and a request that never reaches the database.
 */

const HEALTH_PATHS = new Set(['/api/health', '/api/livez', '/api/readyz']);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Probes bypass everything.
  if (HEALTH_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // 2. One token read for the whole pipeline.
  const raw = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const token = raw as unknown as TokenClaims | null;

  // 3. Tenant access.
  const access = checkTenantAccess(pathname, token);

  switch (access.kind) {
    case 'public':
    case 'allow':
      break;

    case 'unauthenticated': {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
      }
      const login = new URL('/login', req.url);
      login.searchParams.set('next', pathname);
      return NextResponse.redirect(login);
    }

    case 'needs_db_check':
      // The token's membership list was truncated, so we cannot rule the
      // user out here. Let it through — the route resolves membership
      // authoritatively, and RLS is the backstop either way. Denying at the
      // edge would lock a player out of their 51st club.
      break;

    case 'forbidden':
      return pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'forbidden' }, { status: 403 })
        : new NextResponse('Forbidden', { status: 403 });
  }

  // 4. Permission on mutations.
  const needed = requiredPermission(pathname, req.method);
  if (needed) {
    const perms = (raw as { permissions?: string[] } | null)?.permissions ?? [];
    if (!perms.includes(needed)) {
      return NextResponse.json({ error: 'forbidden', requiredPermission: needed }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets. A matcher that
    // accidentally excludes /api/** is the classic way to ship a guard that
    // protects the pages and leaves the data open.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js)$).*)',
  ],
};
