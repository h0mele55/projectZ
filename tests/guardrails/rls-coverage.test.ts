import { allMigrationSql, parseSchemaModels } from '../helpers/prisma-schema-models';

/**
 * RLS COVERAGE RATCHET.
 *
 * Tenant isolation is only as strong as its weakest table. Adding a model
 * with a `tenantId` and forgetting its policy produces no error, no failing
 * test, and no visible symptom — just a table any authenticated tenant can
 * read in full. That is a data breach that ships green.
 *
 * So: every model carrying a tenantId MUST have ENABLE + FORCE row level
 * security, a tenant_isolation policy, and a superuser_bypass policy. The
 * only exceptions are the two models that are global BY DESIGN, and they
 * are named here explicitly — an allowlist you must consciously edit, not
 * a rule you can silently fall outside of.
 */

/**
 * GLOBAL BY DESIGN — not an oversight.
 *
 * A player is one identity with one Glicko-2 rating across every venue.
 * Scoping User/PlayerProfile to a tenant would mean joining a second club
 * requires a second account and forks your rating.
 */
const GLOBAL_BY_DESIGN = new Set(['User', 'PlayerProfile']);

describe('RLS coverage', () => {
  const models = parseSchemaModels();
  const sql = allMigrationSql();

  it('parses the schema (a parser returning nothing would pass everything)', () => {
    // Without this, a broken regex silently makes the whole ratchet vacuous.
    expect(models.length).toBeGreaterThanOrEqual(10);
    expect(models.map((m) => m.name)).toEqual(
      expect.arrayContaining(['VenueOrg', 'User', 'PlayerProfile', 'TenantMembership']),
    );
  });

  const tenantScoped = models.filter((m) => m.hasTenantId && !GLOBAL_BY_DESIGN.has(m.name));

  it('finds the tenant-scoped models', () => {
    expect(tenantScoped.length).toBeGreaterThanOrEqual(5);
  });

  it.each(tenantScoped.map((m) => [m.name, m.table]))(
    '%s has ENABLE + FORCE row level security',
    (_name, table) => {
      // Either the literal ALTER, or the DO-block loop that emits it.
      const enabled =
        sql.includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`) ||
        new RegExp(`'${table}'`).test(sql);
      const forced =
        sql.includes(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`) ||
        new RegExp(`'${table}'`).test(sql);

      expect(enabled).toBe(true);
      expect(forced).toBe(true);
    },
  );

  it('venue_org is policy-protected on its own id', () => {
    expect(sql).toContain('ALTER TABLE "venue_org" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "venue_org" FORCE ROW LEVEL SECURITY');
  });

  it('every policy uses the two-argument current_setting (fail-closed)', () => {
    expect(sql).toContain("current_setting('app.tenant_id', true)");
    // The bare form RAISES on a missing setting instead of returning NULL,
    // turning a clean "0 rows" into a 500.
    expect(sql).not.toMatch(/current_setting\(\s*'app\.tenant_id'\s*\)/);
  });

  it('grants superuser_bypass only TO app_superuser', () => {
    expect(sql).toMatch(/CREATE POLICY superuser_bypass ON[\s\S]{0,60}TO app_superuser/);
  });

  it('User and PlayerProfile have NO tenant policy (global by design)', () => {
    // The inverse assertion matters too: if someone "helpfully" adds RLS to
    // User, a player could not sign in without a tenant already selected.
    expect(sql).not.toMatch(/ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/ALTER TABLE "player_profile" ENABLE ROW LEVEL SECURITY/);
  });

  it('the allowlist contains ONLY the two global models', () => {
    // Widening this set is how tenant isolation quietly dies. Any addition
    // has to change this test, which forces the conversation.
    expect([...GLOBAL_BY_DESIGN].sort()).toEqual(['PlayerProfile', 'User']);
  });
});
