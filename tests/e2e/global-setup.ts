import { execSync } from 'node:child_process';

/**
 * Seed the database before the E2E run.
 *
 * Without this, `/venues` renders its empty state and every discovery spec
 * passes by asserting nothing — a suite that is green because it is looking
 * at an empty page is worse than no suite at all.
 */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('E2E needs DATABASE_URL (see .env.test).');

  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  execSync('npx tsx scripts/seed.ts', { stdio: 'inherit' });
}
