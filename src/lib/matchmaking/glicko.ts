/**
 * Glicko-2, and why it beats Elo for a booking platform.
 *
 * Elo has one number: your rating. Glicko-2 has three:
 *
 *   mu    — the rating itself
 *   phi   — the DEVIATION: how unsure we are about mu
 *   sigma — the VOLATILITY: how erratic your results are
 *
 * `phi` is the one that matters here. A brand-new player and a veteran can
 * both sit at 1500, but the newcomer's rating is a guess and the veteran's
 * is earned. Elo cannot tell them apart, so it either moves the newcomer
 * too slowly (they spend weeks matched against the wrong people, and quit)
 * or moves the veteran too fast (one bad night wrecks a year of results).
 *
 * Glicko-2 widens phi when you have not played, so a returning player is
 * re-placed quickly, and narrows it as evidence accumulates.
 *
 * That is exactly the shape of a casual sports app: people play in bursts,
 * disappear for a season, and come back.
 */

/** Glicko-2 works in an internal scale; ratings are shown on the Glicko-1 scale. */
const SCALE = 173.7178;
const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;
const DEFAULT_VOL = 0.06;

/**
 * System constant, constraining how much volatility can move.
 * Glickman recommends 0.3–1.2; smaller is more stable. 0.5 suits
 * recreational play, where one bad night should not be read as a change in
 * true skill.
 */
const TAU = 0.5;
const EPSILON = 0.000_001;

export interface Rating {
  mu: number;
  phi: number;
  sigma: number;
  matchesPlayed: number;
}

export interface MatchResult {
  opponent: Rating;
  /** 1 = win, 0.5 = draw, 0 = loss. */
  score: number;
}

export function defaultRating(): Rating {
  return { mu: DEFAULT_RATING, phi: DEFAULT_RD, sigma: DEFAULT_VOL, matchesPlayed: 0 };
}

const toInternal = (r: Rating) => ({
  mu: (r.mu - DEFAULT_RATING) / SCALE,
  phi: r.phi / SCALE,
  sigma: r.sigma,
});

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * Rate a player against the results of ONE rating period.
 *
 * All of a period's matches are applied together, not one at a time. Order
 * within a period must not change the outcome — otherwise two players who
 * beat the same opponents on the same night end up with different ratings
 * purely because of the order the rows came back from the database.
 */
export function rate(player: Rating, results: readonly MatchResult[]): Rating {
  const p = toInternal(player);

  // No games: the rating does not move, but CONFIDENCE decays.
  //
  // Someone who has not played in six months is not still a known quantity.
  // If phi did not widen, a returning player would keep being matched
  // against a stale estimate of who they used to be.
  if (results.length === 0) {
    const phiPrime = Math.min(Math.sqrt(p.phi * p.phi + p.sigma * p.sigma), DEFAULT_RD / SCALE);
    return {
      mu: player.mu,
      phi: phiPrime * SCALE,
      sigma: player.sigma,
      matchesPlayed: player.matchesPlayed,
    };
  }

  const opponents = results.map((r) => ({ ...toInternal(r.opponent), score: r.score }));

  let vInv = 0;
  for (const o of opponents) {
    const e = E(p.mu, o.mu, o.phi);
    vInv += g(o.phi) ** 2 * e * (1 - e);
  }
  const v = 1 / vInv;

  let deltaSum = 0;
  for (const o of opponents) {
    deltaSum += g(o.phi) * (o.score - E(p.mu, o.mu, o.phi));
  }
  const delta = v * deltaSum;

  const sigmaPrime = newVolatility(p.phi, p.sigma, v, delta);

  const phiStar = Math.sqrt(p.phi * p.phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = p.mu + phiPrime * phiPrime * deltaSum;

  return {
    mu: muPrime * SCALE + DEFAULT_RATING,
    phi: phiPrime * SCALE,
    sigma: sigmaPrime,
    matchesPlayed: player.matchesPlayed + results.length,
  };
}

/**
 * Illinois-algorithm root find for the new volatility.
 *
 * This is the part people skip, substituting "just keep sigma constant".
 * Doing so removes the entire mechanism that tells a consistent player from
 * an erratic one — which is most of the reason to pick Glicko-2 over Elo.
 */
function newVolatility(phi: number, sigma: number, v: number, delta: number): number {
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) ** 2;
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;

  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  let guard = 0;

  while (Math.abs(B - A) > EPSILON) {
    // A root find that does not converge must not become an infinite loop
    // inside a request. Bail rather than hang the worker.
    if (guard++ > 100) break;

    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);

    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }

    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}
