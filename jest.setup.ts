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

  // Stripe's SDK throws when constructed with an empty apiKey, so the
  // client must have SOMETHING even in tests that never reach the network.
  // Locally .env.test supplied these; CI has no such file, which is exactly
  // why the defaults belong here and not in a file the runner may not have.
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy', // pragma: allowlist secret
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_dummy', // pragma: allowlist secret

  // Moderation. Absent this, `classifyText` throws ModerationUnavailableError
  // and EVERY review would be queued — the tests would pass for entirely the
  // wrong reason, proving only that our outage path works.
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'sk-test-moderation-dummy', // pragma: allowlist secret
});

export {};
