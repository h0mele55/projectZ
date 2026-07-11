/**
 * P02 adds the `unit` + `rendered` projects so the primitives can be
 * proven. P03 replaces this with the full four-project spine
 * (unit / rendered / integration / guardrails) + coverage thresholds.
 */
// Packages that ship pure ESM. Jest does not transform node_modules by
// default, so their bare `export` statements are a SyntaxError inside the
// CJS test runtime. Each entry here is a package that actually broke a
// test run — keep it minimal, and add only with a reproduction.
const ESM_PACKAGES = [
  'next-intl',
  'use-intl',
  // The whole FormatJS chain under use-intl is ESM: intl-messageformat
  // pulls @formatjs/{icu-messageformat-parser,fast-memoize,ecma402-abstract,…}.
  'intl-messageformat',
  '@formatjs/[^/]+',
].join('|');

// The components use the automatic JSX runtime (no `import React`), so
// swc must be told — its default is the classic runtime, which fails with
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
  transform: { '^.+\\.(t|j)sx?$': SWC_TRANSFORM },
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
      displayName: 'guardrails',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/guardrails/**/*.test.ts'],
    },
  ],
};

export default config;
