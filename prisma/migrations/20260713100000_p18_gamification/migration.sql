-- CreateEnum
CREATE TYPE "XpEventType" AS ENUM ('BOOKING_COMPLETED', 'MATCH_PLAYED', 'REVIEW_PUBLISHED', 'SESSION_HOSTED', 'STREAK_WEEK', 'PROFILE_COMPLETED', 'FIRST_BOOKING', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "xp_event" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "type" "XpEventType" NOT NULL,
    "points" INTEGER NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "ruleJson" JSONB NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievement_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "user_achievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementCode" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_achievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "xp_event_dedupeKey_key" ON "xp_event"("dedupeKey");

-- CreateIndex
CREATE INDEX "xp_event_userId_createdAt_idx" ON "xp_event"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "xp_event_tenantId_userId_idx" ON "xp_event"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "xp_event_refType_refId_idx" ON "xp_event"("refType", "refId");

-- CreateIndex
CREATE INDEX "user_achievement_userId_idx" ON "user_achievement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_achievement_userId_achievementCode_key" ON "user_achievement"("userId", "achievementCode");

-- AddForeignKey
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_achievementCode_fkey" FOREIGN KEY ("achievementCode") REFERENCES "achievement"("code") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── RLS ─────────────────────────────────────────────────────────────
--
-- `xp_event` is tenant-scoped but ALLOWS a null tenant: XP earned in a DM-style
-- context, or a global achievement, belongs to the player rather than a club.
-- Same shape as Conversation (P15) and ModerationCase (P17).
--
-- `achievement` and `user_achievement` are GLOBAL by design — a badge is the
-- player's, and it travels with them between clubs. They carry no tenantId, so
-- they are not RLS-scoped; the guardrail's cross-tenant allowance is documented
-- at the call sites.
ALTER TABLE "xp_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "xp_event" FORCE ROW LEVEL SECURITY;

-- The 2-arg current_setting returns NULL rather than raising when unset, and
-- `tenantId = NULL` is NULL, not true. Fail-closed.
CREATE POLICY xp_event_tenant_isolation ON "xp_event"
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true));

-- ─── XP is a LEDGER, not a counter ───────────────────────────────────
--
-- Same reasoning as credit_ledger_entry: "why am I level 7?" must be answerable
-- by replaying the rows, and a clawback must be a visible compensating entry
-- rather than a quiet subtraction. An UPDATE to a past award destroys both.
--
-- DELETE is permitted — unlike the credit ledger — because XP is not money and
-- GDPR erasure has to be able to remove a user's history. UPDATE is not.
CREATE OR REPLACE FUNCTION xp_event_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'xp_event is append-only: UPDATE is not permitted. To correct an award, INSERT a compensating ADJUSTMENT event.'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER xp_event_no_update_trg
  BEFORE UPDATE ON "xp_event"
  FOR EACH ROW EXECUTE FUNCTION xp_event_no_update();

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;
