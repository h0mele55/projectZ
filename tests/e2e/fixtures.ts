import { test as base, expect } from '@playwright/test';

import {
  createIsolatedTenant,
  destroyTenant,
  type IsolatedTenant,
} from './utils/create-isolated-tenant';

/**
 * The E2E fixture spine.
 *
 * `fullyParallel` is on, so mutating specs MUST NOT share a tenant — two
 * specs booking "the last slot" on the same court would race and flake in
 * a way that looks like a product bug. `isolatedTenant` gives each spec its
 * own VenueOrg and tears it down afterwards. Read-only specs can use the
 * shared seed instead and skip the setup cost.
 */

interface Fixtures {
  isolatedTenant: IsolatedTenant;
  authedPage: import('@playwright/test').Page;
}

export const test = base.extend<Fixtures>({
  isolatedTenant: async ({}, use) => {
    const tenant = await createIsolatedTenant();
    await use(tenant);
    // Runs even if the spec failed — a crashed spec must not leak a tenant
    // into the next run's data.
    await destroyTenant(tenant.tenantId);
  },

  authedPage: async ({ page, isolatedTenant }, use) => {
    // Programmatic sign-in, not a UI login. Driving the login form in every
    // spec makes each of them a login test too — so a broken login page
    // fails 40 unrelated specs and buries the real signal. P07 wires the
    // NextAuth credentials endpoint this posts to.
    const res = await page.request.post('/api/auth/callback/credentials', {
      form: {
        email: isolatedTenant.email,
        password: isolatedTenant.password,
        csrfToken: await csrfToken(page),
        json: 'true',
      },
    });

    if (!res.ok()) {
      throw new Error(
        `Programmatic sign-in failed (${res.status()}). The authedPage fixture ` +
          `cannot proceed; check the NextAuth credentials provider.`,
      );
    }

    await use(page);
  },
});

async function csrfToken(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.request.get('/api/auth/csrf');
  const body = (await res.json()) as { csrfToken: string };
  return body.csrfToken;
}

export { expect };
