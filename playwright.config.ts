import { defineConfig, devices } from '@playwright/test';

// Stub — P03 adds globalSetup, fixtures, reporters and the firefox
// project. Zero specs exist today, so this run exits 0.
export default defineConfig({
  testDir: 'tests/e2e',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
