import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Development seed.
 *
 * Runs as app_superuser: it creates tenants, and there is no tenant context
 * to bind to before they exist.
 *
 * Idempotent — `upsert` on the natural keys, so re-running does not
 * duplicate. Courts land in P05, once the schema has them.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is unset — refusing to seed.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// Dev-only credential. Never used outside a local stack, and the seed
// refuses to run against a database whose URL does not look local.
const DEV_PASSWORD = 'Passw0rd!'; // pragma: allowlist secret

const VENUES = [
  {
    slug: 'sofia-padel-club',
    name: 'Sofia Padel Club',
    city: 'Sofia',
    contactEmail: 'hello@sofia-padel.bg',
    owner: { email: 'owner@sofia.bg', name: 'Ivan Petrov' },
  },
  {
    slug: 'plovdiv-tennis-center',
    name: 'Plovdiv Tennis Center',
    city: 'Plovdiv',
    contactEmail: 'hello@plovdiv-tennis.bg',
    owner: { email: 'owner@plovdiv.bg', name: 'Maria Dimitrova' },
  },
] as const;

async function main() {
  if (!/localhost|127\.0\.0\.1|postgres-test|@postgres/.test(url!)) {
    throw new Error(
      `Refusing to seed a non-local database.\n  ${url!.replace(/:[^:@]*@/, ':***@')}`,
    );
  }

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE app_superuser`);

    for (const v of VENUES) {
      const org = await tx.venueOrg.upsert({
        where: { slug: v.slug },
        update: {},
        create: {
          slug: v.slug,
          name: v.name,
          city: v.city,
          country: 'BG',
          contactEmail: v.contactEmail,
          timezone: 'Europe/Sofia',
          currency: 'EUR',
        },
      });

      const owner = await tx.user.upsert({
        where: { email: v.owner.email },
        update: {},
        create: {
          email: v.owner.email,
          name: v.owner.name,
          passwordHash,
          emailVerified: new Date(),
          profile: {
            create: {
              displayName: v.owner.name,
              sports: v.slug.includes('padel') ? ['PADEL'] : ['TENNIS'],
            },
          },
        },
      });

      await tx.tenantMembership.upsert({
        where: { userId_tenantId: { userId: owner.id, tenantId: org.id } },
        update: { role: 'OWNER', status: 'ACTIVE' },
        create: {
          userId: owner.id,
          tenantId: org.id,
          role: 'OWNER',
          status: 'ACTIVE',
          acceptedAt: new Date(),
        },
      });

      console.log(`  ✓ ${v.name} — owner ${v.owner.email}`);
    }

    // Platform admin. Global identity, no membership — access comes from
    // appPermissions, not from belonging to a tenant.
    await tx.user.upsert({
      where: { email: 'admin@playerz.bg' },
      update: {},
      create: {
        email: 'admin@playerz.bg',
        name: 'Platform Admin',
        passwordHash,
        emailVerified: new Date(),
      },
    });
    console.log('  ✓ admin@playerz.bg (platform)');
  });

  console.log(`\nSeeded. Password for every account: ${DEV_PASSWORD}`);
  console.log('Courts + availability land in P05.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
