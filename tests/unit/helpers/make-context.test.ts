import { hasPermission } from '@/app-layer/context';

import { buildRequestContext } from '../../helpers/make-context';

describe('buildRequestContext', () => {
  it('defaults to an ANONYMOUS context', () => {
    const ctx = buildRequestContext();
    // If the default were a privileged owner, a policy test could pass
    // while the policy did nothing. Anonymous-by-default forces each test
    // to ask for exactly the privilege it means to exercise.
    expect(ctx.userId).toBeNull();
    expect(ctx.tenantId).toBeNull();
    expect(ctx.role).toBeNull();
    expect(ctx.permissions).toEqual([]);
    expect(ctx.appPermissions).toEqual([]);
  });

  it('applies overrides over the defaults', () => {
    const ctx = buildRequestContext({
      userId: 'u1',
      tenantId: 't1',
      role: 'OWNER',
      permissions: ['bookings.create'],
    });
    expect(ctx).toMatchObject({
      userId: 'u1',
      tenantId: 't1',
      role: 'OWNER',
      permissions: ['bookings.create'],
    });
    // Untouched defaults survive.
    expect(ctx.locale).toBe('bg');
  });

  it('hasPermission reads both tenant and app permission sets', () => {
    expect(
      hasPermission(buildRequestContext({ permissions: ['bookings.create'] }), 'bookings.create'),
    ).toBe(true);
    expect(
      hasPermission(buildRequestContext({ appPermissions: ['platform.admin'] }), 'platform.admin'),
    ).toBe(true);
    expect(hasPermission(buildRequestContext(), 'bookings.create')).toBe(false);
  });
});
