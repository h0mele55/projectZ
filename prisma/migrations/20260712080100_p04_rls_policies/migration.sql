-- ── RLS for every tenant-scoped table P04 added ──────────────────────
--
-- Rule: a table with a tenantId gets a policy. The `rls-coverage`
-- guardrail parses the schema and fails if any tenant-scoped model is
-- missing one — "forgot to add a policy" must not survive review.
--
-- `app_user` (no BYPASSRLS) is what the request path assumes.
-- `superuser_bypass` is granted TO app_superuser only.
--
-- NOTE ON THE ID TYPE. P04's prompt casts `current_setting(...)::uuid`.
-- Our ids are cuid (String), which is what P03 shipped and what `main`
-- already carries — casting a cuid to uuid throws on EVERY query. So the
-- comparison is text = text. Injection is prevented upstream by
-- parameterised `set_config('app.tenant_id', $1, true)` plus a strict
-- format check in `runInTenantContext`, not by the cast.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;

-- ── Symmetric policies: tenantId is NOT NULL ────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invite',
    'tenant_security_settings',
    'tenant_custom_role',
    'api_key'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE matters: ENABLE alone exempts the table OWNER, and migrations
    -- run as the owner — so the policy would go untested in exactly the
    -- session that matters.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = current_setting('app.tenant_id', true))
        WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))
    $f$, t);

    EXECUTE format('DROP POLICY IF EXISTS superuser_bypass ON %I', t);
    EXECUTE format($f$
      CREATE POLICY superuser_bypass ON %I TO app_superuser
        USING (true) WITH CHECK (true)
    $f$, t);
  END LOOP;
END $$;

-- venue_org keys on its own id, not a tenantId column.
ALTER TABLE "venue_org" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "venue_org" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "venue_org";
CREATE POLICY tenant_isolation ON "venue_org"
  USING ("id" = current_setting('app.tenant_id', true))
  WITH CHECK ("id" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS superuser_bypass ON "venue_org";
CREATE POLICY superuser_bypass ON "venue_org" TO app_superuser
  USING (true) WITH CHECK (true);

ALTER TABLE "tenant_membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_membership" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_membership";
CREATE POLICY tenant_isolation ON "tenant_membership"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS superuser_bypass ON "tenant_membership";
CREATE POLICY superuser_bypass ON "tenant_membership" TO app_superuser
  USING (true) WITH CHECK (true);

-- ── user_session — ASYMMETRIC, because tenantId is NULLABLE ─────────
--
-- A session exists between sign-in and tenant selection, so it must be
-- READABLE while tenantId IS NULL. But WITH CHECK deliberately omits the
-- NULL branch: you may read a pre-tenant session, you may never WRITE a
-- row belonging to a tenant that isn't yours. Making WITH CHECK symmetric
-- with USING here would let a session be re-parented into another tenant.
ALTER TABLE "user_session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_session" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_session";
CREATE POLICY tenant_isolation ON "user_session"
  USING (
    "tenantId" IS NULL
    OR "tenantId" = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    "tenantId" = current_setting('app.tenant_id', true)
  );
DROP POLICY IF EXISTS superuser_bypass ON "user_session";
CREATE POLICY superuser_bypass ON "user_session" TO app_superuser
  USING (true) WITH CHECK (true);

-- ── NO RLS: app_user (User) and player_profile ──────────────────────
--
-- Global by design. A player is one identity with one rating across every
-- venue they play at. Putting them behind a tenant policy would mean a
-- player joining a second club needs a second account and their Glicko-2
-- rating forks. The rls-coverage guardrail allowlists exactly these two.
