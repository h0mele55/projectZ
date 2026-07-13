import {
  RoundRobin,
  SingleElimination,
  Swiss,
  computeStandings,
  formatFor,
  seedOrder,
} from '@/lib/tournaments/formats';
import type { ReportedResult, TournamentPlayer } from '@/lib/tournaments/format';

const players = (n: number): TournamentPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, rating: 1000 - i * 10 }));

describe('round robin', () => {
  it('everyone plays everyone, exactly once', () => {
    // The property that defines the format. A pairing bug that repeats one
    // fixture and omits another is invisible in any single round.
    const field = players(6);
    const rr = new RoundRobin();

    const seen = new Set<string>();
    for (let round = 1; round <= rr.roundsFor(6); round++) {
      for (const p of rr.pair({ players: field, round })) {
        if (!p.away) continue;
        const key = [p.home, p.away].sort().join('|');

        expect(seen.has(key)).toBe(false); // never twice
        seen.add(key);
      }
    }

    // 6 players → 15 distinct fixtures.
    expect(seen.size).toBe(15);
  });

  it('nobody plays themselves', () => {
    const field = players(7);
    const rr = new RoundRobin();

    for (let round = 1; round <= rr.roundsFor(7); round++) {
      for (const p of rr.pair({ players: field, round })) {
        expect(p.home).not.toBe(p.away);
      }
    }
  });

  it('an ODD field gives exactly one bye per round, and each player sits out once', () => {
    const field = players(5);
    const rr = new RoundRobin();

    const byes: string[] = [];
    for (let round = 1; round <= rr.roundsFor(5); round++) {
      const pairings = rr.pair({ players: field, round });
      const roundByes = pairings.filter((p) => p.away === null);

      expect(roundByes).toHaveLength(1);
      byes.push(roundByes[0]!.home);
    }

    // Five rounds, five different players sitting out. Anything else means
    // somebody plays a game fewer than everybody else.
    expect(new Set(byes).size).toBe(5);
  });

  it('an EVEN field has no byes at all', () => {
    const field = players(8);
    const rr = new RoundRobin();

    for (let round = 1; round <= rr.roundsFor(8); round++) {
      const pairings = rr.pair({ players: field, round });
      expect(pairings.filter((p) => p.away === null)).toHaveLength(0);
      expect(pairings).toHaveLength(4);
    }
  });
});

describe('single elimination', () => {
  it('seeds so the top two can only meet in the FINAL', () => {
    // A bracket where seed 1 and seed 2 meet in round one is not a tournament,
    // it is a raffle.
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);

    // 1 and 2 are in opposite halves.
    const order = seedOrder(8);
    const firstHalf = order.slice(0, 4);
    expect(firstHalf).toContain(1);
    expect(firstHalf).not.toContain(2);
  });

  it('the strongest seed plays the weakest', () => {
    const order = seedOrder(8);
    expect([order[0], order[1]]).toEqual([1, 8]);
  });

  it('gives the byes to the TOP seeds when the field is not a power of two', () => {
    // Not a favour. A first seed knocked out in round one by an accident of
    // field size is a broken tournament.
    const se = new SingleElimination();
    const field = players(5); // padded to 8 → 3 byes

    const round1 = se.pair({ players: field, round: 1, results: [] });
    const byes = round1.filter((p) => p.away === null).map((p) => p.home);

    expect(byes).toContain('p1'); // the top seed
    expect(byes).not.toContain('p5'); // the bottom seed plays
  });

  it('the right number of rounds', () => {
    const se = new SingleElimination();

    expect(se.roundsFor(8)).toBe(3);
    expect(se.roundsFor(5)).toBe(3); // padded to 8
    expect(se.roundsFor(16)).toBe(4);
    expect(se.roundsFor(1)).toBe(0);
  });

  it('round 2 pairs the WINNERS of round 1', () => {
    const se = new SingleElimination();
    const field = players(4);

    const round1 = se.pair({ players: field, round: 1, results: [] });
    expect(round1).toHaveLength(2);

    const results: ReportedResult[] = round1.map((p) => ({
      round: 1,
      home: p.home,
      away: p.away!,
      homeScore: 1,
      awayScore: 0,
    }));

    const round2 = se.pair({ players: field, round: 2, results });

    expect(round2).toHaveLength(1);
    // Both finalists won their semi-final.
    const winners = results.map((r) => r.home);
    expect(winners).toContain(round2[0]!.home);
    expect(winners).toContain(round2[0]!.away);
  });
});

describe('standings', () => {
  it('a win is 1, a draw is a half, a loss is nothing', () => {
    const field = players(3);
    const results: ReportedResult[] = [
      { round: 1, home: 'p1', away: 'p2', homeScore: 1, awayScore: 0 },
      { round: 2, home: 'p1', away: 'p3', homeScore: 0.5, awayScore: 0.5 },
    ];

    const table = computeStandings(field, results);
    const p1 = table.find((s) => s.playerId === 'p1')!;

    expect(p1.points).toBe(1.5);
    expect(p1.wins).toBe(1);
    expect(p1.draws).toBe(1);
    expect(p1.losses).toBe(0);
  });

  it('breaks a tie on BUCHHOLZ — how hard was your road', () => {
    // Two players on the same score are NOT equal if one beat the top of the
    // field and the other beat the bottom. Without a tiebreak the ranking
    // between them is decided by array order, which is to say by nothing.
    const field = players(5);

    const results: ReportedResult[] = [
      // p1 beats p2 (who is strong: p2 also beat p3)
      { round: 1, home: 'p1', away: 'p2', homeScore: 1, awayScore: 0 },
      { round: 2, home: 'p2', away: 'p3', homeScore: 1, awayScore: 0 },
      // p4 beats p5 (who is weak: p5 lost to p3 as well)
      { round: 1, home: 'p4', away: 'p5', homeScore: 1, awayScore: 0 },
      { round: 2, home: 'p3', away: 'p5', homeScore: 1, awayScore: 0 },
    ];

    const table = computeStandings(field, results);
    const p1 = table.find((s) => s.playerId === 'p1')!;
    const p4 = table.find((s) => s.playerId === 'p4')!;

    // Both won once.
    expect(p1.points).toBe(p4.points);
    // But p1 beat a player who went on to win; p4 beat a player who lost twice.
    expect(p1.tiebreak).toBeGreaterThan(p4.tiebreak);
    expect(p1.rank).toBeLessThan(p4.rank);
  });

  it('genuinely equal players SHARE a rank', () => {
    // Handing one of them a better number because their id sorts earlier is a
    // fiction, and the player it costs will notice.
    const field = players(2);
    const table = computeStandings(field, []);

    expect(table[0]!.rank).toBe(1);
    expect(table[1]!.rank).toBe(1);
  });

  it('ignores a result naming somebody who is not in the field', () => {
    const field = players(2);
    const results: ReportedResult[] = [
      { round: 1, home: 'p1', away: 'ghost', homeScore: 1, awayScore: 0 },
    ];

    const table = computeStandings(field, results);
    expect(table.find((s) => s.playerId === 'p1')!.points).toBe(0);
  });
});

describe('swiss', () => {
  it('pairs round 1 without a result in sight', () => {
    const swiss = new Swiss();
    const field = players(8);

    const round1 = swiss.pair({ players: field, round: 1 });

    expect(round1).toHaveLength(4);
    for (const p of round1) expect(p.home).not.toBe(p.away);
  });

  it('the library SHUFFLES — two fresh starts give different brackets', () => {
    // The finding that reshaped this whole module. `start()` randomises, so a
    // REPLAY does not reconstruct the event that was played — it invents a
    // different one, and then applies real results to fixtures that never
    // existed. That is why state is persisted rather than recomputed.
    const swiss = new Swiss();
    const field = players(8);

    const runs = new Set(
      Array.from({ length: 6 }, () =>
        swiss
          .start(field)
          .pairings.map((p) => [p.home, p.away].sort().join('|'))
          .sort()
          .join(','),
      ),
    );

    // If this ever collapses to 1, the library has become deterministic and the
    // replay approach would be viable again — but do not assume it. Check.
    expect(runs.size).toBeGreaterThan(1);
  });

  it('never repeats a pairing across a FULL event, driven by persisted state', () => {
    // THE property of Swiss, and the one a naive implementation gets wrong —
    // silently, until round four, when two people are told to play again and the
    // arbiter has to explain it.
    const swiss = new Swiss();
    const field = players(8);
    const seen = new Set<string>();
    const results: ReportedResult[] = [];

    let { pairings, state } = swiss.start(field);
    let round = 1;

    for (;;) {
      for (const p of pairings) {
        if (!p.away) continue;

        const key = [p.home, p.away].sort().join('|');
        expect(seen.has(key)).toBe(false); // never twice
        seen.add(key);

        // Higher seed wins, deterministically, so the test cannot flake.
        const homeWins = Number(p.home.slice(1)) < Number(p.away.slice(1));
        results.push({
          round,
          home: p.home,
          away: p.away,
          homeScore: homeWins ? 1 : 0,
          awayScore: homeWins ? 0 : 1,
        });
      }

      const next = swiss.advance({ state, round, results });
      if (next.finished) break;

      pairings = next.pairings;
      state = next.state;
      round++;
    }

    expect(round).toBe(swiss.roundsFor(8)); // 3 rounds for 8 players
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it('REFUSES to advance while a result is missing', () => {
    // Swiss pairs on standings, and standings missing a game are not standings.
    const swiss = new Swiss();
    const { state } = swiss.start(players(4));

    expect(() => swiss.advance({ state, round: 1, results: [] })).toThrow(/has not been reported/);
  });

  it('REFUSES a stateless pair() for a later round rather than inventing a bracket', () => {
    // The interface demands the method. Returning a recomputed bracket would be
    // returning a tournament nobody played.
    const swiss = new Swiss();

    expect(() => swiss.pair({ players: players(8), round: 2 })).toThrow(/randomises its bracket/);
  });

  it('runs the conventional number of rounds', () => {
    const swiss = new Swiss();

    expect(swiss.roundsFor(32)).toBe(5);
    expect(swiss.roundsFor(64)).toBe(6);
  });
});

describe('the format registry', () => {
  it('returns the right implementation', () => {
    expect(formatFor('ROUND_ROBIN').kind).toBe('ROUND_ROBIN');
    expect(formatFor('SINGLE_ELIMINATION').kind).toBe('SINGLE_ELIMINATION');
    expect(formatFor('SWISS').kind).toBe('SWISS');
  });

  it('REFUSES double elimination rather than shipping half of it', () => {
    // A losers bracket that silently drops a player is worse than not offering
    // the format at all.
    expect(() => formatFor('DOUBLE_ELIMINATION')).toThrow(/not implemented/);
  });
});
