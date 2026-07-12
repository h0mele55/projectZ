import { prismaTestClient, seedTenant } from '../../helpers/db';
import { asAppSuperuser, asAppUser, expectRlsIsolated } from '../../helpers/rls';

/**
 * Tenant isolation is enforced by POSTGRES, not by the app layer.
 *
 * This is the single most important test in the repo. If it passes for the
 * wrong reason, every "tenant A cannot see tenant B" claim downstream is
 * worthless — so it asserts both directions: A cannot see B's rows, AND a
 * superuser CAN (proving the rows exist and the first assertion isn't
 * passing simply because the table is empty).
 */
describe('RLS binding', () => {
  const prisma = prismaTestClient();

  it('tenant A cannot see tenant B rows; app_superuser sees both', async () => {
    const a = await seedTenant({ name: 'Tenant A' });
    const b = await seedTenant({ name: 'Tenant B' });

    // A, scoped to itself, sees exactly its own membership.
    const seenByA = await asAppUser(prisma, a.tenantId, (tx) => tx.tenantMembership.findMany());
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.tenantId).toBe(a.tenantId);

    // B likewise — and critically, B does NOT see A's row.
    const seenByB = await asAppUser(prisma, b.tenantId, (tx) => tx.tenantMembership.findMany());
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]!.tenantId).toBe(b.tenantId);
    expect(seenByB.map((r) => r.tenantId)).not.toContain(a.tenantId);

    // The control: the rows really are both there. Without this, the two
    // assertions above would also pass against an empty table.
    const seenBySuper = await asAppSuperuser(prisma, (tx) => tx.tenantMembership.findMany());
    expect(seenBySuper).toHaveLength(2);
  });

  it('an UNSCOPED app_user session sees zero rows (RLS fails closed)', async () => {
    await seedTenant();
    await seedTenant();

    // No app.tenant_id set. current_setting(..., true) -> NULL, and
    // `tenantId = NULL` is NULL, not TRUE. So: no rows.
    // If RLS ever failed OPEN this returns every tenant's data.
    await expectRlsIsolated(prisma, (tx) => tx.tenantMembership.findMany());
    await expectRlsIsolated(prisma, (tx) => tx.venueOrg.findMany());
  });

  it('a write scoped to tenant A cannot smuggle a row into tenant B', async () => {
    const a = await seedTenant({ name: 'Tenant A' });
    const b = await seedTenant({ name: 'Tenant B' });
    const outsider = await asAppSuperuser(prisma, (tx) =>
      tx.user.create({ data: { email: `outsider-${Date.now()}@playerz.test` } }),
    );

    // WITH CHECK on the policy must reject an INSERT carrying another
    // tenant's id, even though the session is legitimately authenticated.
    await expect(
      asAppUser(prisma, a.tenantId, (tx) =>
        tx.tenantMembership.create({
          data: { tenantId: b.tenantId, userId: outsider.id, role: 'PLAYER', status: 'ACTIVE' },
        }),
      ),
    ).rejects.toThrow();
  });
});
