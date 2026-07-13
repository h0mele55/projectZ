import TournamentOrganizer from 'tournament-organizer';

import {
  type Pairing,
  type ReportedResult,
  type Standing,
  type TournamentFormat,
  type TournamentFormatKind,
  type TournamentPlayer,
} from './format';
import { computeStandings } from './standings';

/**
 * SWISS — the one format we do NOT write ourselves.
 *
 * Swiss pairing done properly means: pair within score groups, never repeat a
 * pairing, balance colours, float players between score groups when one is odd,
 * and give the bye to the lowest-scoring player who has not had one. Get any of
 * those wrong and nobody notices until round four of a real event, when two
 * people are told to play each other again and the arbiter has to explain it.
 *
 * `tournament-organizer` (MIT) does this. It is a bus-factor-1 library, which is
 * exactly why it lives behind our `TournamentFormat` interface and behind THIS
 * FILE — if it is abandoned, this is the only thing that has to be rewritten.
 *
 * ═══ THE LIBRARY SHUFFLES. STATE IS PERSISTED, NEVER REPLAYED. ═══
 *
 * The obvious way to drive a stateful library from a stateless request is to
 * REPLAY: rebuild the tournament, re-add the players, re-enter every result so
 * far, and ask for the next pairing.
 *
 * That does not work here, and it fails in the worst possible way.
 *
 * The library RANDOMISES its opening bracket. Building the same tournament with
 * the same eight players three times produces three DIFFERENT round-one
 * pairings. A replay therefore does not reconstruct the event that was played —
 * it invents a different one, and then tries to apply real results to fixtures
 * that never existed. Mid-event, the tournament quietly becomes nonsense.
 *
 * (I built it by replay first, and asserted in a comment that the library was
 * deterministic. The no-rematch test caught it. It is not.)
 *
 * So the library's OWN STATE is the record of the bracket, and it is PERSISTED:
 * `getValues()` out, `loadTournament()` back in. That is what the library is
 * designed for, and it removes the determinism assumption entirely.
 *
 * The caller stores the blob (see `Tournament.stateJson`).
 */

/** The library's serialised state. Opaque on purpose — it is THEIRS, not ours. */
export type SwissState = unknown;

type LoadableState = Parameters<TournamentOrganizer['loadTournament']>[0];
type LibTournament = ReturnType<TournamentOrganizer['createTournament']>;

export class Swiss implements TournamentFormat {
  readonly kind: TournamentFormatKind = 'SWISS';

  /**
   * The conventional Swiss length: enough rounds that one player can plausibly
   * emerge undefeated. ceil(log2(n)) — 5 rounds for 32 players, 6 for 64.
   *
   * Fewer, and the top of the table is settled by tiebreaks rather than by
   * playing; more, and you are running a round robin the slow way.
   */
  roundsFor(playerCount: number): number {
    if (playerCount < 2) return 0;
    return Math.max(1, Math.ceil(Math.log2(playerCount)));
  }

  /**
   * Begin the event. Returns round-one pairings AND the state to store.
   *
   * This is the ONLY moment the bracket is randomised. From here on the stored
   * state is the record of what was actually played.
   */
  start(players: TournamentPlayer[]): { pairings: Pairing[]; state: SwissState } {
    if (players.length < 2) return { pairings: [], state: null };

    const manager = new TournamentOrganizer();
    const tournament = manager.createTournament('t', {
      stageOne: { format: 'swiss', rounds: this.roundsFor(players.length) },
      scoring: { win: 1, draw: 0.5, loss: 0, bye: 1 },
    });

    for (const p of players) {
      const player = tournament.createPlayer(p.id, p.id);
      // `value` is the seeding weight the library pairs on. Set through `set()`
      // — the field itself is private, and reaching past that is how a patch
      // release breaks you.
      if (p.rating !== undefined) player.set({ value: p.rating });
    }

    tournament.startTournament();

    return {
      pairings: this.pairingsFor(tournament, 1),
      state: tournament.getValues(),
    };
  }

  /**
   * Enter a round's results and pair the next one.
   *
   * Takes the stored state, returns the new state. The caller persists it.
   */
  advance(input: { state: SwissState; round: number; results: ReportedResult[] }): {
    pairings: Pairing[];
    state: SwissState;
    finished: boolean;
  } {
    const manager = new TournamentOrganizer();
    const tournament = manager.loadTournament(input.state as LoadableState);

    for (const match of tournament.getMatchesByRound(input.round)) {
      const p1 = match.getPlayer1().id;
      const p2 = match.getPlayer2().id;

      // A bye: one side only. Nothing to report — the library scores it itself.
      if (!p1 || !p2) continue;

      const reported = input.results.find(
        (r) => (r.home === p1 && r.away === p2) || (r.home === p2 && r.away === p1),
      );

      // Swiss pairs on standings, and standings missing a game are not
      // standings. Pairing the next round on incomplete information produces a
      // bracket that is simply wrong — refuse rather than guess.
      if (!reported) {
        throw new Error(
          `Cannot advance past round ${input.round}: the result of ${p1} vs ${p2} ` +
            `has not been reported.`,
        );
      }

      // The library's player1 is not necessarily our `home` — it assigns sides
      // by its own colour-balancing logic. Report the scores the way IT sees the
      // board, or the point lands on the wrong player.
      const flipped = reported.home === p2;
      tournament.enterResult(
        match.getId(),
        flipped ? reported.awayScore : reported.homeScore,
        flipped ? reported.homeScore : reported.awayScore,
      );
    }

    const totalRounds = tournament.getStageOne().rounds;

    if (input.round >= totalRounds) {
      return { pairings: [], state: tournament.getValues(), finished: true };
    }

    tournament.nextRound();

    return {
      pairings: this.pairingsFor(tournament, input.round + 1),
      state: tournament.getValues(),
      finished: false,
    };
  }

  private pairingsFor(tournament: LibTournament, round: number): Pairing[] {
    return tournament
      .getMatchesByRound(round)
      .map((m) => {
        const p1 = m.getPlayer1().id;
        const p2 = m.getPlayer2().id;

        return {
          round,
          // A bye is a match with only one player. Whichever side is present
          // gets it.
          home: p1 ?? p2 ?? '',
          away: p1 && p2 ? p2 : null,
        };
      })
      .filter((p) => p.home !== '');
  }

  /**
   * The stateless interface's `pair`.
   *
   * Swiss CANNOT be paired statelessly — see the note at the top of this file.
   * The interface requires the method, so it exists, and it REFUSES loudly for
   * any round but the first, rather than handing back a bracket that was
   * invented rather than played.
   */
  pair(input: { players: TournamentPlayer[]; round: number }): Pairing[] {
    if (input.round === 1) return this.start(input.players).pairings;

    throw new Error(
      'Swiss cannot pair a later round from results alone: the library randomises its ' +
        'bracket, so recomputing it invents a DIFFERENT tournament from the one that was ' +
        'played. Use start() / advance() and persist the state. See src/lib/tournaments/swiss.ts.',
    );
  }

  standings(input: { players: TournamentPlayer[]; results: ReportedResult[] }): Standing[] {
    // Our own standings, deliberately. The library computes its own, but the
    // moment the UI displays ITS numbers we are coupled to its internals — and
    // the tiebreak rules are a product decision, not a library's.
    return computeStandings(input.players, input.results);
  }
}
