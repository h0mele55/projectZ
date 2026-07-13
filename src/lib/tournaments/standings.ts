import {
  POINTS_DRAW,
  POINTS_LOSS,
  POINTS_WIN,
  type ReportedResult,
  type Standing,
  type TournamentPlayer,
} from './format';

/**
 * Scoring and standings — shared by every format.
 *
 * In its own module so that `swiss.ts` can use it without importing `formats.ts`,
 * which imports `swiss.ts`. A cycle between those two compiles, and then fails at
 * RUNTIME with an undefined class, in a way that is thoroughly confusing to
 * debug.
 */

// ══ Scoring, shared ══════════════════════════════════════════════════

function pointsFor(homeScore: number, awayScore: number): { home: number; away: number } {
  if (homeScore > awayScore) return { home: POINTS_WIN, away: POINTS_LOSS };
  if (awayScore > homeScore) return { home: POINTS_LOSS, away: POINTS_WIN };
  return { home: POINTS_DRAW, away: POINTS_DRAW };
}

/**
 * Standings, with a Buchholz tiebreak.
 *
 * Buchholz is the sum of your OPPONENTS' scores: it asks "how hard was your
 * road?". Two players on 4 points are not equal if one of them beat the field's
 * top four and the other beat the bottom four — and without a tiebreak, the
 * ranking between them is decided by array order, which is to say by nothing.
 */
export function computeStandings(
  players: TournamentPlayer[],
  results: ReportedResult[],
): Standing[] {
  const score = new Map<string, { wins: number; losses: number; draws: number; points: number }>();
  const opponents = new Map<string, string[]>();

  for (const p of players) {
    score.set(p.id, { wins: 0, losses: 0, draws: 0, points: 0 });
    opponents.set(p.id, []);
  }

  for (const r of results) {
    const home = score.get(r.home);
    const away = score.get(r.away);
    if (!home || !away) continue; // a result naming somebody not in the field

    const pts = pointsFor(r.homeScore, r.awayScore);

    home.points += pts.home;
    away.points += pts.away;

    if (pts.home === POINTS_WIN) {
      home.wins++;
      away.losses++;
    } else if (pts.away === POINTS_WIN) {
      away.wins++;
      home.losses++;
    } else {
      home.draws++;
      away.draws++;
    }

    opponents.get(r.home)!.push(r.away);
    opponents.get(r.away)!.push(r.home);
  }

  const rows = players.map((p) => {
    const s = score.get(p.id)!;
    const tiebreak = opponents
      .get(p.id)!
      .reduce((sum, oppId) => sum + (score.get(oppId)?.points ?? 0), 0);

    return { playerId: p.id, ...s, tiebreak, rank: 0 };
  });

  rows.sort(
    (a, b) =>
      b.points - a.points || b.tiebreak - a.tiebreak || a.playerId.localeCompare(b.playerId),
  );

  // Equal score AND equal tiebreak → equal rank. Handing one of them a better
  // number because their id sorts earlier is a fiction, and the player it costs
  // will notice.
  let rank = 0;
  let lastKey = '';
  rows.forEach((row, i) => {
    const key = `${row.points}:${row.tiebreak}`;
    if (key !== lastKey) {
      rank = i + 1;
      lastKey = key;
    }
    row.rank = rank;
  });

  return rows;
}
