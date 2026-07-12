/**
 * @jest-environment node
 *
 * Node, not jsdom: this exercises the Stripe SDK (needs global fetch),
 * MSW's interceptors (need TextEncoder) and Prisma — none of which jsdom
 * provides.
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * The RLS policy must fail CLOSED.
 *
 * `current_setting('app.tenant_id', true)` returns NULL when unset, and
 * `col = NULL` is NULL — not TRUE — so an unscoped session matches no
 * rows. The `true` second argument is load-bearing: without it Postgres
 * RAISES on a missing setting instead of returning NULL, which turns a
 * clean "0 rows" into a 500. Both spellings "work" in the happy path, so
 * only a test pins the difference.
 */
describe('RLS policy shape', () => {
  const sql = globSync('prisma/migrations/**/migration.sql')
    .map((f) => readFileSync(f.toString(), 'utf8'))
    .join('\n');

  it('every tenant-scoped table has ENABLE + FORCE row level security', () => {
    for (const table of ['tenant_membership', 'venue_org']) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      // FORCE matters: without it the TABLE OWNER bypasses its own policy,
      // and migrations run as the owner — so the policy would be untested
      // in exactly the session that matters.
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
  });

  it('policies use current_setting(..., true) so an unset tenant yields NULL, not an error', () => {
    expect(sql).toContain("current_setting('app.tenant_id', true)");
    // The bare one-argument form RAISES on a missing setting instead of
    // returning NULL, turning a clean "0 rows" into a 500.
    expect(sql).not.toMatch(/current_setting\(\s*'app\.tenant_id'\s*\)/);
  });

  it('app_superuser has BYPASSRLS and app_user does not', () => {
    expect(sql).toMatch(/CREATE ROLE app_superuser NOLOGIN BYPASSRLS/);
    expect(sql).toMatch(/CREATE ROLE app_user NOLOGIN;/);
    expect(sql).not.toMatch(/CREATE ROLE app_user NOLOGIN BYPASSRLS/);
  });
});
