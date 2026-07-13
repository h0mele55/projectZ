import { ordinal, predictWin, rate, rating } from 'openskill';

/**
 * Team ratings, via openskill (Weng-Lin Bayesian, MIT).
 *
 * ─── Why openskill and not TrueSkill ─────────────────────────────────
 *
 * TrueSkill is PATENTED by Microsoft. Shipping it in a commercial product is a
 * legal decision, not an engineering one, and it is not a decision worth making
 * for a rating system when a free, published, peer-reviewed alternative exists.
 *
 * openskill implements Weng-Lin — the same Bayesian family, MIT-licensed, and
 * in practice within noise of TrueSkill's accuracy.
 *
 * ─── Why not just use Glicko-2 for everything ────────────────────────
 *
 * Glicko-2 rates INDIVIDUALS in 1v1 contests. Padel is 2v2. Football is 11v11.
 *
 * The naive fix is to average each team's ratings and treat the match as one
 * 1v1 between two averages. What that throws away is UNCERTAINTY, per player.
 *
 * openskill scales each player's update by their OWN sigma². Measured against
 * this library: two teammates on the same winning side, identical mu, one a
 * newcomer (sigma 8.3) and one a veteran (sigma 2.0) — the newcomer's rating
 * moves 17× further. That is exactly right. The newcomer's rating is a guess and
 * should converge fast; the veteran's is evidence and should barely twitch.
 * Averaging the team into one number destroys that distinction completely: the
 * team gets one sigma, and the newcomer's rating crawls while the veteran's
 * lurches.
 *
 * It also handles N teams and unequal team sizes natively, which a 1v1 engine
 * simply cannot express.
 *
 * ─── The honest limitation ───────────────────────────────────────────
 *
 * Two teammates with the SAME uncertainty get the SAME mu delta, however
 * differently they played. openskill cannot tell who did the winning within a
 * team — and neither can anything else, because THE RESULT DOES NOT CONTAIN
 * THAT INFORMATION. A 6-3 padel win says the pair won; it says nothing about
 * which of them held the net.
 *
 * Inferring it would mean inventing data. If we want per-player performance
 * within a team, that has to come from something we actually measured, not from
 * the scoreline.
 *
 * ─── Chess keeps Glicko-2 ────────────────────────────────────────────
 *
 * See the registry. It is genuinely 1v1, Glicko-2 is the established standard
 * there (it is what Lichess uses), and an openskill number for chess would be
 * incomparable with every rating a player already has.
 */

export interface OpenSkillRating {
  mu: number;
  sigma: number;
}

/** A new player: maximum uncertainty, average skill. */
export function newRating(): OpenSkillRating {
  const r = rating();
  return { mu: r.mu, sigma: r.sigma };
}

/**
 * The single number to SHOW a player.
 *
 * `ordinal` is `mu - 3σ` — a conservative estimate, the skill we are confident
 * they are *at least*.
 *
 * Displaying raw `mu` instead would mean a brand-new player, whose mu is the
 * average by definition, appears exactly as good as a veteran who has proven it
 * over a hundred matches. The uncertainty has to be visible in the number, or
 * the number is a lie of omission.
 */
export function displayRating(r: OpenSkillRating): number {
  return Math.round(ordinal({ mu: r.mu, sigma: r.sigma }) * 100) / 100;
}

/**
 * Update every player's rating from a team result.
 *
 * `teams` is ordered BEST-FIRST: teams[0] beat teams[1], and so on. That
 * ordering is the entire input — openskill has no notion of a score, only of
 * placement, which is why it works identically for a 2-team padel match and a
 * 6-team tournament round.
 *
 * `ties` lets you say two teams finished level (see `rateMatch` callers).
 */
export function rateTeams(
  teams: OpenSkillRating[][],
  opts: { ranks?: number[] } = {},
): OpenSkillRating[][] {
  if (teams.length < 2) {
    throw new Error(`A match needs at least two teams; got ${teams.length}.`);
  }
  if (teams.some((t) => t.length === 0)) {
    throw new Error('A team cannot be empty.');
  }

  // openskill's `rank` is LOWER-IS-BETTER, and equal ranks mean a draw. Without
  // explicit ranks it assumes teams are already ordered best-first, which is
  // the contract above.
  const result = rate(
    teams.map((team) => team.map((p) => ({ mu: p.mu, sigma: p.sigma }))),
    opts.ranks ? { rank: opts.ranks } : undefined,
  );

  return result.map((team) => team.map((p) => ({ mu: p.mu, sigma: p.sigma })));
}

/**
 * How likely is each team to win? Used to seed balanced matches.
 *
 * Returns one probability per team, summing to 1.
 */
export function winProbabilities(teams: OpenSkillRating[][]): number[] {
  return predictWin(teams.map((team) => team.map((p) => ({ mu: p.mu, sigma: p.sigma }))));
}

/**
 * How lopsided is this fixture? 0 = a coin flip, 1 = a foregone conclusion.
 *
 * The matchmaker wants this NEAR ZERO. A 95%-certain result is not a game, it
 * is an appointment — and the player on the wrong end of it does not come back.
 */
export function imbalance(teams: OpenSkillRating[][]): number {
  const probabilities = winProbabilities(teams);

  // Distance of the most likely winner from a perfectly even split.
  const even = 1 / teams.length;
  const best = Math.max(...probabilities);

  return (best - even) / (1 - even);
}
