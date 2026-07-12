import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * The Prisma client singleton.
 *
 * Prisma 7 requires a driver adapter — `datasources` and `datasourceUrl`
 * are both rejected by the constructor.
 *
 * In dev, Next's HMR re-evaluates modules on every edit; without the
 * global cache each reload would open a fresh pool and exhaust Postgres's
 * connection limit within a few minutes.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  // Fall back to '' rather than throwing: Next's build step imports every
  // route module to collect metadata, often with DATABASE_URL unset. A
  // throw here fails the whole build at import time; an empty string lets
  // the module load and surfaces the real error on the first query.
  const url = process.env.DATABASE_URL ?? '';
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
