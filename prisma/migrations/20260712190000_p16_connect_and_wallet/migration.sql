-- P16 — Stripe Connect, Billing, and the retirement of the mutable wallet.
--
-- ─── The two credit models that are being DROPPED ────────────────────
--
-- `credit_balance` / `credit_transaction` were scaffolded earlier and never
-- used by a single line of application code. They stored a balance as a
-- MUTABLE COLUMN (`credit_balance.balanceCents`) with a transaction log beside
-- it that nothing reconciled against.
--
-- `credit_ledger_entry` (added in the previous migration) replaces them: it is
-- append-only, enforced by a trigger, and the balance is DERIVED. Leaving both
-- in place would mean two wallets in one codebase — and eventually someone
-- reads the wrong one and a customer is told they have money they do not have.
--
-- Both tables are empty; this drops no data.

-- DropForeignKey
ALTER TABLE "credit_transaction" DROP CONSTRAINT "credit_transaction_balanceId_fkey";

-- DropTable
DROP TABLE "credit_transaction";

-- DropTable
DROP TABLE "credit_balance";

-- The same mistake, one model over: a mutable per-venue credit column.
-- Never read, never written. Credit lives in the ledger.
ALTER TABLE "player_venue_relationship" DROP COLUMN "creditBalanceCents";

-- ─── Stripe Connect ──────────────────────────────────────────────────
--
-- `payoutsEnabled` mirrors what Stripe reports in `account.updated`. We do not
-- set it ourselves when onboarding "looks complete": Stripe rejects a
-- destination charge to an account that cannot receive payouts, and that
-- rejection lands AFTER the customer has entered their card — they would see a
-- card failure for a problem that is entirely the club's.
ALTER TABLE "venue_org"
  ADD COLUMN "payoutsEnabled"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stripeCustomerId"     TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT;

-- Unique, because a duplicate would let one `invoice.paid` flip two venues'
-- plan tier — and the plan tier sets the commission we charge.
CREATE UNIQUE INDEX "venue_org_stripeCustomerId_key"     ON "venue_org"("stripeCustomerId");
CREATE UNIQUE INDEX "venue_org_stripeSubscriptionId_key" ON "venue_org"("stripeSubscriptionId");

-- ─── Memberships billed through Stripe Billing ───────────────────────
ALTER TABLE "membership" ADD COLUMN "stripeSubscriptionId" TEXT;

-- Unique: two memberships pointing at one subscription would both activate on
-- a single `invoice.paid`, giving away a membership nobody paid for.
CREATE UNIQUE INDEX "membership_stripeSubscriptionId_key" ON "membership"("stripeSubscriptionId");
