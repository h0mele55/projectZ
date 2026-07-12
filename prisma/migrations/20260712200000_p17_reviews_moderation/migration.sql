-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'PENDING_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ModerationSubject" AS ENUM ('REVIEW', 'CHAT_MESSAGE', 'PROFILE');

-- AlterTable
ALTER TABLE "review" ADD COLUMN     "bookingId" TEXT,
ADD COLUMN     "moderationScoresJson" JSONB,
ADD COLUMN     "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW';

-- CreateTable
CREATE TABLE "moderation_case" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "subjectType" "ModerationSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "scoresJson" JSONB,
    "reportedByUserId" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_report" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "subjectType" "ModerationSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_case_status_createdAt_idx" ON "moderation_case"("status", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_case_tenantId_status_idx" ON "moderation_case"("tenantId", "status");

-- CreateIndex
CREATE INDEX "content_report_subjectId_idx" ON "content_report"("subjectId");

-- CreateIndex
CREATE INDEX "content_report_reporterUserId_idx" ON "content_report"("reporterUserId");

-- CreateIndex
CREATE UNIQUE INDEX "content_report_subjectType_subjectId_reporterUserId_key" ON "content_report"("subjectType", "subjectId", "reporterUserId");

-- CreateIndex
CREATE UNIQUE INDEX "review_bookingId_key" ON "review"("bookingId");

-- CreateIndex
CREATE INDEX "review_venueId_status_createdAt_idx" ON "review"("venueId", "status", "createdAt");


-- ─── One OPEN case per subject ───────────────────────────────────────
--
-- A PARTIAL unique index, which Prisma cannot model — hence hand-written, and
-- protected by tests/guardrails/migration-safety.test.ts.
--
-- Ten people reporting the same review is ONE job for a moderator, not ten.
-- Without this, a coordinated group can bury the queue in duplicates of a
-- single item and everything else in it goes unlooked-at.
--
-- Note what the naive alternative does. A plain
-- UNIQUE(subjectType, subjectId, status) looks equivalent, and also permits
-- only one RESOLVED case per subject — so the second time an item is reported
-- and approved, the moderator's action violates the constraint and they get a
-- 500 for doing their job. The WHERE clause is the whole point.
CREATE UNIQUE INDEX "moderation_case_one_open_idx"
  ON "moderation_case" ("subjectType", "subjectId")
  WHERE status = 'OPEN';

-- ─── A review must be a whole number of stars ────────────────────────
--
-- The app validates this. The database enforces it. A rating of 0 or 6 that
-- slipped past a new code path would silently skew every average that includes
-- it, and nothing would look broken.
ALTER TABLE "review" ADD CONSTRAINT review_rating_range CHECK ("rating" BETWEEN 1 AND 5);

-- ─── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE "moderation_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "moderation_case" FORCE ROW LEVEL SECURITY;
ALTER TABLE "content_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_report" FORCE ROW LEVEL SECURITY;

-- `current_setting('app.tenant_id', true)` — the 2-arg form returns NULL rather
-- than raising when unset, and `tenantId = NULL` is NULL, not true. Fail-closed:
-- no tenant context means no rows.
--
-- Both tables allow tenantId IS NULL, because a DM or a profile belongs to no
-- venue — the same reasoning as Conversation in P15.
CREATE POLICY moderation_case_tenant_isolation ON "moderation_case"
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY content_report_tenant_isolation ON "content_report"
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;

-- tenantId LEADS. RLS injects a tenantId predicate into every query whether
-- the caller wrote it or not, and a tenantId sitting second
-- in a composite index cannot serve that predicate — every report scan would be
-- sequential.
CREATE INDEX "content_report_tenantId_idx" ON "content_report"("tenantId");
