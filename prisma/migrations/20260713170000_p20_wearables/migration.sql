-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('STRAVA', 'MANUAL', 'APPLE_HEALTH', 'GARMIN');

-- CreateEnum
CREATE TYPE "WearableProvider" AS ENUM ('STRAVA', 'APPLE_HEALTH', 'GARMIN');

-- CreateTable
CREATE TABLE "wearable_connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "WearableProvider" NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "externalAthleteId" TEXT NOT NULL,
    "scopes" TEXT[],
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "wearable_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "source" "ActivitySource" NOT NULL,
    "sport" "SportType" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationS" INTEGER NOT NULL,
    "distanceM" INTEGER,
    "elevationM" INTEGER,
    "avgHeartRate" INTEGER,
    "calories" INTEGER,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wearable_connection_userId_idx" ON "wearable_connection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wearable_connection_userId_provider_key" ON "wearable_connection"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "wearable_connection_provider_externalAthleteId_key" ON "wearable_connection"("provider", "externalAthleteId");

-- CreateIndex
CREATE INDEX "activity_userId_sport_startedAt_idx" ON "activity"("userId", "sport", "startedAt");

-- CreateIndex
CREATE INDEX "activity_userId_source_idx" ON "activity"("userId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "activity_source_externalId_key" ON "activity"("source", "externalId");


-- ═══ THE STRAVA BOUNDARY, ENFORCED BY POSTGRES ═══════════════════════
--
-- Strava's API Agreement (rev. November 2024) permits their data to be shown to
-- the athlete it belongs to and to NOBODY ELSE. No leaderboard, no feed, no
-- coach view, no aggregate — an aggregate computed across many athletes' Strava
-- data and shown to any of them is a cross-user display of that data, however
-- anonymised it looks.
--
-- A code review cannot guarantee that. A comment certainly cannot. So the
-- DATABASE refuses:
--
--   a STRAVA-sourced row is visible only when app.user_id IS its owner.
--
-- A buggy query that joins activities into a leaderboard does not leak a ride —
-- it returns zero rows, because Postgres will not hand it over. That is the
-- failure mode we want: the feature looks broken, rather than working while
-- quietly breaching a contract that would cost every connected athlete their
-- integration.
--
-- MANUAL / APPLE_HEALTH / GARMIN rows are unaffected: those the athlete gave us
-- directly, and we may display and aggregate them.
ALTER TABLE "activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity" FORCE ROW LEVEL SECURITY;

-- Note the 2-arg current_setting: it returns NULL rather than raising when the
-- variable is unset, and `"userId" = NULL` is NULL, not TRUE. So a session that
-- never set app.user_id sees NO Strava rows at all — fail-closed, which for this
-- table is the difference between a bug and a breach.
CREATE POLICY activity_strava_owner_only ON "activity"
  USING (
    source <> 'STRAVA'
    OR "userId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    source <> 'STRAVA'
    OR "userId" = current_setting('app.user_id', true)
  );

-- Tokens are a key to a person's entire movement history — where they live,
-- when they are out, the route they run alone at 6am. Only the owner, ever.
ALTER TABLE "wearable_connection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wearable_connection" FORCE ROW LEVEL SECURITY;

CREATE POLICY wearable_connection_owner_only ON "wearable_connection"
  USING ("userId" = current_setting('app.user_id', true))
  WITH CHECK ("userId" = current_setting('app.user_id', true));

-- A duration of zero or a negative distance is not an activity, it is a bug in
-- an importer — and it would quietly skew every total the athlete is shown.
ALTER TABLE "activity" ADD CONSTRAINT activity_sane_metrics CHECK (
  "durationS" > 0
  AND ("distanceM" IS NULL OR "distanceM" >= 0)
  AND ("avgHeartRate" IS NULL OR ("avgHeartRate" > 20 AND "avgHeartRate" < 260))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;
-- CreateIndex
CREATE INDEX "activity_tenantId_idx" ON "activity"("tenantId");

