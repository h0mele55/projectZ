/**
 * STRAVA API AGREEMENT — the rules, in one place, in code.
 *
 * These are not preferences. Strava's API Agreement (as revised November 2024)
 * makes them conditions of access, and breaking them gets an application's API
 * key revoked — which means every connected user's data stops flowing, without
 * warning, permanently. It is also a contract breach.
 *
 * Read this before touching anything that reads a Strava field.
 *
 * ─── 1. NO CROSS-USER DISPLAY ────────────────────────────────────────
 *
 * Strava data may be shown to the athlete it belongs to, and to NOBODY ELSE.
 *
 * That kills, outright:
 *   • a leaderboard of anyone's Strava distance;
 *   • "your friend ran 10km today" in a feed;
 *   • a coach seeing a player's imported rides;
 *   • an aggregate ("average 5k time at this club") that includes Strava rows.
 *
 * An aggregate is a display. A number computed FROM many athletes' Strava data
 * and shown to any of them is a cross-user display of that data, however
 * anonymised it looks.
 *
 * ─── 2. NO AI / ML ───────────────────────────────────────────────────
 *
 * Strava data may not be used to train, fine-tune, or serve any model. Not our
 * openskill ratings, not a recommender, not a "suggest a training plan" prompt
 * sent to an LLM.
 *
 * This one is easy to break by accident: an activity feed that looks harmless
 * gets piped into a matchmaking heuristic, and now Strava data is an ML input.
 *
 * ─── 3. DELETION ON DEAUTHORISATION ──────────────────────────────────
 *
 * When an athlete disconnects, their Strava data must actually go. Not be
 * hidden, not be soft-deleted with a flag we might forget — deleted.
 *
 * ─── How this is ENFORCED, rather than merely documented ─────────────
 *
 * Three layers, because a comment is not an enforcement mechanism:
 *
 *   a) THE DATABASE. An RLS policy makes a STRAVA-sourced row invisible to
 *      anyone but its owner. A buggy query cannot leak it, because Postgres
 *      will not return it — the query returns zero rows, not someone else's
 *      ride.
 *
 *   b) A RATCHET. `tests/guardrails/strava-tos.test.ts` fails the build if
 *      Strava-sourced data reaches the ratings engine, the leaderboard, the
 *      gamification engine, or any AI call site.
 *
 *   c) THIS MODULE. The only sanctioned way to read Strava rows takes the
 *      viewer's id and refuses when it is not the owner.
 *
 * If you are about to add a fourth way to read this data, you are about to
 * break the agreement. Add it here instead.
 */

export const STRAVA_TOS_URL = 'https://www.strava.com/legal/api';

/** Sources whose data is under a third-party agreement that restricts its use. */
export const RESTRICTED_SOURCES = ['STRAVA'] as const;

export type RestrictedSource = (typeof RESTRICTED_SOURCES)[number];

export function isRestricted(source: string): source is RestrictedSource {
  return (RESTRICTED_SOURCES as readonly string[]).includes(source);
}

export class StravaTosViolationError extends Error {
  readonly code = 'strava_tos_violation';
  constructor(what: string) {
    super(
      `Refused: ${what}. Strava's API Agreement forbids it — see ${STRAVA_TOS_URL} ` +
        `and src/lib/wearables/strava-tos.ts. Breaking it gets our API key revoked, ` +
        `which cuts off every connected athlete at once.`,
    );
    this.name = 'StravaTosViolationError';
  }
}

/**
 * The gate. Every read of a restricted-source activity goes through this.
 *
 * `viewerUserId` is REQUIRED and has no default. A default would be the whole
 * bug: someone calls it without thinking, gets the owner's own id back by
 * accident, and the check passes for the wrong reason.
 */
export function assertMayView(
  activity: { userId: string; source: string },
  viewerUserId: string,
): void {
  if (!isRestricted(activity.source)) return;

  if (activity.userId !== viewerUserId) {
    throw new StravaTosViolationError(
      `showing ${activity.source} data belonging to ${activity.userId} to ${viewerUserId}`,
    );
  }
}

/**
 * Strip restricted rows from anything that will be shown to, or computed
 * across, more than one person.
 *
 * Use this at the boundary of every aggregate, leaderboard and feed. It is
 * deliberately blunt: the rows are REMOVED, not anonymised. Anonymising them
 * would still be a cross-user use of the data, and the agreement does not care
 * that the name was taken off.
 */
export function excludeRestricted<T extends { source: string }>(activities: T[]): T[] {
  return activities.filter((a) => !isRestricted(a.source));
}
