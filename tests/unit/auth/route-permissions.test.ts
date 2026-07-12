import { getPermissionsForRole } from '@/lib/permissions';
import { ROUTE_PERMISSIONS, requiredPermission } from '@/lib/security/route-permissions';

describe('route permissions', () => {
  it('a refund requires payments.refund — NOT bookings.create', () => {
    // THE bug this table's ordering exists to prevent.
    //
    // `/bookings/:id/refund` also matches the `/bookings` pattern. If the
    // generic rule came first, a refund would only require
    // `bookings.create` — which every PLAYER has. Any player could refund
    // their own booking, and drain the club's Stripe balance.
    expect(requiredPermission('/api/t/sofia/bookings/bk_1/refund', 'POST')).toBe('payments.refund');
  });

  it('a cancel requires bookings.cancel, not bookings.create', () => {
    expect(requiredPermission('/api/t/sofia/bookings/bk_1/cancel', 'POST')).toBe('bookings.cancel');
  });

  it('creating a booking requires bookings.create', () => {
    expect(requiredPermission('/api/t/sofia/bookings', 'POST')).toBe('bookings.create');
  });

  it('a PLAYER cannot satisfy the refund route, but a MANAGER can', () => {
    const needed = requiredPermission('/api/t/sofia/bookings/bk_1/refund', 'POST')!;

    const player = getPermissionsForRole('PLAYER');
    const manager = getPermissionsForRole('MANAGER');

    expect(player).not.toContain(needed);
    expect(manager).toContain(needed);
  });

  it('a STAFF member can cancel but cannot refund', () => {
    const staff = getPermissionsForRole('STAFF');
    expect(staff).toContain(requiredPermission('/api/t/sofia/bookings/bk_1/cancel', 'POST')!);
    expect(staff).not.toContain(requiredPermission('/api/t/sofia/bookings/bk_1/refund', 'POST')!);
  });

  it.each([
    ['/api/t/sofia/admin/venues', 'POST', 'admin.venue_manage'],
    ['/api/t/sofia/admin/staff', 'DELETE', 'admin.staff_manage'],
    ['/api/t/sofia/admin/pricing', 'PUT', 'admin.pricing_manage'],
    ['/api/t/sofia/admin/courts', 'PATCH', 'courts.manage'],
    ['/api/t/sofia/players/p1/credit', 'POST', 'players.credit_adjust'],
    ['/api/t/sofia/sessions', 'POST', 'openplay.host'],
    ['/api/t/sofia/sessions/s1/moderate', 'DELETE', 'openplay.moderate'],
  ])('%s %s requires %s', (path, method, expected) => {
    expect(requiredPermission(path, method)).toBe(expected);
  });

  it('GET is not gated by these rules (reads are gated by RLS + route logic)', () => {
    expect(requiredPermission('/api/t/sofia/bookings', 'GET')).toBeNull();
  });

  it('every rule names a permission that actually exists for some role', () => {
    // A rule naming a permission no role holds is a route nobody can ever
    // call — a silent, permanent 403 that looks like "correctly secured".
    const allGranted = new Set(
      (['OWNER', 'MANAGER', 'STAFF', 'COACH', 'PLAYER'] as const).flatMap((r) => [
        ...getPermissionsForRole(r),
      ]),
    );

    for (const rule of ROUTE_PERMISSIONS) {
      expect(allGranted.has(rule.permission)).toBe(true);
    }
  });

  it('the more specific booking rules precede the generic one', () => {
    // Pins the ORDER, not just the outcome — a future edit that reorders
    // the array reintroduces the refund bug, and this catches it directly.
    const paths = ROUTE_PERMISSIONS.map((r) => r.pattern.source);
    const refund = paths.findIndex((p) => p.includes('refund'));
    const cancel = paths.findIndex((p) => p.includes('cancel'));
    const generic = paths.findIndex((p) => p.endsWith('bookings'));

    expect(refund).toBeLessThan(generic);
    expect(cancel).toBeLessThan(generic);
  });
});
