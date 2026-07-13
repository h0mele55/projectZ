import { SPORTS } from '@/lib/sports/registry';
import { displayFor, engineFor, newRatingFor, rateMatch } from '@/lib/ratings/engine';
import {
  displayRating,
  imbalance,
  newRating,
  rateTeams,
  winProbabilities,
} from '@/lib/ratings/openskill';

describe('which engine a sport uses', () => {
  it('CHESS is the ONLY Glicko-2 sport', () => {
    // This is the ratchet. "Just make everything openskill" would silently reset
    // every chess player to a number incomparable with the one they had
    // yesterday — an openskill ordinal is ~25-centred, a Glicko rating ~1500.
    const glicko = Object.values(SPORTS).filter((s) => s.ratingEngine === 'GLICKO2');

    expect(glicko.map((s) => s.key)).toEqual(['CHESS']);
  });

  it('every other sport uses openskill', () => {
    const engines = new Set(Object.values(SPORTS).map((s) => s.ratingEngine));
    expect([...engines].sort()).toEqual(['GLICKO2', 'OPENSKILL']);
  });

  it('the engine comes from the registry, not from a conditional', () => {
    expect(engineFor('CHESS')).toBe('GLICKO2');
    expect(engineFor('PADEL')).toBe('OPENSKILL');
    expect(engineFor('FOOTBALL')).toBe('OPENSKILL');
  });
});

describe('the displayed number', () => {
  it('is CONSERVATIVE — a new player does not look established', () => {
    // Raw mu would make a brand-new player (whose mu IS the average, by
    // definition) appear exactly as good as a veteran who proved it over a
    // hundred matches. The uncertainty has to be visible in the number.
    const fresh = newRating();

    expect(displayRating(fresh)).toBeLessThan(fresh.mu);
  });

  it('RISES as uncertainty falls, at the same mu', () => {
    const uncertain = { mu: 25, sigma: 8.333 };
    const proven = { mu: 25, sigma: 2.0 };

    // Same estimated skill, but we are far surer of the second player — and the
    // number they are shown should say so.
    expect(displayRating(proven)).toBeGreaterThan(displayRating(uncertain));
  });

  it('does not double-convert the Glicko scale', () => {
    // Our glicko.ts stores mu on the 1500-CENTRED scale already. Applying
    // Glickman's internal-scale conversion again would produce ~1500 + 173×1500
    // — a number that looks like a rating and is nonsense.
    const chess = newRatingFor('CHESS');
    const shown = displayFor(chess);

    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(2000);
  });
});

describe('openskill rates the INDIVIDUAL, not the team average', () => {
  it('an UNCERTAIN player learns far more from the same win than a proven one', () => {
    // THE reason openskill rather than "average the team and run Glicko".
    //
    // Each player's update is scaled by their OWN sigma². Two teammates on the
    // same winning side, identical mu — one a newcomer, one a veteran:
    const newcomer = { mu: 25, sigma: 8.333 };
    const veteran = { mu: 25, sigma: 2.0 };
    const opponents = [
      { mu: 25, sigma: 2 },
      { mu: 25, sigma: 2 },
    ];

    const [winners] = rateTeams([[veteran, newcomer], opponents]);
    const veteranGain = winners![0]!.mu - veteran.mu;
    const newcomerGain = winners![1]!.mu - newcomer.mu;

    // The newcomer's rating is a GUESS and should converge fast. The veteran's
    // is EVIDENCE and should barely twitch. Averaging the team into one number
    // destroys this distinction entirely — the team gets one sigma.
    expect(newcomerGain).toBeGreaterThan(veteranGain * 10);
  });

  it('two teammates with the SAME uncertainty move IDENTICALLY — and that is correct', () => {
    // The honest limitation, pinned so nobody later "fixes" it into a false
    // belief. openskill cannot tell who did the winning WITHIN a team — and
    // neither can anything else, because the result does not contain that
    // information. A 6-3 padel win says the pair won; it says nothing about
    // which of them held the net.
    //
    // Inferring it would mean inventing data.
    const strong = { mu: 35, sigma: 2 };
    const weak = { mu: 15, sigma: 2 };

    const [winners] = rateTeams([
      [strong, weak],
      [
        { mu: 25, sigma: 2 },
        { mu: 25, sigma: 2 },
      ],
    ]);

    expect(winners![0]!.mu - strong.mu).toBeCloseTo(winners![1]!.mu - weak.mu, 6);
  });

  it('beating a much stronger team moves you more than beating a weaker one', () => {
    const me = { mu: 25, sigma: 3 };

    const [afterUpset] = rateTeams([[me], [{ mu: 40, sigma: 3 }]]);
    const [afterExpected] = rateTeams([[me], [{ mu: 10, sigma: 3 }]]);

    expect(afterUpset![0]!.mu - me.mu).toBeGreaterThan(afterExpected![0]!.mu - me.mu);
  });

  it('CERTAINTY increases with every match — sigma only ever shrinks', () => {
    let r = newRating();
    const opponent = { mu: 25, sigma: 8.333 };

    for (let i = 0; i < 10; i++) {
      const before = r.sigma;
      [[r]] = rateTeams([[r], [opponent]]) as [[typeof r], unknown[]];
      expect(r.sigma).toBeLessThanOrEqual(before);
    }
  });

  it('a draw moves both teams toward each other', () => {
    const strong = { mu: 35, sigma: 3 };
    const weak = { mu: 15, sigma: 3 };

    // Equal ranks = a draw.
    const [a, b] = rateTeams([[strong], [weak]], { ranks: [1, 1] });

    // The favourite drew a match they should have won: they lose ground.
    expect(a![0]!.mu).toBeLessThan(strong.mu);
    // The underdog held them: they gain.
    expect(b![0]!.mu).toBeGreaterThan(weak.mu);
  });

  it('refuses a match with fewer than two teams', () => {
    expect(() => rateTeams([[newRating()]])).toThrow(/at least two teams/);
  });

  it('refuses an empty team', () => {
    expect(() => rateTeams([[newRating()], []])).toThrow(/cannot be empty/);
  });
});

describe('predicting a fixture', () => {
  it('an even match is a coin flip', () => {
    const even = [[{ mu: 25, sigma: 3 }], [{ mu: 25, sigma: 3 }]];

    const [a, b] = winProbabilities(even);
    expect(a).toBeCloseTo(0.5, 2);
    expect(b).toBeCloseTo(0.5, 2);
    expect(imbalance(even)).toBeCloseTo(0, 1);
  });

  it('a lopsided match is a foregone conclusion — which is what the matchmaker must avoid', () => {
    // A 95%-certain result is not a game, it is an appointment, and the player
    // on the wrong end of it does not come back.
    const lopsided = [[{ mu: 45, sigma: 1 }], [{ mu: 5, sigma: 1 }]];

    expect(imbalance(lopsided)).toBeGreaterThan(0.9);
    expect(winProbabilities(lopsided)[0]).toBeGreaterThan(0.95);
  });
});

describe('rateMatch dispatches on the sport', () => {
  it('rates a 2v2 padel match with openskill', () => {
    const teams = [
      [
        { userId: 'a', rating: newRatingFor('PADEL') },
        { userId: 'b', rating: newRatingFor('PADEL') },
      ],
      [
        { userId: 'c', rating: newRatingFor('PADEL') },
        { userId: 'd', rating: newRatingFor('PADEL') },
      ],
    ];

    const result = rateMatch({ sport: 'PADEL', teams });

    expect(result.size).toBe(4);
    expect(result.get('a')!.engine).toBe('OPENSKILL');
    // Winners up, losers down.
    expect(result.get('a')!.state.mu).toBeGreaterThan(25);
    expect(result.get('c')!.state.mu).toBeLessThan(25);
  });

  it('rates a chess game with Glicko-2', () => {
    const teams = [
      [{ userId: 'w', rating: newRatingFor('CHESS') }],
      [{ userId: 'b', rating: newRatingFor('CHESS') }],
    ];

    const result = rateMatch({ sport: 'CHESS', teams });

    expect(result.get('w')!.engine).toBe('GLICKO2');
    expect(result.get('w')!.state.mu).toBeGreaterThan(1500);
    expect(result.get('b')!.state.mu).toBeLessThan(1500);
  });

  it('REFUSES a team chess match rather than inventing an averaging scheme', () => {
    // Glicko-2 has no concept of a team. If someone models 2v2 chess, the right
    // answer is to refuse — not to average two ratings into one and produce a
    // number nobody could interpret.
    const teams = [
      [
        { userId: 'a', rating: newRatingFor('CHESS') },
        { userId: 'b', rating: newRatingFor('CHESS') },
      ],
      [
        { userId: 'c', rating: newRatingFor('CHESS') },
        { userId: 'd', rating: newRatingFor('CHESS') },
      ],
    ];

    expect(() => rateMatch({ sport: 'CHESS', teams })).toThrow(/1v1 contests only/);
  });

  it('REFUSES to read a Glicko rating as an openskill one', () => {
    // The scales are not interchangeable. mu=1500 read as an openskill mu is a
    // player 60× better than anyone alive, and the number LOOKS plausible.
    const teams = [
      [{ userId: 'a', rating: newRatingFor('CHESS') }], // GLICKO2 state…
      [{ userId: 'b', rating: newRatingFor('PADEL') }],
    ];

    expect(() => rateMatch({ sport: 'PADEL', teams })).toThrow(/not interchangeable/);
  });
});
