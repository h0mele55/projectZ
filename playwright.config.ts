import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

/**
 * P02 wires a real webServer so the design-system specs have an app to
 * drive. P03 replaces this with the full spine (globalSetup, isolated
 * tenant + authedPage fixtures, firefox project, junit reporter).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'retain-on-first-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // The public pages read real venues. Without a seed, `/venues` renders the
  // empty state and the specs would pass by asserting nothing — the classic
  // vacuous E2E.
  globalSetup: './tests/e2e/global-setup.ts',

  webServer: {
    // `next start` against a production build — dev-mode HMR overlays and
    // on-demand recompiles make axe runs and screenshots flaky.
    command: 'npm run build && npm run start',
    url: baseURL,
    // Deliberately NEVER reuse. With `reuseExistingServer: !CI` a server
    // left running from an earlier invocation keeps serving its OLD build,
    // so token/CSS changes are silently invisible to the specs — an axe
    // run and a screenshot baseline were both produced against stale CSS
    // before this was caught. Always rebuild; correctness beats the ~30s.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
