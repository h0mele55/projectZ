-- ════════════════════════════════════════════════════════════════════
--  P13 — Court → Resource. HAND-WRITTEN, and it has to be.
--
--  `prisma migrate diff` generates this for the same schema change:
--
--      ALTER TABLE "booking" DROP COLUMN "courtId",
--                            ADD COLUMN  "resourceId" TEXT NOT NULL;
--
--  That is DATA LOSS. Every existing booking's court reference is
--  destroyed — and it takes `booking_no_overlap` with it, because an
--  EXCLUDE constraint on a dropped column is dropped too. The double-
--  booking defence would silently disappear in a migration whose diff
--  looks routine.
--
--  Prisma's differ cannot see a rename; it only sees "column gone, column
--  appeared". So we write RENAME COLUMN ourselves.
--
--  The payoff: Postgres updates dependent indexes and constraints
--  automatically on a RENAME, so `booking_no_overlap` survives and now
--  reads `resourceId`. The integration test re-runs the P05 race assertion
--  verbatim to prove it, rather than trusting this comment.
-- ════════════════════════════════════════════════════════════════════

-- ── New enum ────────────────────────────────────────────────────────
CREATE TYPE "ResourceType" AS ENUM ('COURT', 'FIELD', 'TABLE', 'BOARD_TABLE', 'LOBBY', 'ROUTE');

-- ── New sports ──────────────────────────────────────────────────────
ALTER TYPE "SportType" ADD VALUE IF NOT EXISTS 'BEACH_TENNIS';
ALTER TYPE "SportType" ADD VALUE IF NOT EXISTS 'PICKLEBALL';
ALTER TYPE "SportType" ADD VALUE IF NOT EXISTS 'FOOTBALL';
ALTER TYPE "SportType" ADD VALUE IF NOT EXISTS 'BEACH_VOLLEYBALL';
ALTER TYPE "SportType" ADD VALUE IF NOT EXISTS 'HANDBALL';
ALTER TYPE "SportType" ADD VALUE IF NOT EXISTS 'CHESS';
ALTER TYPE "SportType" ADD VALUE IF NOT EXISTS 'ESPORTS';
ALTER TYPE "SportType" ADD VALUE IF NOT EXISTS 'RUNNING';
ALTER TYPE "SportType" ADD VALUE IF NOT EXISTS 'CYCLING';

-- ── court gains resource fields ─────────────────────────────────────
ALTER TABLE "court" ADD COLUMN "resourceType" "ResourceType" NOT NULL DEFAULT 'COURT';
ALTER TABLE "court" ADD COLUMN "metadataJson" JSONB NOT NULL DEFAULT '{}';

-- ── THE RENAMES. Not drop+add. ──────────────────────────────────────
--
-- Postgres carries dependent indexes, FKs and CONSTRAINTS across a column
-- rename automatically — which is precisely why this must be a rename.
ALTER TABLE "booking"            RENAME COLUMN "courtId" TO "resourceId";
ALTER TABLE "coach_booking"      RENAME COLUMN "courtId" TO "resourceId";
ALTER TABLE "court_availability" RENAME COLUMN "courtId" TO "resourceId";
ALTER TABLE "open_play_session"  RENAME COLUMN "courtId" TO "resourceId";

-- ── open_play_session: endurance sports have nothing to reserve ─────
--
-- A running session is a meeting point, not a booking. There is no resource,
-- so resourceId must become nullable — and an EXCLUDE constraint on routes
-- would be absurd anyway (it would stop two groups running the same trail).
ALTER TABLE "open_play_session" ALTER COLUMN "resourceId" DROP NOT NULL;

ALTER TABLE "open_play_session" ADD COLUMN "sportFamily"     TEXT NOT NULL DEFAULT 'RACKET';
ALTER TABLE "open_play_session" ADD COLUMN "locationMode"    TEXT NOT NULL DEFAULT 'RESOURCE';
ALTER TABLE "open_play_session" ADD COLUMN "meetingPointLat" DECIMAL(10,7);
ALTER TABLE "open_play_session" ADD COLUMN "meetingPointLng" DECIMAL(10,7);
ALTER TABLE "open_play_session" ADD COLUMN "routeRef"        TEXT;

-- A meeting-point session has coordinates; a resource session has a resource.
-- Neither half may be silently absent.
ALTER TABLE "open_play_session"
  ADD CONSTRAINT session_location_coherent CHECK (
    ("locationMode" = 'RESOURCE'      AND "resourceId" IS NOT NULL)
    OR
    ("locationMode" = 'MEETING_POINT' AND "meetingPointLat" IS NOT NULL
                                      AND "meetingPointLng" IS NOT NULL)
  );

-- ── Rename the indexes Prisma expects to find by name ───────────────
ALTER INDEX IF EXISTS "booking_tenantId_courtId_startTs_idx"    RENAME TO "booking_tenantId_resourceId_startTs_idx";
ALTER INDEX IF EXISTS "booking_courtId_idx"                     RENAME TO "booking_resourceId_idx";
ALTER INDEX IF EXISTS "coach_booking_courtId_idx"               RENAME TO "coach_booking_resourceId_idx";
ALTER INDEX IF EXISTS "court_availability_courtId_dayOfWeek_idx" RENAME TO "court_availability_resourceId_dayOfWeek_idx";
ALTER INDEX IF EXISTS "open_play_session_courtId_idx"           RENAME TO "open_play_session_resourceId_idx";
ALTER INDEX IF EXISTS "pricing_rule_tenantId_courtId_priority_idx" RENAME TO "pricing_rule_tenantId_resourceId_priority_idx";

-- pricing_rule's column too.
ALTER TABLE "pricing_rule" RENAME COLUMN "courtId" TO "resourceId";

CREATE INDEX IF NOT EXISTS "court_tenantId_resourceType_idx" ON "court" ("tenantId", "resourceType");
