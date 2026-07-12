-- ════════════════════════════════════════════════════════════════════
--  DESTRUCTIVE STATEMENTS REMOVED BY HAND. Read this before regenerating.
--
--  `prisma migrate diff --from-config-datasource` compares the LIVE DATABASE
--  to the schema. Anything in that database which Prisma cannot MODEL — a
--  PostGIS `geography` column, a GiST index, an EXCLUDE constraint — looks
--  like DRIFT TO BE REMOVED.
--
--  The generated version of this MESSAGING migration contained:
--
--      DROP INDEX "court_tenantId_resourceType_idx";
--      DROP INDEX "venue_geog_idx";
--      ALTER TABLE "venue" DROP COLUMN "geog";
--
--  A migration for chat would have silently deleted the entire geo feature
--  added one prompt earlier, and the P13 resourceType index. The tests failed
--  with "column (not available) does not exist" — an error that names nothing
--  useful and points nowhere near the cause.
--
--  Two defences, both now in place:
--    1. `venue.geog` is declared `Unsupported("geography(Point, 4326)")` in the
--       schema, so Prisma KNOWS it exists and stops proposing its removal.
--    2. Every generated migration is READ before it is applied. Prisma's
--       differ is a suggestion, not an oracle — see also P13, where it
--       proposed dropping the column carrying `booking_no_overlap`.
-- ════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DM', 'GROUP', 'SESSION', 'VENUE_CHANNEL', 'COACH_THREAD');



-- AlterTable

-- CreateTable
CREATE TABLE "conversation" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "tenantId" TEXT,
    "title" TEXT,
    "createdById" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participant" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadMessageId" TEXT,
    "mutedUntil" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "conversation_participant_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateTable
CREATE TABLE "chat_message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentsJson" JSONB,
    "replyToId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_block" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_block_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateIndex
CREATE INDEX "conversation_tenantId_idx" ON "conversation"("tenantId");

-- CreateIndex
CREATE INDEX "conversation_lastMessageAt_idx" ON "conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "conversation_createdById_idx" ON "conversation"("createdById");

-- CreateIndex
CREATE INDEX "conversation_participant_userId_idx" ON "conversation_participant"("userId");

-- CreateIndex
CREATE INDEX "chat_message_conversationId_createdAt_idx" ON "chat_message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_message_senderId_idx" ON "chat_message"("senderId");

-- CreateIndex
CREATE INDEX "user_block_blockedId_idx" ON "user_block"("blockedId");

-- RenameForeignKey
ALTER TABLE "booking" RENAME CONSTRAINT "booking_courtId_fkey" TO "booking_resourceId_fkey";

-- RenameForeignKey
ALTER TABLE "coach_booking" RENAME CONSTRAINT "coach_booking_courtId_fkey" TO "coach_booking_resourceId_fkey";

-- RenameForeignKey
ALTER TABLE "court_availability" RENAME CONSTRAINT "court_availability_courtId_fkey" TO "court_availability_resourceId_fkey";

-- RenameForeignKey
ALTER TABLE "open_play_session" RENAME CONSTRAINT "open_play_session_courtId_fkey" TO "open_play_session_resourceId_fkey";

-- RenameForeignKey
ALTER TABLE "pricing_rule" RENAME CONSTRAINT "pricing_rule_courtId_fkey" TO "pricing_rule_resourceId_fkey";

-- AddForeignKey
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ── RLS ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;

-- conversation.tenantId is NULLABLE: a DM between two players who met at
-- different clubs belongs to no tenant.
--
-- So the policy is ASYMMETRIC, exactly like user_session in P04:
--   USING      — a NULL-tenant conversation is READABLE (otherwise cross-venue
--                DMs would be invisible to both participants).
--   WITH CHECK — omits the NULL branch, so a tenant-bound session can never
--                WRITE a conversation into a tenant that isn't theirs, nor
--                re-parent an existing one.
--
-- Note this is a coarse gate. The REAL access control for a conversation is
-- PARTICIPANT-BASED and lives in the policy layer — RLS cannot express "is
-- this user a participant" without a join, and a policy that could would be a
-- performance disaster on every message read.
ALTER TABLE "conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "conversation";
CREATE POLICY tenant_isolation ON "conversation"
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS superuser_bypass ON "conversation";
CREATE POLICY superuser_bypass ON "conversation" TO app_superuser USING (true) WITH CHECK (true);

-- conversation_participant and chat_message hang off a conversation, which RLS
-- already gates. Their policies key on that conversation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversation_participant', 'chat_message'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS conv_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY conv_isolation ON %I
        USING (
          EXISTS (
            SELECT 1 FROM "conversation" c
             WHERE c.id = %I."conversationId"
               AND (c."tenantId" IS NULL
                    OR c."tenantId" = current_setting('app.tenant_id', true))
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM "conversation" c
             WHERE c.id = %I."conversationId"
               AND (c."tenantId" IS NULL
                    OR c."tenantId" = current_setting('app.tenant_id', true))
          )
        )
    $f$, t, t, t);

    EXECUTE format('DROP POLICY IF EXISTS superuser_bypass ON %I', t);
    EXECUTE format('CREATE POLICY superuser_bypass ON %I TO app_superuser USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- NO RLS on user_block — blocking is GLOBAL by design. If a block were
-- tenant-scoped, someone you blocked at one venue could message you from
-- another. That is not a blocking feature; it is a loophole with extra steps.
