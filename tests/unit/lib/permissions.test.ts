import type { Role } from '@prisma/client';

import { PERMISSIONS, getPermissionsForRole, roleHasPermission } from '@/lib/permissions';

/**
 * The permission model.
 *
 * A broken ACL has two failure modes and only one of them is loud:
 *
 *   - fails OPEN  → a player can refund their own booking. Catastrophic,
 *                   and no test that only checks the happy path finds it.
 *   - fails CLOSED → a manager can't do their job. Annoying, but obvious.
 *
 * So these tests assert the NEGATIVE space as hard as the positive one:
 * what each role must NOT be able to do.
 */

const ROLES: Role[] = ['OWNER', 'MANAGER', 'STAFF', 'COACH', 'PLAYER'];

describe('permission model', () => {
  it('every role resolves to a permission set', () => {
    for (const role of ROLES) {
      expect(getPermissionsForRole(role)).toBeDefined();
    }
  });

  it('every granted permission is a declared permission', () => {
    // Guards against a set drifting out of the union via a cast.
    const declared = new Set<string>(PERMISSIONS);
    for (const role of ROLES) {
      for (const p of getPermissionsForRole(role)) {
        expect(declared.has(p)).toBe(true);
      }
    }
  });

  describe('OWNER', () => {
    it('has every permission', () => {
      expect([...getPermissionsForRole('OWNER')].sort()).toEqual([...PERMISSIONS].sort());
    });
  });

  describe('MANAGER', () => {
    it('can run the club day-to-day', () => {
      for (const p of [
        'admin.venue_manage',
        'admin.staff_manage',
        'admin.pricing_manage',
        'bookings.refund',
        'payments.refund',
        'courts.manage',
      ] as const) {
        expect(roleHasPermission('MANAGER', p)).toBe(true);
      }
    });

    it('CANNOT promote itself to owner or close the club', () => {
      // The privilege-escalation path. A manager who can grant
      // admin.owner_management is an owner.
      expect(roleHasPermission('MANAGER', 'admin.owner_management')).toBe(false);
      expect(roleHasPermission('MANAGER', 'admin.tenant_lifecycle')).toBe(false);
    });
  });

  describe('STAFF', () => {
    it('can take and cancel bookings at the front desk', () => {
      expect(roleHasPermission('STAFF', 'bookings.create')).toBe(true);
      expect(roleHasPermission('STAFF', 'bookings.cancel')).toBe(true);
      expect(roleHasPermission('STAFF', 'bookings.view_all')).toBe(true);
    });

    it('CANNOT move money', () => {
      // Front-desk staff can cancel a booking, but issuing the refund is a
      // separate, higher privilege. Cancelling is reversible; a refund is a
      // real-world money movement.
      expect(roleHasPermission('STAFF', 'payments.refund')).toBe(false);
      expect(roleHasPermission('STAFF', 'bookings.refund')).toBe(false);
      expect(roleHasPermission('STAFF', 'players.credit_adjust')).toBe(false);
    });

    it('CANNOT manage staff or pricing', () => {
      expect(roleHasPermission('STAFF', 'admin.staff_manage')).toBe(false);
      expect(roleHasPermission('STAFF', 'admin.pricing_manage')).toBe(false);
    });
  });

  describe('COACH', () => {
    it('owns its own calendar and can host open play', () => {
      expect(roleHasPermission('COACH', 'coaches.manage_own_calendar')).toBe(true);
      expect(roleHasPermission('COACH', 'openplay.host')).toBe(true);
    });

    it('CANNOT administer the venue or see all bookings', () => {
      expect(roleHasPermission('COACH', 'admin.venue_manage')).toBe(false);
      expect(roleHasPermission('COACH', 'bookings.view_all')).toBe(false);
      expect(roleHasPermission('COACH', 'payments.refund')).toBe(false);
    });
  });

  describe('PLAYER', () => {
    it('can book, cancel their own, and join open play', () => {
      expect(roleHasPermission('PLAYER', 'bookings.create')).toBe(true);
      expect(roleHasPermission('PLAYER', 'bookings.cancel')).toBe(true);
      expect(roleHasPermission('PLAYER', 'openplay.join')).toBe(true);
    });

    it('CANNOT refund, see other players bookings, or touch admin', () => {
      // The most important negative in the file. A player who can refund is
      // a player who can drain the club's Stripe balance.
      expect(roleHasPermission('PLAYER', 'payments.refund')).toBe(false);
      expect(roleHasPermission('PLAYER', 'bookings.refund')).toBe(false);
      expect(roleHasPermission('PLAYER', 'bookings.view_all')).toBe(false);
      expect(roleHasPermission('PLAYER', 'players.credit_adjust')).toBe(false);
      expect(roleHasPermission('PLAYER', 'admin.venue_manage')).toBe(false);
      expect(roleHasPermission('PLAYER', 'admin.tenant_lifecycle')).toBe(false);
    });
  });

  describe('the privilege ladder is monotonic where it should be', () => {
    it('OWNER ⊇ MANAGER ⊇ STAFF for the shared booking surface', () => {
      const owner = new Set(getPermissionsForRole('OWNER'));
      const manager = new Set(getPermissionsForRole('MANAGER'));
      const staff = new Set(getPermissionsForRole('STAFF'));

      for (const p of manager) expect(owner.has(p)).toBe(true);
      for (const p of staff) expect(manager.has(p)).toBe(true);
    });

    it('admin.tenant_lifecycle is OWNER-only', () => {
      const holders = ROLES.filter((r) => roleHasPermission(r, 'admin.tenant_lifecycle'));
      expect(holders).toEqual(['OWNER']);
    });
  });
});
