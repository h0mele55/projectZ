import { ADMIN_NAV, AppNav, PLAYER_NAV } from '@/components/layout/AppNav';

import { render, screen } from '../helpers/render';

/**
 * playerz's nav, not inflect's.
 *
 * P02 refused to port `SidebarNav` because its items were /controls,
 * /risks, /evidence — a compliance IA. This asserts the replacement is
 * actually a sports IA, and that permission gating hides what it should.
 */
describe('AppNav', () => {
  it('renders the player surface', () => {
    render(<AppNav items={PLAYER_NAV} />);

    for (const label of ['Play', 'Open play', 'Coaches', 'My bookings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('carries NO compliance vocabulary', () => {
    render(<AppNav items={[...PLAYER_NAV, ...ADMIN_NAV]} permissions={['bookings.view_all']} />);

    // The regression this exists to prevent: quietly re-porting inflect's
    // nav and shipping a booking app with a "Risks" tab.
    for (const forbidden of [
      'Controls',
      'Risks',
      'Evidence',
      'Policies',
      'Vendors',
      'Frameworks',
    ]) {
      expect(screen.queryByRole('link', { name: forbidden })).not.toBeInTheDocument();
    }
  });

  it('hides admin links the viewer has no permission for', () => {
    render(<AppNav items={ADMIN_NAV} permissions={['courts.manage']} />);

    expect(screen.getByRole('link', { name: 'Courts' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pricing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
  });

  it('shows every admin link to a fully-privileged viewer', () => {
    render(
      <AppNav
        items={ADMIN_NAV}
        permissions={[
          'bookings.view_all',
          'courts.manage',
          'admin.pricing_manage',
          'players.view',
          'admin.staff_manage',
        ]}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(ADMIN_NAV.length);
  });
});
