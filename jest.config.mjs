/**
 * The four-project test spine.
 *
 *   unit         — jsdom, pure logic + helpers. Fast, no I/O.
 *   rendered     — jsdom + RTL, component smoke.
 *   integration  — node, REAL Postgres + Redis. Serial (see maxWorkers).
 *   guardrails   — node, structural scans over the source tree.
 *
 * ─── The coverageThreshold trap ──────────────────────────────────────
 *
 * P03's prompt puts `coverageThreshold` at the TOP LEVEL alongside
 * `projects`. In multi-project mode jest SILENTLY IGNORES it — the run
 * exits 0 no matter how far below the floor coverage actually is. The port
 * source hit exactly this and documents it: their thresholds were
 * "documented but NEVER enforced" until enforcement moved to the CLI.
 *
 * So we do both:
 *   1. thresholds live INSIDE the project blocks, where they are honoured; and
 *   2. `jest.thresholds.json` is the single source of truth that the CI
 *      coverage gate passes via `--coverageThreshold`, which IS enforced.
 *
 * A guardrail (`test-infra-integrity`) asserts the top-level key stays
 * absent, so nobody "helpfully" moves it back.
 */
import { readFileSync } from 'node:fs';

const thresholds = JSON.parse(readFileSync(new URL('./jest.thresholds.json', import.meta.url)));

// Packages that ship pure ESM. Jest does not transform node_modules by
// default, so their bare `export` statements are a SyntaxError in the CJS
// test runtime. Add only with a reproduction.
const ESM_PACKAGES = [
  'next-intl',
  'use-intl',
  // The FormatJS chain under use-intl: intl-messageformat pulls
  // @formatjs/{icu-messageformat-parser,fast-memoize,ecma402-abstract,…}.
  'intl-messageformat',
  '@formatjs/[^/]+',
  // MSW and its interceptors ship ESM-only.
  'msw',
  '@mswjs/[^/]+',
  '@bundled-es-modules/[^/]+',
  'until-async',
  'strict-event-emitter',
  'rettime',
  'outvariant',
  'headers-polyfill',
  '@open-draft/[^/]+',
  'is-node-process',
  'graphql',
  'tough-cookie',
  'psl',
].join('|');

// The components use the automatic JSX runtime (no `import React`), so swc
// must be told — its default is the classic runtime, which fails with
// "React is not defined" at the first JSX node.
const SWC_TRANSFORM = [
  '@swc/jest',
  {
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      transform: { react: { runtime: 'automatic' } },
    },
  },
];

const common = {
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // `.mjs` MUST be in the pattern. MSW's ESM deps (rettime, outvariant)
  // ship .mjs — allowlisting them in transformIgnorePatterns does nothing
  // if the transform itself never matches the extension.
  transform: { '^.+\\.(m|c)?[tj]sx?$': SWC_TRANSFORM },
  transformIgnorePatterns: [`/node_modules/(?!(?:${ESM_PACKAGES})/)`],
};

const config = {
  projects: [
    {
      ...common,
      displayName: 'unit',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts?(x)'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      coverageThreshold: thresholds,
    },
    {
      ...common,
      displayName: 'rendered',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/tests/rendered/**/*.test.ts?(x)'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts', '<rootDir>/tests/helpers/rtl-setup.ts'],
    },
    {
      ...common,
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts', '<rootDir>/tests/helpers/db-setup.ts'],
      // Serial. resetDatabase() TRUNCATEs — a parallel worker would wipe
      // another worker's rows mid-test.
      maxWorkers: 1,
      coverageThreshold: thresholds,
    },
    {
      ...common,
      displayName: 'guardrails',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/guardrails/**/*.test.ts'],
    },
  ],

  collectCoverageFrom: [
    'src/lib/**/*.{ts,tsx}',
    'src/app-layer/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/index.ts',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/tests/', '\\.d\\.ts$'],
};

export default config;
