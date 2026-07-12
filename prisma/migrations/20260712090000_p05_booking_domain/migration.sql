-- CreateTable
CREATE TABLE "booking" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "startTs" TIMESTAMPTZ(3) NOT NULL,
    "endTs" TIMESTAMPTZ(3) NOT NULL,
    "bookedByUserId" TEXT,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "guestName" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReasonJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_participant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "guestName" TEXT,
    "guestEmail" TEXT,
    "position" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'STRIPE',
    "providerRefId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'REQUIRES_ACTION',
    "paidAt" TIMESTAMP(3),
    "failureReasonJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "reason" TEXT,
    "providerRefId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'REQUIRES_ACTION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_in" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_in_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "cancelledByUserId" TEXT,
    "reason" TEXT,
    "refundPercent" INTEGER NOT NULL DEFAULT 0,
    "refundAmountCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bio" TEXT,
    "hourlyRateCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "sports" "SportType"[],
    "certificationsJson" JSONB NOT NULL DEFAULT '[]',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_sport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "sport" "SportType" NOT NULL,
    "skillLevel" "SkillLevel" NOT NULL DEFAULT 'INTERMEDIATE',

    CONSTRAINT "coach_sport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_availability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TIME(0) NOT NULL,
    "closeTime" TIME(0) NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "exceptionDate" DATE,

    CONSTRAINT "coach_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_booking" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "courtId" TEXT,
    "playerUserId" TEXT NOT NULL,
    "startTs" TIMESTAMPTZ(3) NOT NULL,
    "endTs" TIMESTAMPTZ(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_review" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_play_session" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "sport" "SportType" NOT NULL,
    "startTs" TIMESTAMPTZ(3) NOT NULL,
    "endTs" TIMESTAMPTZ(3) NOT NULL,
    "minSkillLevel" "SkillLevel" NOT NULL DEFAULT 'BEGINNER',
    "maxSkillLevel" "SkillLevel" NOT NULL DEFAULT 'COMPETITIVE',
    "maxParticipants" INTEGER NOT NULL DEFAULT 4,
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "joinPriceCents" INTEGER NOT NULL DEFAULT 0,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "linkedBookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "open_play_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_participant" (
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInAt" TIMESTAMP(3),

    CONSTRAINT "session_participant_pkey" PRIMARY KEY ("sessionId","userId")
);

-- CreateTable
CREATE TABLE "session_chat_message" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_rating_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sport" "SportType" NOT NULL,
    "mu" DECIMAL(6,2) NOT NULL,
    "phi" DECIMAL(6,2) NOT NULL,
    "sigma" DECIMAL(6,4) NOT NULL,
    "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_rating_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_venue_relationship" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "playerUserId" TEXT NOT NULL,
    "creditBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_venue_relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "playerUserId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_pass" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "playerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalSessions" INTEGER NOT NULL,
    "usedSessions" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_balance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "playerUserId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'BG',
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Sofia',
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "openingHoursJson" JSONB NOT NULL DEFAULT '{}',
    "amenityIds" TEXT[],
    "coverPhotoUrl" TEXT,
    "cancellationPolicyJson" JSONB NOT NULL DEFAULT '{"fullRefundBeforeHours":24,"halfRefundBeforeHours":12}',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "avgRating" DECIMAL(2,1) NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "court" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport" "SportType" NOT NULL,
    "surface" "CourtSurface" NOT NULL,
    "isIndoor" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "basePriceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "minBookingMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxBookingMinutes" INTEGER NOT NULL DEFAULT 180,
    "slotStepMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "court_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "court_availability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TIME(0) NOT NULL,
    "closeTime" TIME(0) NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "exceptionDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "court_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditionsJson" JSONB NOT NULL DEFAULT '{}',
    "multiplier" DECIMAL(4,2),
    "fixedPriceCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue_amenity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "venue_amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue_photo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_tenantId_courtId_startTs_idx" ON "booking"("tenantId", "courtId", "startTs");

-- CreateIndex
CREATE INDEX "booking_tenantId_status_idx" ON "booking"("tenantId", "status");

-- CreateIndex
CREATE INDEX "booking_bookedByUserId_idx" ON "booking"("bookedByUserId");

-- CreateIndex
CREATE INDEX "booking_courtId_idx" ON "booking"("courtId");

-- CreateIndex
CREATE INDEX "booking_expiresAt_idx" ON "booking"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_tenantId_idempotencyKey_key" ON "booking"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "booking_participant_tenantId_idx" ON "booking_participant"("tenantId");

-- CreateIndex
CREATE INDEX "booking_participant_bookingId_idx" ON "booking_participant"("bookingId");

-- CreateIndex
CREATE INDEX "booking_participant_userId_idx" ON "booking_participant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_participant_bookingId_position_key" ON "booking_participant"("bookingId", "position");

-- CreateIndex
CREATE INDEX "payment_tenantId_idx" ON "payment"("tenantId");

-- CreateIndex
CREATE INDEX "payment_bookingId_idx" ON "payment"("bookingId");

-- CreateIndex
CREATE INDEX "payment_providerRefId_idx" ON "payment"("providerRefId");

-- CreateIndex
CREATE INDEX "payment_tenantId_status_idx" ON "payment"("tenantId", "status");

-- CreateIndex
CREATE INDEX "refund_tenantId_idx" ON "refund"("tenantId");

-- CreateIndex
CREATE INDEX "refund_bookingId_idx" ON "refund"("bookingId");

-- CreateIndex
CREATE INDEX "refund_paymentId_idx" ON "refund"("paymentId");

-- CreateIndex
CREATE INDEX "check_in_tenantId_idx" ON "check_in"("tenantId");

-- CreateIndex
CREATE INDEX "check_in_bookingId_idx" ON "check_in"("bookingId");

-- CreateIndex
CREATE INDEX "check_in_userId_idx" ON "check_in"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_bookingId_key" ON "cancellation"("bookingId");

-- CreateIndex
CREATE INDEX "cancellation_tenantId_idx" ON "cancellation"("tenantId");

-- CreateIndex
CREATE INDEX "cancellation_cancelledByUserId_idx" ON "cancellation"("cancelledByUserId");

-- CreateIndex
CREATE INDEX "coach_tenantId_status_idx" ON "coach"("tenantId", "status");

-- CreateIndex
CREATE INDEX "coach_userId_idx" ON "coach"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "coach_tenantId_userId_key" ON "coach"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "coach_sport_tenantId_idx" ON "coach_sport"("tenantId");

-- CreateIndex
CREATE INDEX "coach_sport_coachId_idx" ON "coach_sport"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "coach_sport_coachId_sport_key" ON "coach_sport"("coachId", "sport");

-- CreateIndex
CREATE INDEX "coach_availability_coachId_dayOfWeek_idx" ON "coach_availability"("coachId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "coach_availability_tenantId_idx" ON "coach_availability"("tenantId");

-- CreateIndex
CREATE INDEX "coach_booking_tenantId_coachId_startTs_idx" ON "coach_booking"("tenantId", "coachId", "startTs");

-- CreateIndex
CREATE INDEX "coach_booking_tenantId_status_idx" ON "coach_booking"("tenantId", "status");

-- CreateIndex
CREATE INDEX "coach_booking_courtId_idx" ON "coach_booking"("courtId");

-- CreateIndex
CREATE INDEX "coach_booking_playerUserId_idx" ON "coach_booking"("playerUserId");

-- CreateIndex
CREATE INDEX "coach_review_tenantId_idx" ON "coach_review"("tenantId");

-- CreateIndex
CREATE INDEX "coach_review_coachId_createdAt_idx" ON "coach_review"("coachId", "createdAt");

-- CreateIndex
CREATE INDEX "coach_review_authorUserId_idx" ON "coach_review"("authorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "coach_review_coachId_authorUserId_key" ON "coach_review"("coachId", "authorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "open_play_session_linkedBookingId_key" ON "open_play_session"("linkedBookingId");

-- CreateIndex
CREATE INDEX "open_play_session_tenantId_sport_startTs_idx" ON "open_play_session"("tenantId", "sport", "startTs");

-- CreateIndex
CREATE INDEX "open_play_session_tenantId_status_idx" ON "open_play_session"("tenantId", "status");

-- CreateIndex
CREATE INDEX "open_play_session_courtId_idx" ON "open_play_session"("courtId");

-- CreateIndex
CREATE INDEX "open_play_session_hostUserId_idx" ON "open_play_session"("hostUserId");

-- CreateIndex
CREATE INDEX "session_participant_userId_idx" ON "session_participant"("userId");

-- CreateIndex
CREATE INDEX "session_chat_message_sessionId_createdAt_idx" ON "session_chat_message"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "session_chat_message_tenantId_idx" ON "session_chat_message"("tenantId");

-- CreateIndex
CREATE INDEX "session_chat_message_senderUserId_idx" ON "session_chat_message"("senderUserId");

-- CreateIndex
CREATE INDEX "skill_rating_history_userId_sport_computedAt_idx" ON "skill_rating_history"("userId", "sport", "computedAt");

-- CreateIndex
CREATE INDEX "player_venue_relationship_tenantId_idx" ON "player_venue_relationship"("tenantId");

-- CreateIndex
CREATE INDEX "player_venue_relationship_playerUserId_idx" ON "player_venue_relationship"("playerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "player_venue_relationship_tenantId_playerUserId_key" ON "player_venue_relationship"("tenantId", "playerUserId");

-- CreateIndex
CREATE INDEX "membership_tenantId_status_idx" ON "membership"("tenantId", "status");

-- CreateIndex
CREATE INDEX "membership_playerUserId_idx" ON "membership"("playerUserId");

-- CreateIndex
CREATE INDEX "membership_endsAt_idx" ON "membership"("endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenantId_playerUserId_level_key" ON "membership"("tenantId", "playerUserId", "level");

-- CreateIndex
CREATE INDEX "season_pass_tenantId_idx" ON "season_pass"("tenantId");

-- CreateIndex
CREATE INDEX "season_pass_playerUserId_idx" ON "season_pass"("playerUserId");

-- CreateIndex
CREATE INDEX "season_pass_validUntil_idx" ON "season_pass"("validUntil");

-- CreateIndex
CREATE INDEX "credit_balance_tenantId_idx" ON "credit_balance"("tenantId");

-- CreateIndex
CREATE INDEX "credit_balance_playerUserId_idx" ON "credit_balance"("playerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_balance_tenantId_playerUserId_key" ON "credit_balance"("tenantId", "playerUserId");

-- CreateIndex
CREATE INDEX "credit_transaction_tenantId_idx" ON "credit_transaction"("tenantId");

-- CreateIndex
CREATE INDEX "credit_transaction_balanceId_createdAt_idx" ON "credit_transaction"("balanceId", "createdAt");

-- CreateIndex
CREATE INDEX "credit_transaction_bookingId_idx" ON "credit_transaction"("bookingId");

-- CreateIndex
CREATE INDEX "venue_tenantId_slug_idx" ON "venue"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "venue_city_country_idx" ON "venue"("city", "country");

-- CreateIndex
CREATE INDEX "venue_tenantId_status_idx" ON "venue"("tenantId", "status");

-- CreateIndex
CREATE INDEX "venue_city_country_status_idx" ON "venue"("city", "country", "status");

-- CreateIndex
CREATE UNIQUE INDEX "venue_tenantId_slug_key" ON "venue"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "court_tenantId_venueId_sport_idx" ON "court"("tenantId", "venueId", "sport");

-- CreateIndex
CREATE INDEX "court_tenantId_status_idx" ON "court"("tenantId", "status");

-- CreateIndex
CREATE INDEX "court_tenantId_venueId_sport_status_idx" ON "court"("tenantId", "venueId", "sport", "status");

-- CreateIndex
CREATE INDEX "court_venueId_idx" ON "court"("venueId");

-- CreateIndex
CREATE INDEX "court_availability_courtId_dayOfWeek_idx" ON "court_availability"("courtId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "court_availability_tenantId_idx" ON "court_availability"("tenantId");

-- CreateIndex
CREATE INDEX "pricing_rule_tenantId_courtId_priority_idx" ON "pricing_rule"("tenantId", "courtId", "priority");

-- CreateIndex
CREATE INDEX "venue_amenity_tenantId_idx" ON "venue_amenity"("tenantId");

-- CreateIndex
CREATE INDEX "venue_amenity_venueId_idx" ON "venue_amenity"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "venue_amenity_venueId_code_key" ON "venue_amenity"("venueId", "code");

-- CreateIndex
CREATE INDEX "venue_photo_tenantId_idx" ON "venue_photo"("tenantId");

-- CreateIndex
CREATE INDEX "venue_photo_venueId_position_idx" ON "venue_photo"("venueId", "position");

-- CreateIndex
CREATE INDEX "review_tenantId_idx" ON "review"("tenantId");

-- CreateIndex
CREATE INDEX "review_venueId_createdAt_idx" ON "review"("venueId", "createdAt");

-- CreateIndex
CREATE INDEX "review_authorUserId_idx" ON "review"("authorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "review_venueId_authorUserId_key" ON "review"("venueId", "authorUserId");

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_participant" ADD CONSTRAINT "booking_participant_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation" ADD CONSTRAINT "cancellation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_sport" ADD CONSTRAINT "coach_sport_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_booking" ADD CONSTRAINT "coach_booking_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_booking" ADD CONSTRAINT "coach_booking_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_review" ADD CONSTRAINT "coach_review_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_play_session" ADD CONSTRAINT "open_play_session_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_play_session" ADD CONSTRAINT "open_play_session_linkedBookingId_fkey" FOREIGN KEY ("linkedBookingId") REFERENCES "booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participant" ADD CONSTRAINT "session_participant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "open_play_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_chat_message" ADD CONSTRAINT "session_chat_message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "open_play_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "credit_balance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court" ADD CONSTRAINT "court_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_availability" ADD CONSTRAINT "court_availability_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rule" ADD CONSTRAINT "pricing_rule_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_amenity" ADD CONSTRAINT "venue_amenity_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_photo" ADD CONSTRAINT "venue_photo_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

