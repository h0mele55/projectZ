/**
 * Stub — P03 populates the four real projects
 * (unit / rendered / integration / guardrails).
 *
 * The guardrails project is defined here already so
 * tests/guardrails/harness-sanity.test.ts has a proving ground that
 * jest can import from src/.
 */
const config = {
  projects: [
    {
      displayName: 'guardrails',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/guardrails/**/*.test.ts'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      transform: { '^.+\\.(t|j)sx?$': ['@swc/jest'] },
    },
  ],
};

export default config;
