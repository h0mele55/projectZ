-- ════════════════════════════════════════════════════════════════════
--  Destructive statements removed by hand — the THIRD time.
--
--  Prisma proposed:
--      DROP INDEX "venue_geog_idx";
--
--  `venue_geog_idx` is a GiST index. Prisma cannot model it, so `migrate diff`
--  sees it in the live database, does not find it in the schema, and proposes
--  removing it — on EVERY migration, forever. Dropping it would silently turn
--  "venues near me" into a sequential scan over every venue in the country.
--
--  This is now caught structurally rather than by vigilance:
--  `tests/guardrails/migration-safety.test.ts` fails the build on any
--  migration that DROPs a protected object (the EXCLUDE constraints, geog,
--  the GiST index, the ledger trigger) without recreating it.
-- ════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "SplitStatus" AS ENUM ('PENDING', 'PAID', 'WAIVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('SPLIT_REIMBURSEMENT', 'REFUND_CREDIT', 'ADMIN_ADJUST', 'SPEND');


-- CreateTable
CREATE TABLE "booking_split" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "inviteEmail" TEXT,
    "shareCents" INTEGER NOT NULL,
    "status" "SplitStatus" NOT NULL DEFAULT 'PENDING',
    "paymentIntentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_split_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger_entry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deltaCents" INTEGER NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "balanceAfterCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_split_tokenHash_key" ON "booking_split"("tokenHash");

-- CreateIndex
CREATE INDEX "booking_split_tenantId_idx" ON "booking_split"("tenantId");

-- CreateIndex
CREATE INDEX "booking_split_bookingId_idx" ON "booking_split"("bookingId");

-- CreateIndex
CREATE INDEX "booking_split_userId_idx" ON "booking_split"("userId");

-- CreateIndex
CREATE INDEX "booking_split_expiresAt_idx" ON "booking_split"("expiresAt");

-- CreateIndex
CREATE INDEX "credit_ledger_entry_tenantId_userId_createdAt_idx" ON "credit_ledger_entry"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "credit_ledger_entry_refType_refId_idx" ON "credit_ledger_entry"("refType", "refId");

-- AddForeignKey
ALTER TABLE "booking_split" ADD CONSTRAINT "booking_split_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════
--  THE LEDGER IS APPEND-ONLY, AND THE DATABASE ENFORCES IT.
--
--  A wallet you can UPDATE is not a ledger; it is a mutable number with extra
--  steps. The entire value of the append-only shape is that a balance can be
--  RECONSTRUCTED and DISPUTED — "you say I have €12, prove it" has to be
--  answerable by replaying the entries.
--
--  Enforcing that in application code means every future repository, every
--  admin script, every migration and every `psql` session is on the honour
--  system. One `UPDATE credit_ledger_entry SET ...` to "fix" a support ticket
--  and the history is a lie that nobody can detect afterwards.
--
--  So the trigger raises. Application code cannot bypass it, a repository bug
--  cannot silently rewrite history, and a well-meaning operator with a
--  database prompt cannot either.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'credit_ledger_entry is APPEND-ONLY: % is not permitted. A ledger you can rewrite is not a ledger. To correct a balance, INSERT a compensating entry (reason=ADMIN_ADJUST).',
    TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_append_only_trg ON "credit_ledger_entry";
CREATE TRIGGER ledger_append_only_trg
  BEFORE UPDATE OR DELETE ON "credit_ledger_entry"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- ── Split share sanity, enforced by the database ────────────────────
--
-- A zero or negative share is not a split, it is a bug. The SUM invariant
-- (shares == booking total) cannot be expressed as a row CHECK — it is
-- enforced in the usecase and tested — but a non-positive share can, and is.
ALTER TABLE "booking_split"
  ADD CONSTRAINT booking_split_positive CHECK ("shareCents" > 0);

-- ── RLS ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['booking_split', 'credit_ledger_entry'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = current_setting('app.tenant_id', true))
        WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))
    $f$, t);
    EXECUTE format('DROP POLICY IF EXISTS superuser_bypass ON %I', t);
    EXECUTE format('CREATE POLICY superuser_bypass ON %I TO app_superuser USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
