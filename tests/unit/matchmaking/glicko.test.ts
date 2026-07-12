import { defaultRating, rate, type Rating } from '@/lib/matchmaking/glicko';

const r = (mu: number, phi: number, sigma = 0.06, matchesPlayed = 0): Rating => ({
  mu,
  phi,
  sigma,
  matchesPlayed,
});

describe('Glicko-2', () => {
  /**
   * GLICKMAN'S OWN WORKED EXAMPLE (glicko2.pdf, §3).
   *
   * A rating implementation that is subtly wrong still produces
   * plausible-looking numbers — ratings go up when you win and down when
   * you lose, so every hand-written "does it feel right?" test passes.
   * The only way to know it is actually correct is to reproduce the
   * reference numbers.
   *
   * Player: 1500 / RD 200 / vol 0.06 against three opponents.
   * Expected: mu ≈ 1464.06, phi ≈ 151.52, sigma ≈ 0.05999.
   */
  it("reproduces Glickman's published worked example", () => {
    const player = r(1500, 200);

    const out = rate(player, [
      { opponent: r(1400, 30), score: 1 },
      { opponent: r(1550, 100), score: 0 },
      { opponent: r(1700, 300), score: 0 },
    ]);

    expect(out.mu).toBeCloseTo(1464.06, 1);
    expect(out.phi).toBeCloseTo(151.52, 1);
    expect(out.sigma).toBeCloseTo(0.05999, 4);
  });

  it('a win against a stronger opponent raises the rating more than against a weaker one', () => {
    const player = r(1500, 200);

    const beatStrong = rate(player, [{ opponent: r(1900, 50), score: 1 }]);
    const beatWeak = rate(player, [{ opponent: r(1100, 50), score: 1 }]);

    expect(beatStrong.mu).toBeGreaterThan(beatWeak.mu);
  });

  it('CONFIDENCE decays when a player does not play', () => {
    // The point of phi. Someone who has not played in six months is not
    // still a known quantity — and if phi did not widen, a returning player
    // would keep being matched against a stale estimate of who they used to
    // be.
    const settled = r(1500, 50, 0.06, 40);

    let current = settled;
    for (let period = 0; period < 10; period++) {
      current = rate(current, []);
    }

    expect(current.mu).toBe(1500); // the rating itself does not drift
    expect(current.phi).toBeGreaterThan(settled.phi); // but we are less sure
    expect(current.matchesPlayed).toBe(40);
  });

  it('phi never decays past the default RD — uncertainty is bounded', () => {
    // Without the cap, a long-absent player's phi grows without limit and
    // the next result they post swings their rating absurdly.
    let current = r(1500, 50, 0.06, 40);
    for (let i = 0; i < 500; i++) current = rate(current, []);

    expect(current.phi).toBeLessThanOrEqual(350.001);
  });

  it('a new player moves FAST; a settled player moves slowly', () => {
    // This is the whole reason to use Glicko-2 over Elo. A newcomer and a
    // veteran can both sit at 1500, but one rating is a guess and the other
    // is earned.
    const newcomer = defaultRating(); // phi 350
    const veteran = r(1500, 40, 0.06, 200);

    const opponent = r(1600, 50);

    const newcomerAfter = rate(newcomer, [{ opponent, score: 1 }]);
    const veteranAfter = rate(veteran, [{ opponent, score: 1 }]);

    const newcomerMove = Math.abs(newcomerAfter.mu - newcomer.mu);
    const veteranMove = Math.abs(veteranAfter.mu - veteran.mu);

    expect(newcomerMove).toBeGreaterThan(veteranMove * 3);
  });

  it('phi NARROWS as evidence accumulates', () => {
    let current = defaultRating();
    const before = current.phi;

    for (let i = 0; i < 10; i++) {
      current = rate(current, [{ opponent: r(1500, 100), score: i % 2 === 0 ? 1 : 0 }]);
    }

    expect(current.phi).toBeLessThan(before);
    expect(current.matchesPlayed).toBe(10);
  });

  it('the ORDER of results within a rating period does not change the outcome', () => {
    // All of a period's matches are applied together. If order mattered, two
    // players who beat the same opponents on the same night would end up with
    // different ratings purely because of the order the rows came back from
    // the database.
    const player = r(1500, 200);

    const results = [
      { opponent: r(1400, 30), score: 1 },
      { opponent: r(1550, 100), score: 0 },
      { opponent: r(1700, 300), score: 0 },
    ];

    const forwards = rate(player, results);
    const backwards = rate(player, [...results].reverse());

    expect(forwards.mu).toBeCloseTo(backwards.mu, 6);
    expect(forwards.phi).toBeCloseTo(backwards.phi, 6);
  });

  it('a draw sits between a win and a loss', () => {
    const player = r(1500, 200);
    const opponent = r(1500, 200);

    const win = rate(player, [{ opponent, score: 1 }]).mu;
    const draw = rate(player, [{ opponent, score: 0.5 }]).mu;
    const loss = rate(player, [{ opponent, score: 0 }]).mu;

    expect(win).toBeGreaterThan(draw);
    expect(draw).toBeGreaterThan(loss);
    // Against an identical opponent, a draw should barely move you at all.
    expect(Math.abs(draw - 1500)).toBeLessThan(1);
  });

  it('produces finite numbers under extreme inputs', () => {
    // A NaN rating silently poisons every future match this player appears
    // in, and there is no error to trace it back to.
    const extreme = rate(r(1500, 350), [
      { opponent: r(3000, 30), score: 1 },
      { opponent: r(100, 30), score: 0 },
    ]);

    expect(Number.isFinite(extreme.mu)).toBe(true);
    expect(Number.isFinite(extreme.phi)).toBe(true);
    expect(Number.isFinite(extreme.sigma)).toBe(true);
    expect(extreme.sigma).toBeGreaterThan(0);
  });
});
