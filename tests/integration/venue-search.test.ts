import { listVenues } from '@/app-layer/repositories/venue';

import { prismaTestClient, seedTenant } from '../helpers/db';
import { asAppSuperuser, asAppUser } from '../helpers/rls';

/**
 * Public venue search is the ONE read that deliberately crosses tenants —
 * a player hunting for a padel court in Sofia does not know which club owns
 * it. That makes it the most dangerous query in the product, so it is
 * tested against the same database RLS protects.
 */
describe('venue search', () => {
  const prisma = prismaTestClient();

  async function makeVenue(
    tenantId: string,
    o: { slug: string; name: string; city: string; sport: 'PADEL' | 'TENNIS'; price?: number },
  ) {
    return asAppSuperuser(prisma, async (tx) => {
      const v = await tx.venue.create({
        data: {
          tenantId,
          slug: o.slug,
          name: o.name,
          addressLine: '1',
          city: o.city,
          email: `${o.slug}@playerz.test`,
          lat: 42.7,
          lng: 23.3,
        },
      });
      await tx.resource.create({
        data: {
          tenantId,
          venueId: v.id,
          name: 'Court 1',
          sport: o.sport,
          surface: 'HARD',
          basePriceCents: o.price ?? 2400,
        },
      });
      return v;
    });
  }

  it('lists venues across tenants and filters by city', async () => {
    const a = await seedTenant();
    const b = await seedTenant();

    await makeVenue(a.tenantId, {
      slug: 'sofia-padel',
      name: 'Sofia Padel',
      city: 'Sofia',
      sport: 'PADEL',
    });
    await makeVenue(b.tenantId, {
      slug: 'plovdiv-tennis',
      name: 'Plovdiv Tennis',
      city: 'Plovdiv',
      sport: 'TENNIS',
    });

    const all = await listVenues(prisma, {});
    expect(all.items).toHaveLength(2);

    const sofia = await listVenues(prisma, { city: 'Sofia' });
    expect(sofia.items.map((v) => v.slug)).toEqual(['sofia-padel']);
  });

  it('filters by sport through the court join', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    await makeVenue(a.tenantId, { slug: 'p1', name: 'Padel One', city: 'Sofia', sport: 'PADEL' });
    await makeVenue(b.tenantId, { slug: 't1', name: 'Tennis One', city: 'Sofia', sport: 'TENNIS' });

    const tennis = await listVenues(prisma, { sport: 'TENNIS' });
    expect(tennis.items.map((v) => v.slug)).toEqual(['t1']);
  });

  it('paginates by cursor and never exceeds the hard ceiling', async () => {
    const t = await seedTenant();
    for (let i = 0; i < 45; i++) {
      await makeVenue(t.tenantId, {
        slug: `v-${String(i).padStart(2, '0')}`,
        name: `Venue ${i}`,
        city: 'Sofia',
        sport: 'PADEL',
      });
    }

    const p1 = await listVenues(prisma, {}, { limit: 20 });
    expect(p1.items).toHaveLength(20);
    expect(p1.nextCursor).toBeTruthy();

    const p2 = await listVenues(prisma, {}, { limit: 20, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(20);

    const p3 = await listVenues(prisma, {}, { limit: 20, cursor: p2.nextCursor! });
    expect(p3.items).toHaveLength(5);
    expect(p3.nextCursor).toBeNull();

    // No duplicates and no gaps across the pages — a cursor that skips or
    // repeats a row is the classic off-by-one in `skip: 1`.
    const seen = [...p1.items, ...p2.items, ...p3.items].map((v) => v.id);
    expect(new Set(seen).size).toBe(45);

    // A client asking for 10,000 gets the ceiling, not 10,000.
    const huge = await listVenues(prisma, {}, { limit: 10_000 });
    expect(huge.items.length).toBeLessThanOrEqual(50);
  });

  it('an unknown city returns an empty list, not an error', async () => {
    const t = await seedTenant();
    await makeVenue(t.tenantId, { slug: 'x', name: 'X', city: 'Sofia', sport: 'PADEL' });

    const res = await listVenues(prisma, { city: 'Atlantis' });
    expect(res.items).toEqual([]);
    expect(res.nextCursor).toBeNull();
  });

  it('the ADMIN read stays tenant-scoped even though the public one does not', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    await makeVenue(a.tenantId, { slug: 'a1', name: 'A', city: 'Sofia', sport: 'PADEL' });
    await makeVenue(b.tenantId, { slug: 'b1', name: 'B', city: 'Sofia', sport: 'PADEL' });

    // The public search sees both…
    expect((await listVenues(prisma, {})).items).toHaveLength(2);

    // …but a tenant-bound session sees only its own. The cross-tenant
    // search must not have weakened RLS for everything else.
    const seenByA = await asAppUser(prisma, a.tenantId, (tx) => tx.venue.findMany({ take: 50 }));
    expect(seenByA.map((v) => v.slug)).toEqual(['a1']);
  });
});
