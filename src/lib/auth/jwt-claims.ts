/**
 * What goes into the JWT, and what must not.
 *
 * A JWT travels in a cookie on EVERY request. Browsers and proxies cap
 * headers at roughly 4–8KB, and a token that grows past that does not throw
 * — the request is silently rejected upstream, or the cookie is silently
 * dropped, and the user is mysteriously logged out. It is a bug that only
 * appears for your largest customers, which is to say the ones you can least
 * afford to break.
 *
 * A player who plays at 200 clubs would have 200 memberships. So the claim
 * is CAPPED, and the cap is visible in the token.
 */

export const MAX_JWT_MEMBERSHIPS = 50;

export interface MembershipClaim {
  tenantId: string;
  tenantSlug: string;
  role: string;
}

export interface PlayerzJWT {
  sub: string;
  /** The tenant currently selected. Null between sign-in and selection. */
  tenantId: string | null;
  tenantSlug: string | null;
  role: string | null;
  memberships: MembershipClaim[];
  /**
   * True when memberships[] was cut short. The client MUST NOT treat the
   * list as exhaustive when this is set — "you are not a member of X" is
   * only sound if the list is complete, and the API is the authority anyway.
   */
  membershipsTruncated: boolean;
  /** Lets a password change revoke every issued token. */
  sessionVersion: number;
  userSessionId: string | null;
}

export function buildMembershipClaims(all: readonly MembershipClaim[]): {
  memberships: MembershipClaim[];
  membershipsTruncated: boolean;
} {
  if (all.length <= MAX_JWT_MEMBERSHIPS) {
    return { memberships: [...all], membershipsTruncated: false };
  }

  return {
    memberships: all.slice(0, MAX_JWT_MEMBERSHIPS),
    membershipsTruncated: true,
  };
}
