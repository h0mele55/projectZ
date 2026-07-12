import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE META-RATCHET.
 *
 * Every test downstream of P03 stands on this harness. If a piece of it
 * goes missing — a jest project, an RLS helper, the alt-port test compose
 * stack — the failure mode is not a red test. It is a suite that quietly
 * stops testing: `--selectProjects integration` with no integration
 * project exits 0 and prints "no tests found". A green build that ran
 * nothing is far more dangerous than a red one.
 *
 * So this test asserts the harness still exists and still exports what it
 * advertises. It is the one test that fails loudly when the spine rots.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('test-infra integrity (meta-ratchet)', () => {
  describe('jest', () => {
    const cfg = read('jest.config.mjs');

    it('defines all four named projects', () => {
      for (const project of ['unit', 'rendered', 'integration', 'guardrails']) {
        expect(cfg).toContain(`displayName: '${project}'`);
      }
    });

    it('runs integration serially (a parallel worker would TRUNCATE another mid-test)', () => {
      expect(cfg).toContain('maxWorkers: 1');
    });

    it('does NOT put coverageThreshold at the top level, where jest silently ignores it', () => {
      // In multi-project mode a top-level `coverageThreshold` is accepted
      // and then never enforced — the run exits 0 no matter how low
      // coverage is. The thresholds must live inside project blocks (and
      // the CI gate passes them via --coverageThreshold, which IS enforced).
      // This asserts the key is not a direct property of the exported config.
      const topLevel = /\n\s{2}coverageThreshold:/.test(cfg);
      expect(topLevel).toBe(false);
      expect(cfg).toContain('coverageThreshold: thresholds');
    });

    it('has a thresholds file the CI gate can read', () => {
      const t = JSON.parse(read('jest.thresholds.json'));
      expect(t['src/lib/**'].lines).toBeGreaterThanOrEqual(70);
      expect(t['src/app-layer/**'].lines).toBeGreaterThanOrEqual(70);
    });
  });

  describe('helpers export what they advertise', () => {
    // A dynamic import + shape check, not a filename check: a helper that
    // exists but has lost `seedTenant` is just as broken as a missing file.
    it('tests/helpers/db.ts', async () => {
      const m = await import('../helpers/db');
      for (const fn of [
        'prismaTestClient',
        'resetDatabase',
        'seedTenant',
        'withTenant',
        'tableNames',
      ]) {
        expect(typeof m[fn as keyof typeof m]).toBe('function');
      }
    });

    it('tests/helpers/rls.ts', async () => {
      const m = await import('../helpers/rls');
      for (const fn of ['asAppUser', 'asAppSuperuser', 'expectRlsIsolated']) {
        expect(typeof m[fn as keyof typeof m]).toBe('function');
      }
    });

    it('tests/helpers/make-context.ts', async () => {
      const m = await import('../helpers/make-context');
      expect(typeof m.buildRequestContext).toBe('function');
    });

    it('tests/helpers/msw.ts', async () => {
      const m = await import('../helpers/msw');
      expect(Array.isArray(m.handlers)).toBe(true);
      expect(m.handlers.length).toBeGreaterThan(0);
      expect(typeof m.useMswServer).toBe('function');
    });

    it('tests/helpers/stripe-webhook.ts', async () => {
      const m = await import('../helpers/stripe-webhook');
      expect(typeof m.signStripeWebhook).toBe('function');
      expect(typeof m.paymentIntentSucceeded).toBe('function');
    });
  });

  describe('playwright', () => {
    const cfg = read('playwright.config.ts');

    it('never reuses an existing server', () => {
      // `reuseExistingServer: !CI` let a stale `next start` keep serving an
      // OLD build locally, so CSS/token changes were invisible to the specs
      // — an axe pass and a screenshot baseline were both produced against
      // stale output before this was caught. Never again.
      expect(cfg).toContain('reuseExistingServer: false');
    });

    it('imports the fixtures module', () => {
      expect(existsSync(join(root, 'tests/e2e/fixtures.ts'))).toBe(true);
    });
  });

  describe('the test database is isolated from dev', () => {
    const compose = read('docker-compose.test.yml');

    it('binds Postgres and Redis to ALTERNATE ports', () => {
      // resetDatabase() TRUNCATEs. If the test stack shared the dev stack's
      // ports, a test run would destroy the developer's data.
      expect(compose).toContain('55432:5432');
      expect(compose).toContain('63790:6379');
    });

    it('uses isolated volumes', () => {
      expect(compose).toContain('playerz-test-pgdata');
    });

    it('the harness refuses a non-test DATABASE_URL', async () => {
      const { prismaTestClient } = await import('../helpers/db');
      const saved = process.env.DATABASE_URL;
      try {
        // Simulate a mis-set env pointing at the dev database.
        process.env.DATABASE_URL = 'postgresql://playerz:playerz@localhost:5432/playerz';
        jest.resetModules();
        const fresh = await import('../helpers/db');
        expect(() => fresh.prismaTestClient()).toThrow(/non-test database/i);
      } finally {
        process.env.DATABASE_URL = saved;
        jest.resetModules();
      }
      expect(typeof prismaTestClient).toBe('function');
    });
  });

  describe('CI', () => {
    const ci = read('.github/workflows/ci.yml');

    it('runs every gate the branch protection requires', () => {
      for (const job of [
        'lint:',
        'typecheck:',
        'test:',
        'integration:',
        'build:',
        'e2e:',
        'security:',
        'codeql:',
        'trivy:',
      ]) {
        expect(ci).toContain(`\n  ${job}`);
      }
    });

    it('has a single gate job that fails if any upstream job fails', () => {
      expect(ci).toContain('ci-gate:');
      expect(ci).toContain('failure|cancelled');
    });

    it('creates the RLS roles before running integration tests', () => {
      expect(ci).toContain('CREATE ROLE app_user');
      expect(ci).toContain('BYPASSRLS');
    });
  });
});
