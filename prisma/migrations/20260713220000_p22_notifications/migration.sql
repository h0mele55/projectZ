-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('BOOKING_CONFIRMED', 'BOOKING_REMINDER', 'BOOKING_CANCELLED', 'SESSION_FULL', 'MESSAGE_RECEIVED', 'MATCH_RESULT', 'ACHIEVEMENT_UNLOCKED', 'TOURNAMENT_ROUND', 'PAYMENT_RECEIVED', 'SPLIT_REQUESTED');

-- CreateTable
CREATE TABLE "push_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscription_userId_idx" ON "push_subscription"("userId");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_createdAt_idx" ON "notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notification_tenantId_idx" ON "notification"("tenantId");

-- CreateIndex
CREATE INDEX "notification_refType_refId_idx" ON "notification"("refType", "refId");


-- ─── RLS ─────────────────────────────────────────────────────────────
--
-- A push subscription is a device belonging to ONE person. It is owner-only —
-- keyed on app.user_id, exactly like a wearable connection (P20), and for the
-- same reason: the endpoint plus its keys is a capability to send that person's
-- phone a notification. Handing it to another user is handing them a megaphone
-- aimed at somebody else's lock screen.
ALTER TABLE "push_subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscription" FORCE ROW LEVEL SECURITY;

CREATE POLICY push_subscription_owner_only ON "push_subscription"
  USING ("userId" = current_setting('app.user_id', true))
  WITH CHECK ("userId" = current_setting('app.user_id', true));

-- A notification is also personal, but it carries a tenant (a booking reminder
-- belongs to the club whose court it is). Owner-only, regardless of tenant —
-- the 2-arg current_setting fails closed when unset.
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification" FORCE ROW LEVEL SECURITY;

CREATE POLICY notification_owner_only ON "notification"
  USING ("userId" = current_setting('app.user_id', true))
  WITH CHECK ("userId" = current_setting('app.user_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;
