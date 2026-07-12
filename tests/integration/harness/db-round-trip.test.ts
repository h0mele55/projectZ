import { prismaTestClient, resetDatabase, seedTenant } from '../../helpers/db';
import { asAppSuperuser } from '../../helpers/rls';

/**
 * The harness must actually reset. If `resetDatabase()` silently truncated
 * nothing, every integration test downstream would inherit the previous
 * test's rows — producing order-dependent flakes that look like product
 * bugs. This proves the reset, rather than assuming it.
 */
describe('db harness round-trip', () => {
  const prisma = prismaTestClient();

  it('seeds a tenant with an OWNER membership', async () => {
    const t = await seedTenant({ name: 'Sofia Padel Club' });

    expect(t.tenantId).toBeTruthy();
    expect(t.userId).toBeTruthy();
    expect(t.ownerEmail).toMatch(/@playerz\.test$/);

    const rows = await asAppSuperuser(prisma, (tx) =>
      tx.tenantMembership.findMany({ where: { tenantId: t.tenantId } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'OWNER', status: 'ACTIVE', userId: t.userId });
  });

  it('resetDatabase truncates every table — no bleed into the next test', async () => {
    await seedTenant();
    await seedTenant();

    const before = await asAppSuperuser(prisma, (tx) => tx.venueOrg.count());
    expect(before).toBe(2);

    await resetDatabase(prisma);

    const after = await asAppSuperuser(prisma, async (tx) => ({
      orgs: await tx.venueOrg.count(),
      users: await tx.user.count(),
      memberships: await tx.tenantMembership.count(),
    }));
    expect(after).toEqual({ orgs: 0, users: 0, memberships: 0 });
  });
});
