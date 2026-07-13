import type { ActivitySource, PrismaClient, SportType } from '@prisma/client';

import { awardXp } from '@/app-layer/usecases/gamification';
import { decryptField, encryptField } from '@/lib/security/encryption';
import { assertMayView, isRestricted } from '@/lib/wearables/strava-tos';

/**
 * Wearables: connecting, importing, and disconnecting.
 *
 * Everything here is shaped by src/lib/wearables/strava-tos.ts. Read it first.
 */

const STRAVA_API = 'https://www.strava.com/api/v3';

/** Strava's activity types → our sports. Anything unrecognised is not imported. */
const STRAVA_SPORT: Record<string, SportType> = {
  Run: 'RUNNING',
  TrailRun: 'RUNNING',
  VirtualRun: 'RUNNING',
  Ride: 'CYCLING',
  VirtualRide: 'CYCLING',
  GravelRide: 'CYCLING',
  MountainBikeRide: 'CYCLING',
};

// Swim, Hike, AlpineSki and the rest are DELIBERATELY absent. We do not model
// those sports, and coercing them into RUNNING would put a 40km ski descent
// into an athlete's running totals with no way for them to tell where it came
// from. An activity type we cannot represent is not imported.

export class WearableNotConnectedError extends Error {
  readonly code = 'wearable_not_connected';
  constructor() {
    super('This athlete has not connected that provider.');
    this.name = 'WearableNotConnectedError';
  }
}

export async function connectStrava(
  db: PrismaClient,
  input: {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    athleteId: string;
    scopes: string[];
  },
): Promise<{ id: string }> {
  // Encrypted at rest. A Strava token is a key to a person's entire movement
  // history — where they live, when they are out, the route they run alone at
  // 6am. Plaintext tokens in a leaked backup are not a data breach, they are a
  // stalking kit.
  const conn = await db.wearableConnection.upsert({
    where: { userId_provider: { userId: input.userId, provider: 'STRAVA' } },
    create: {
      userId: input.userId,
      provider: 'STRAVA',
      accessTokenEnc: encryptField(input.accessToken),
      refreshTokenEnc: encryptField(input.refreshToken),
      expiresAt: input.expiresAt,
      externalAthleteId: input.athleteId,
      scopes: input.scopes,
    },
    update: {
      accessTokenEnc: encryptField(input.accessToken),
      refreshTokenEnc: encryptField(input.refreshToken),
      expiresAt: input.expiresAt,
      scopes: input.scopes,
      // Reconnecting after a revoke clears the tombstone.
      revokedAt: null,
    },
  });

  return { id: conn.id };
}

/**
 * A valid access token, refreshing it if it has expired.
 *
 * Refreshed 60s EARLY. A token that expires between our check and Strava's
 * receipt of the request fails with a 401 that looks exactly like the athlete
 * revoking us — and the natural "fix" for that is to mark them disconnected,
 * which throws away a perfectly good connection.
 */
export async function validAccessToken(db: PrismaClient, userId: string): Promise<string> {
  const conn = await db.wearableConnection.findUnique({
    where: { userId_provider: { userId, provider: 'STRAVA' } },
  });

  if (!conn || conn.revokedAt) throw new WearableNotConnectedError();

  if (conn.expiresAt.getTime() > Date.now() + 60_000) {
    return decryptField(conn.accessTokenEnc);
  }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: decryptField(conn.refreshTokenEnc),
    }),
  });

  if (!res.ok) throw new WearableNotConnectedError();

  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  await db.wearableConnection.update({
    where: { id: conn.id },
    data: {
      accessTokenEnc: encryptField(json.access_token),
      // Strava ROTATES the refresh token. Storing only the new access token and
      // keeping the old refresh token means the next refresh fails, and the
      // athlete silently stops syncing until they reconnect by hand.
      refreshTokenEnc: encryptField(json.refresh_token),
      expiresAt: new Date(json.expires_at * 1000),
    },
  });

  return json.access_token;
}

export interface StravaActivity {
  id: number;
  type: string;
  start_date: string;
  elapsed_time: number;
  distance: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  calories?: number;
}

/**
 * Import one activity.
 *
 * Idempotent on (source, externalId). Strava's webhook is at-least-once, and a
 * re-imported ride would double the athlete's distance for the week.
 */
export async function importActivity(
  db: PrismaClient,
  input: { userId: string; tenantId?: string | null; activity: StravaActivity },
): Promise<{ imported: boolean; activityId?: string }> {
  const sport = STRAVA_SPORT[input.activity.type];

  // An activity type we do not model is NOT imported. Coercing a "Yoga" or an
  // "AlpineSki" into RUNNING would put nonsense distances into the athlete's
  // running totals, and they would have no way to tell where it came from.
  if (!sport) return { imported: false };

  const durationS = Math.round(input.activity.elapsed_time);
  // The CHECK constraint rejects a zero duration. Catch it here so a malformed
  // webhook is a skipped import rather than a 500.
  if (!Number.isFinite(durationS) || durationS <= 0) return { imported: false };

  const result = await db.activity.createMany({
    data: [
      {
        userId: input.userId,
        tenantId: input.tenantId ?? null,
        source: 'STRAVA',
        sport,
        startedAt: new Date(input.activity.start_date),
        durationS,
        distanceM: Math.round(input.activity.distance ?? 0),
        elevationM: input.activity.total_elevation_gain
          ? Math.round(input.activity.total_elevation_gain)
          : null,
        avgHeartRate: input.activity.average_heartrate
          ? Math.round(input.activity.average_heartrate)
          : null,
        calories: input.activity.calories ?? null,
        externalId: String(input.activity.id),
      },
    ],
    skipDuplicates: true,
  });

  if (result.count === 0) return { imported: false };

  // guardrail-allow: cross-tenant — an activity belongs to the ATHLETE, not to a
  // club. (source, externalId) is unique, so this reads exactly the row just
  // written. Strava's boundary is per-athlete and is enforced by RLS on
  // app.user_id, not by tenant scoping.
  const created = await db.activity.findFirstOrThrow({
    where: { source: 'STRAVA', externalId: String(input.activity.id) },
    select: { id: true },
  });

  return { imported: true, activityId: created.id };
}

/**
 * Fetch and import an athlete's recent activities.
 */
export async function syncStrava(
  db: PrismaClient,
  input: { userId: string; tenantId?: string | null; after?: Date },
): Promise<{ imported: number }> {
  const token = await validAccessToken(db, input.userId);

  const params = new URLSearchParams({ per_page: '50' });
  if (input.after) params.set('after', String(Math.floor(input.after.getTime() / 1000)));

  const res = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new WearableNotConnectedError();

  const activities = (await res.json()) as StravaActivity[];

  let imported = 0;
  for (const activity of activities) {
    const r = await importActivity(db, {
      userId: input.userId,
      tenantId: input.tenantId,
      activity,
    });
    if (r.imported) imported++;
  }

  await db.wearableConnection.update({
    where: { userId_provider: { userId: input.userId, provider: 'STRAVA' } },
    data: { lastSyncedAt: new Date() },
  });

  return { imported };
}

/**
 * The athlete revoked us.
 *
 * Their Strava data is DELETED. Not hidden, not soft-deleted behind a flag we
 * might one day forget to check — deleted. That is what the agreement requires
 * and what the athlete asked for.
 *
 * The connection row survives with `revokedAt` set, holding no tokens. That is
 * not the data; it is the RECORD that they revoked, which we need in order to
 * stop syncing and to prove we stopped.
 */
export async function handleDeauthorization(
  db: PrismaClient,
  input: { athleteId: string },
): Promise<{ deletedActivities: number }> {
  const conn = await db.wearableConnection.findUnique({
    where: {
      provider_externalAthleteId: {
        provider: 'STRAVA',
        externalAthleteId: input.athleteId,
      },
    },
  });

  if (!conn) return { deletedActivities: 0 };

  // guardrail-allow: cross-tenant — deletion on deauthorisation must remove the
  // athlete's Strava data EVERYWHERE, not only within one club's tenant. Scoping
  // this by tenant would leave their rides behind at every other venue they have
  // ever played at, which is precisely what the agreement forbids.
  const deleted = await db.activity.deleteMany({
    where: { userId: conn.userId, source: 'STRAVA' },
  });

  await db.wearableConnection.update({
    where: { id: conn.id },
    data: {
      revokedAt: new Date(),
      // The tokens go with the data. A revoked connection holding a live token
      // is a loaded gun in the database.
      accessTokenEnc: '',
      refreshTokenEnc: '',
    },
  });

  return { deletedActivities: deleted.count };
}

/**
 * An athlete's OWN activities.
 *
 * `viewerUserId` is required, and the caller must be the owner to see restricted
 * rows. The RLS policy enforces this at the database; this is the second layer,
 * and it produces a comprehensible ERROR rather than a mysteriously empty list.
 */
export async function listMyActivities(
  db: PrismaClient,
  input: { userId: string; viewerUserId: string; limit?: number },
): Promise<
  Array<{ id: string; source: ActivitySource; sport: SportType; distanceM: number | null }>
> {
  // guardrail-allow: cross-tenant — an athlete's own activity history follows
  // them between clubs, like their XP (P18) and their ratings (P19). Strava rows
  // are protected per-ATHLETE by the RLS policy on app.user_id.
  const rows = await db.activity.findMany({
    where: { userId: input.userId },
    orderBy: { startedAt: 'desc' },
    take: Math.min(input.limit ?? 30, 100),
  });

  for (const row of rows) assertMayView(row, input.viewerUserId);

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    sport: r.sport,
    distanceM: r.distanceM,
  }));
}

/**
 * Award XP for a logged activity.
 *
 * ─── Only for activities the athlete gave us DIRECTLY ────────────────
 *
 * XP feeds a LEADERBOARD, which is a cross-user display, and achievements are
 * shown on a public profile. Both are exactly what Strava forbids.
 *
 * So a Strava-imported run earns NOTHING. That is a real product cost — it is
 * also the only lawful answer, and pretending otherwise would put every
 * connected athlete's integration at risk to award somebody 30 points.
 *
 * A MANUAL entry earns XP, because the athlete typed it in and it is ours.
 */
export async function awardActivityXp(
  db: PrismaClient,
  input: {
    tenantId?: string | null;
    userId: string;
    activityId: string;
    source: ActivitySource;
  },
): Promise<{ awarded: boolean }> {
  if (isRestricted(input.source)) {
    // Not an error. A perfectly normal import that simply does not pay.
    return { awarded: false };
  }

  const r = await awardXp(db, {
    tenantId: input.tenantId,
    userId: input.userId,
    type: 'MATCH_PLAYED',
    dedupeKey: `activity:${input.activityId}`,
    refType: 'activity',
    refId: input.activityId,
  });

  return { awarded: r.awarded };
}
