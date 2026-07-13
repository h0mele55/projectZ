-- P19 — openskill team ratings, and an honest rating history.
--
-- `skill_rating_history` gains `engine` and `displayRating` as NOT NULL with no
-- backfill. That is safe HERE and only here: the table has zero rows and no code
-- has ever written to it (it was scaffolded in P10 and never wired up). On a
-- table with data this would fail outright, which is the correct behaviour — a
-- default `engine` would be a lie, because there is no engine that is right for
-- a row whose engine we do not know.
--
-- `phi` becomes NULLABLE because openskill has no phi. A 0 would read as
-- "perfectly certain" — the exact opposite of what a missing value means.

-- CreateEnum
CREATE TYPE "RatingEngine" AS ENUM ('GLICKO2', 'OPENSKILL');

-- AlterTable
ALTER TABLE "skill_rating_history" ADD COLUMN     "displayRating" DECIMAL(8,2) NOT NULL,
ADD COLUMN     "engine" "RatingEngine" NOT NULL,
ALTER COLUMN "mu" SET DATA TYPE DECIMAL(8,4),
ALTER COLUMN "phi" DROP NOT NULL,
ALTER COLUMN "phi" SET DATA TYPE DECIMAL(8,4),
ALTER COLUMN "sigma" SET DATA TYPE DECIMAL(8,6);

-- CreateTable
CREATE TABLE "match_result" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "sport" "SportType" NOT NULL,
    "sessionId" TEXT,
    "teamsJson" JSONB NOT NULL,
    "ranksJson" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "reportedByUserId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_result_dedupeKey_key" ON "match_result"("dedupeKey");

-- CreateIndex
CREATE INDEX "match_result_tenantId_sport_recordedAt_idx" ON "match_result"("tenantId", "sport", "recordedAt");

-- CreateIndex
CREATE INDEX "match_result_sessionId_idx" ON "match_result"("sessionId");


-- ─── RLS ─────────────────────────────────────────────────────────────
--
-- `match_result` is tenant-scoped but allows a NULL tenant: a casual game
-- between two players belongs to them, not to a club.
--
-- `skill_rating_history` carries NO tenantId, deliberately — a player's rating
-- is theirs and travels between clubs, exactly like their XP and their badges.
ALTER TABLE "match_result" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_result" FORCE ROW LEVEL SECURITY;

-- 2-arg current_setting: returns NULL rather than raising when unset, and
-- `tenantId = NULL` is NULL, not true. Fail-closed.
CREATE POLICY match_result_tenant_isolation ON "match_result"
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true));

-- A rating row must say which engine produced it, and phi must be present for
-- Glicko and absent for openskill. A Glicko row with no phi is uninterpretable;
-- an openskill row WITH a phi means someone wrote the wrong shape into it.
ALTER TABLE "skill_rating_history" ADD CONSTRAINT rating_engine_shape CHECK (
  (engine = 'GLICKO2'   AND phi IS NOT NULL) OR
  (engine = 'OPENSKILL' AND phi IS NULL)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;
-- CreateEnum
CREATE TYPE "MatchOutcome" AS ENUM ('WIN', 'LOSS', 'DRAW');

-- CreateTable
CREATE TABLE "match_participant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sport" "SportType" NOT NULL,
    "teamIndex" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "outcome" "MatchOutcome" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_participant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_participant_userId_sport_recordedAt_idx" ON "match_participant"("userId", "sport", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "match_participant_matchId_userId_key" ON "match_participant"("matchId", "userId");

-- AddForeignKey
ALTER TABLE "match_participant" ADD CONSTRAINT "match_participant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match_result"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "match_participant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_participant" FORCE ROW LEVEL SECURITY;

-- No tenantId: a player's record is THEIRS and follows them between clubs,
-- exactly like their XP and their badges. RLS is enabled with a permissive
-- policy so the table cannot be reached without going through the app roles.
CREATE POLICY match_participant_readable ON "match_participant" USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;
