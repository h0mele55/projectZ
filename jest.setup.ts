import { config as loadEnv } from 'dotenv';

// .env.test is the ONLY source of DATABASE_URL for tests. `override: false`
// keeps CI's exported env (which points at the Actions service containers)
// winning over the file.
loadEnv({ path: '.env.test', override: false });

// @types/node declares NODE_ENV readonly, so a direct assignment fails
// `tsc --noEmit`. Object.assign writes it without a cast.
Object.assign(process.env, {
  NODE_ENV: 'test',
  SKIP_ENV_VALIDATION: '1',
  // Deterministic — a random key would make crypto assertions flaky.
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? '0'.repeat(64),
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? 'test-secret-not-a-real-key',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_dummy',
});

export {};
