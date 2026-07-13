-- CreateEnum
CREATE TYPE "TournamentFormatKind" AS ENUM ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'SWISS');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED');

-- CreateTable
CREATE TABLE "tournament" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport" "SportType" NOT NULL,
    "format" "TournamentFormatKind" NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "maxPlayers" INTEGER NOT NULL,
    "entryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "totalRounds" INTEGER NOT NULL DEFAULT 0,
    "stateJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_entry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "playerUserId" TEXT NOT NULL,
    "seedRating" INTEGER,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_match" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "homeUserId" TEXT NOT NULL,
    "awayUserId" TEXT,
    "homeScore" DOUBLE PRECISION,
    "awayScore" DOUBLE PRECISION,
    "reportedAt" TIMESTAMP(3),

    CONSTRAINT "tournament_match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournament_tenantId_status_startsAt_idx" ON "tournament"("tenantId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "tournament_tenantId_idx" ON "tournament"("tenantId");

-- CreateIndex
CREATE INDEX "tournament_entry_tenantId_idx" ON "tournament_entry"("tenantId");

-- CreateIndex
CREATE INDEX "tournament_entry_playerUserId_idx" ON "tournament_entry"("playerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_entry_tournamentId_playerUserId_key" ON "tournament_entry"("tournamentId", "playerUserId");

-- CreateIndex
CREATE INDEX "tournament_match_tenantId_idx" ON "tournament_match"("tenantId");

-- CreateIndex
CREATE INDEX "tournament_match_tournamentId_round_idx" ON "tournament_match"("tournamentId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_match_tournamentId_round_homeUserId_key" ON "tournament_match"("tournamentId", "round", "homeUserId");

-- AddForeignKey
ALTER TABLE "tournament_entry" ADD CONSTRAINT "tournament_entry_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_match" ADD CONSTRAINT "tournament_match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE "tournament" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tournament_entry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_entry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tournament_match" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tournament_match" FORCE ROW LEVEL SECURITY;

-- 2-arg current_setting: NULL rather than an error when unset, and
-- `tenantId = NULL` is NULL, not TRUE. Fail-closed.
CREATE POLICY tournament_tenant_isolation ON "tournament"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tournament_entry_tenant_isolation ON "tournament_entry"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tournament_match_tenant_isolation ON "tournament_match"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- A player cannot be their own opponent. The pairing code refuses it; this is
-- the backstop, because a bracket that pairs someone against themselves is not
-- a bug you want to discover from a support ticket on finals day.
ALTER TABLE "tournament_match" ADD CONSTRAINT tournament_match_distinct_players CHECK (
  "awayUserId" IS NULL OR "homeUserId" <> "awayUserId"
);

-- A round is 1-based. Round 0 is not a round.
ALTER TABLE "tournament_match" ADD CONSTRAINT tournament_match_round_positive CHECK ("round" >= 1);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;
