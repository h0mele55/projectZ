-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'CLUB', 'PRO');

-- CreateEnum
CREATE TYPE "SportType" AS ENUM ('TENNIS', 'PADEL', 'BADMINTON', 'FOOTBALL5', 'BASKETBALL', 'VOLLEYBALL', 'TABLE_TENNIS');

-- CreateEnum
CREATE TYPE "CourtSurface" AS ENUM ('CLAY', 'HARD', 'GRASS', 'ARTIFICIAL_GRASS', 'CARPET', 'WOOD', 'CONCRETE');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('PRIVATE_BOOKING', 'OPEN_PLAY', 'COACHING', 'TOURNAMENT');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('BEGINNER', 'IMPROVER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('REQUIRES_ACTION', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('bg', 'en');

-- DropIndex
DROP INDEX "tenant_membership_tenantId_userId_key";

-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "emailVerified" TIMESTAMP(3),
ADD COLUMN     "locale" "Locale" NOT NULL DEFAULT 'bg',
ADD COLUMN     "mfaSecret" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tenant_membership" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "customRoleId" TEXT,
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "invitedById" TEXT;

-- AlterTable
ALTER TABLE "venue_org" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contactEmail" TEXT NOT NULL,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'BG',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "encryptedDek" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "planTier" "PlanTier" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "previousEncryptedDek" TEXT,
ADD COLUMN     "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/Sofia';

-- CreateTable
CREATE TABLE "player_profile" (
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sports" "SportType"[],
    "skillRatingsJson" JSONB NOT NULL DEFAULT '{}',
    "bio" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "preferredHand" TEXT,
    "skillLevel" "SkillLevel" NOT NULL DEFAULT 'BEGINNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PLAYER',
    "customRoleId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_security_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "maxConcurrentSessions" INTEGER NOT NULL DEFAULT 5,
    "sessionMaxAgeMinutes" INTEGER NOT NULL DEFAULT 43200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_security_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_custom_role" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_custom_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_session_tokenHash_key" ON "user_session"("tokenHash");

-- CreateIndex
CREATE INDEX "user_session_userId_idx" ON "user_session"("userId");

-- CreateIndex
CREATE INDEX "user_session_tenantId_idx" ON "user_session"("tenantId");

-- CreateIndex
CREATE INDEX "user_session_expiresAt_idx" ON "user_session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_tokenHash_key" ON "password_reset_token"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_token_userId_idx" ON "password_reset_token"("userId");

-- CreateIndex
CREATE INDEX "password_reset_token_expiresAt_idx" ON "password_reset_token"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "invite_tokenHash_key" ON "invite"("tokenHash");

-- CreateIndex
CREATE INDEX "invite_tenantId_idx" ON "invite"("tenantId");

-- CreateIndex
CREATE INDEX "invite_expiresAt_idx" ON "invite"("expiresAt");

-- CreateIndex
CREATE INDEX "invite_invitedById_idx" ON "invite"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "invite_tenantId_email_key" ON "invite"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_security_settings_tenantId_key" ON "tenant_security_settings"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_security_settings_tenantId_idx" ON "tenant_security_settings"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_custom_role_tenantId_idx" ON "tenant_custom_role"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_custom_role_tenantId_name_key" ON "tenant_custom_role"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_tokenHash_key" ON "api_key"("tokenHash");

-- CreateIndex
CREATE INDEX "api_key_tenantId_idx" ON "api_key"("tenantId");

-- CreateIndex
CREATE INDEX "api_key_createdByUserId_idx" ON "api_key"("createdByUserId");

-- CreateIndex
CREATE INDEX "api_key_expiresAt_idx" ON "api_key"("expiresAt");

-- CreateIndex
CREATE INDEX "tenant_membership_customRoleId_idx" ON "tenant_membership"("customRoleId");

-- CreateIndex
CREATE INDEX "tenant_membership_invitedById_idx" ON "tenant_membership"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_membership_userId_tenantId_key" ON "tenant_membership"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "venue_org_city_country_status_idx" ON "venue_org"("city", "country", "status");

-- AddForeignKey
ALTER TABLE "player_profile" ADD CONSTRAINT "player_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "tenant_custom_role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "venue_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "venue_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_security_settings" ADD CONSTRAINT "tenant_security_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "venue_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_custom_role" ADD CONSTRAINT "tenant_custom_role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "venue_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "venue_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

