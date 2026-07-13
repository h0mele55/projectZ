import type { SportType } from '@prisma/client';

import {
  type Rating as Glicko2Rating,
  defaultRating,
  rate as rateGlicko2,
} from '@/lib/matchmaking/glicko';
import { SPORTS } from '@/lib/sports/registry';

import { type OpenSkillRating, displayRating, newRating, rateTeams } from './openskill';

/**
 * Which rating engine a sport uses — and the ONE place that decides.
 *
 * The engine is DATA, on the sport registry (P13). Not a conditional here.
 * `if (sport === 'CHESS')` scattered through the codebase is how you end up
 * with a seventeenth sport that silently gets treated like tennis.
 *
 * ─── The two engines are NOT interchangeable ─────────────────────────
 *
 * They produce numbers on different scales, from different state, with
 * different meanings. A player's chess rating (Glicko-2, ~1500 centred) and
 * their padel rating (openskill ordinal, ~25 centred) are not comparable, must
 * never be averaged, and must never be migrated from one to the other.
 *
 * Which is why the state is stored per-sport and the engine is looked up per
 * sport, every time. A ratchet asserts CHESS is the only GLICKO2 sport, so
 * "just make everything openskill" cannot happen by accident — it would silently
 * reset every chess player's rating to a number incomparable with the one they
 * had yesterday.
 */

export type RatingEngine = 'GLICKO2' | 'OPENSKILL';

export function engineFor(sport: SportType): RatingEngine {
  return SPORTS[sport].ratingEngine;
}

/** The rating state for a sport, in whatever shape its engine needs. */
export type SportRating =
  { engine: 'GLICKO2'; state: Glicko2Rating } | { engine: 'OPENSKILL'; state: OpenSkillRating };

export function newRatingFor(sport: SportType): SportRating {
  const engine = engineFor(sport);

  return engine === 'GLICKO2' ? { engine, state: defaultRating() } : { engine, state: newRating() };
}

/**
 * The number to SHOW.
 *
 * Both engines carry an uncertainty term, and both must have it reflected in
 * the displayed figure — otherwise a player with one match looks exactly as
 * established as one with two hundred.
 */
export function displayFor(rating: SportRating): number {
  if (rating.engine === 'OPENSKILL') return displayRating(rating.state);

  // Our glicko.ts already stores mu on the 1500-CENTRED rating scale (not
  // Glickman's internal scale — see SCALE in that file), so no conversion here.
  // Converting again would produce a number around 1500 + 173·1500, which looks
  // like a rating and is nonsense.
  //
  // Subtract 2·phi for the same conservative reason openskill subtracts 3·sigma:
  // a provisional player must not be displayed as an established one.
  return Math.round(rating.state.mu - 2 * rating.state.phi);
}

export interface MatchOutcome {
  sport: SportType;
  /** Ordered BEST-FIRST. teams[0] beat teams[1]. */
  teams: Array<{ userId: string; rating: SportRating }[]>;
  /** Equal ranks = a draw. Omit for a straightforward ordering. */
  ranks?: number[];
}

/**
 * Rate a match. Dispatches on the sport's engine.
 *
 * Returns the NEW rating for every player, keyed by userId.
 */
export function rateMatch(outcome: MatchOutcome): Map<string, SportRating> {
  const engine = engineFor(outcome.sport);
  const out = new Map<string, SportRating>();

  if (engine === 'OPENSKILL') {
    const states = outcome.teams.map((team) =>
      team.map((p) => {
        if (p.rating.engine !== 'OPENSKILL') {
          // A Glicko state reaching the openskill path means a sport's engine
          // changed under a player's stored rating. Refuse rather than coerce:
          // mu means a different thing in each system, and quietly reading one
          // as the other produces a plausible number that is nonsense.
          throw new Error(
            `${outcome.sport} uses OPENSKILL but ${p.userId} has a ${p.rating.engine} rating stored. ` +
              `These scales are not interchangeable.`,
          );
        }
        return p.rating.state;
      }),
    );

    const rated = rateTeams(states, { ranks: outcome.ranks });

    outcome.teams.forEach((team, t) => {
      team.forEach((p, i) => {
        out.set(p.userId, { engine: 'OPENSKILL', state: rated[t]![i]! });
      });
    });

    return out;
  }

  // ── GLICKO2: chess only, and genuinely 1v1 ────────────────────────
  //
  // Glicko-2 has no concept of a team. A 2v2 chess match is not a thing, and if
  // someone models one, the right response is to refuse rather than to invent
  // an averaging scheme whose numbers nobody could interpret.
  if (outcome.teams.length !== 2 || outcome.teams.some((t) => t.length !== 1)) {
    throw new Error(
      `${outcome.sport} uses GLICKO2, which rates 1v1 contests only. ` +
        `Got ${outcome.teams.length} teams of sizes [${outcome.teams.map((t) => t.length).join(', ')}].`,
    );
  }

  const [a, b] = outcome.teams as [
    { userId: string; rating: SportRating }[],
    { userId: string; rating: SportRating }[],
  ];
  const p1 = a[0]!;
  const p2 = b[0]!;

  if (p1.rating.engine !== 'GLICKO2' || p2.rating.engine !== 'GLICKO2') {
    throw new Error(`${outcome.sport} uses GLICKO2 but a player has a non-Glicko rating stored.`);
  }

  // ranks equal → draw; otherwise teams[0] won, by the best-first contract.
  const drawn = outcome.ranks ? outcome.ranks[0] === outcome.ranks[1] : false;
  const scoreForP1 = drawn ? 0.5 : 1;

  out.set(p1.userId, {
    engine: 'GLICKO2',
    state: rateGlicko2(p1.rating.state, [{ opponent: p2.rating.state, score: scoreForP1 }]),
  });
  out.set(p2.userId, {
    engine: 'GLICKO2',
    state: rateGlicko2(p2.rating.state, [{ opponent: p1.rating.state, score: 1 - scoreForP1 }]),
  });

  return out;
}
