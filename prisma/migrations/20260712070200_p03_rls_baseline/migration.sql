-- ── RLS baseline ────────────────────────────────────────────────────
--
-- Tenant isolation is enforced by Postgres, not by the app layer. A
-- forgotten `where: { tenantId }` in a repository is a bug; it must not
-- be a data breach. Every tenant-scoped table gets a policy keyed on
-- `current_setting('app.tenant_id', true)`.
--
-- Two roles:
--   app_user       — what the request path runs as. RLS applies.
--   app_superuser  — BYPASSRLS. Migrations, jobs, and the E2E teardown
--                    that must see across tenants.
--
-- The roles are NOLOGIN: the connection authenticates as the owner and
-- then SET LOCAL ROLE inside a transaction, so a leaked app credential
-- cannot itself bypass RLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_superuser') THEN
    CREATE ROLE app_superuser NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- The connecting user must be able to assume both roles.
DO $$
BEGIN
  EXECUTE format('GRANT app_user, app_superuser TO %I', current_user);
END $$;

GRANT USAGE ON SCHEMA public TO app_user, app_superuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_superuser;

-- ── tenant_membership — the tenant-scoped table ─────────────────────
ALTER TABLE "tenant_membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_membership" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tenant_membership";
CREATE POLICY tenant_isolation ON "tenant_membership"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- ── venue_org — a tenant may only see its own row ───────────────────
ALTER TABLE "venue_org" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "venue_org" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "venue_org";
CREATE POLICY tenant_isolation ON "venue_org"
  USING ("id" = current_setting('app.tenant_id', true))
  WITH CHECK ("id" = current_setting('app.tenant_id', true));

-- app_user (no BYPASSRLS) is the only role the request path assumes.
-- `current_setting(..., true)` returns NULL when unset, and `col = NULL`
-- is NULL (not true) — so an unscoped session sees ZERO rows rather than
-- every row. That is the fail-closed property the harness asserts.

-- NOTE: `app_user` is deliberately NOT applied to "app_user" (the User
-- table). Players are global — a user is not owned by a tenant.
