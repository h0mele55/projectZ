-- ════════════════════════════════════════════════════════════════════
--  THE non-negotiable defence against double-booking.
--
--  An application-layer "is this slot free?" check CANNOT work under
--  concurrency: two requests both SELECT (free), both INSERT, both
--  succeed. You have sold the same court twice. No amount of care in the
--  app layer fixes this — only the database can, because only the
--  database can serialise the write.
--
--  So: the app layer does NOT check. It attempts the INSERT and catches
--  23P01 (exclusion_violation), mapping it to conflict('slot_taken').
--
--  `[)` — half-open range. A booking [09:00, 10:00) and one starting at
--  [10:00, 11:00) do NOT overlap; back-to-back slots are legal, which is
--  the normal case at any club. A closed `[]` range would reject them.
--
--  WHERE (status IN ('CONFIRMED','PENDING')) — a CANCELLED booking must
--  free its slot. PENDING still holds it (someone is at checkout), which
--  is why Booking.expiresAt exists: without an expiry an abandoned
--  checkout would hold the slot forever.
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "booking"
  ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    "courtId" WITH =,
    tstzrange("startTs", "endTs", '[)') WITH &&
  )
  WHERE (status IN ('CONFIRMED', 'PENDING'));

-- A coach cannot be in two places at once, for the same reason.
ALTER TABLE "coach_booking"
  ADD CONSTRAINT coach_no_overlap
  EXCLUDE USING gist (
    "coachId" WITH =,
    tstzrange("startTs", "endTs", '[)') WITH &&
  )
  WHERE (status IN ('CONFIRMED', 'PENDING'));

-- ── Booking span sanity, enforced by the database ───────────────────
--
-- A zero-length or negative booking is nonsense, and a 20-hour "booking"
-- is a fat-fingered form or an attack on availability. The app validates
-- too, but the DB is where the guarantee actually lives.
ALTER TABLE "booking"
  ADD CONSTRAINT booking_span_valid
  CHECK ("endTs" > "startTs" AND "endTs" - "startTs" <= INTERVAL '4 hours');

ALTER TABLE "coach_booking"
  ADD CONSTRAINT coach_booking_span_valid
  CHECK ("endTs" > "startTs" AND "endTs" - "startTs" <= INTERVAL '4 hours');

ALTER TABLE "open_play_session"
  ADD CONSTRAINT session_span_valid
  CHECK ("endTs" > "startTs");

-- ── RLS for every model P05 added ───────────────────────────────────
--
-- Every table below carries a tenantId. The rls-coverage ratchet fails
-- the build if any of them is missing a policy, so this list cannot
-- silently fall behind the schema.
--
-- skill_rating_history is the ONE exception: it is global by design. A
-- player's Glicko-2 rating must follow them between clubs, or matchmaking
-- at a new venue starts from zero and pairs a competitive player against
-- a beginner.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_superuser;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'venue', 'court', 'court_availability', 'pricing_rule',
    'venue_amenity', 'venue_photo', 'review',
    'booking', 'booking_participant', 'payment', 'refund',
    'check_in', 'cancellation',
    'open_play_session', 'session_chat_message',
    'coach', 'coach_sport', 'coach_availability', 'coach_booking', 'coach_review',
    'player_venue_relationship', 'membership', 'season_pass',
    'credit_balance', 'credit_transaction'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = current_setting('app.tenant_id', true))
        WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))
    $f$, t);

    EXECUTE format('DROP POLICY IF EXISTS superuser_bypass ON %I', t);
    EXECUTE format($f$
      CREATE POLICY superuser_bypass ON %I TO app_superuser
        USING (true) WITH CHECK (true)
    $f$, t);
  END LOOP;
END $$;

-- session_participant has no tenantId — it is a pure join table keyed on
-- (sessionId, userId), and the session it hangs off IS tenant-scoped. Its
-- rows are unreachable without first reading an open_play_session row,
-- which RLS already gates.
ALTER TABLE "session_participant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session_participant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_tenant_isolation ON "session_participant";
CREATE POLICY session_tenant_isolation ON "session_participant"
  USING (
    EXISTS (
      SELECT 1 FROM "open_play_session" s
      WHERE s.id = "session_participant"."sessionId"
        AND s."tenantId" = current_setting('app.tenant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "open_play_session" s
      WHERE s.id = "session_participant"."sessionId"
        AND s."tenantId" = current_setting('app.tenant_id', true)
    )
  );
DROP POLICY IF EXISTS superuser_bypass ON "session_participant";
CREATE POLICY superuser_bypass ON "session_participant" TO app_superuser
  USING (true) WITH CHECK (true);

-- NO RLS on skill_rating_history — global by design (see above).
