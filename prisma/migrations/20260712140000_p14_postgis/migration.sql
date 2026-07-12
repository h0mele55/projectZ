-- ── PostGIS ─────────────────────────────────────────────────────────
--
-- OPERATIONAL NOTE, learned the hard way: swapping the `postgres:16` image
-- for `postgis/postgis:16-3.4` changes the glibc the server runs against,
-- which changes the COLLATION VERSION. Postgres warns:
--
--   "database has a collation version mismatch ... created using 2.41,
--    but the operating system provides version 2.31"
--
-- That is not cosmetic. Text indexes are ordered by collation, so a
-- mismatched one can return WRONG RESULTS for range scans on text columns —
-- silently. After the image swap you must:
--
--   REINDEX DATABASE <db>;
--   ALTER DATABASE <db> REFRESH COLLATION VERSION;
--
-- Do this in production BEFORE serving traffic, not after.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── Venue.geog ──────────────────────────────────────────────────────
--
-- `geography(Point, 4326)`, not `geometry`. geography does spherical math on
-- the WGS-84 ellipsoid, so ST_DWithin takes METRES and the answer is a real
-- distance. `geometry` on lat/lng does PLANAR math on degrees — at Sofia's
-- latitude a degree of longitude is ~74km and a degree of latitude ~111km, so
-- a "10 unit" radius is an ellipse, and every distance is wrong in a way that
-- looks plausible.
ALTER TABLE "venue" ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);

UPDATE "venue"
   SET geog = ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326)::geography
 WHERE geog IS NULL AND lat IS NOT NULL AND lng IS NOT NULL;

-- GiST, not btree. A btree index cannot answer "within N metres".
CREATE INDEX IF NOT EXISTS venue_geog_idx ON "venue" USING GIST (geog);

-- ── Keep geog in sync with lat/lng ──────────────────────────────────
--
-- The alternative is remembering to update geog in every write path. That
-- works until the first one that forgets — and a venue with a stale geog does
-- not error; it just quietly stops appearing in "near me", which nobody
-- notices except the venue owner losing bookings.
CREATE OR REPLACE FUNCTION venue_sync_geog() RETURNS trigger AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geog := ST_SetSRID(
      ST_MakePoint(NEW.lng::double precision, NEW.lat::double precision), 4326
    )::geography;
  ELSE
    NEW.geog := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS venue_sync_geog_trg ON "venue";
CREATE TRIGGER venue_sync_geog_trg
  BEFORE INSERT OR UPDATE OF lat, lng ON "venue"
  FOR EACH ROW EXECUTE FUNCTION venue_sync_geog();
