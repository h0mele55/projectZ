import { Prisma, type PrismaClient, type TournamentFormatKind } from '@prisma/client';

import { type Pairing, type ReportedResult, type Standing } from '@/lib/tournaments/format';
import { formatFor } from '@/lib/tournaments/formats';
import { Swiss } from '@/lib/tournaments/swiss';

/**
 * Running a tournament.
 *
 * The formats live behind `TournamentFormat` (see src/lib/tournaments/format.ts).
 * This file knows about the DATABASE; it does not know how a Swiss round is
 * paired, and it must not learn.
 */

export class TournamentStateError extends Error {
  readonly code = 'tournament_state';
  constructor(message: string) {
    super(message);
    this.name = 'TournamentStateError';
  }
}

/**
 * Start the event: freeze the field, pair round one, write the fixtures.
 *
 * ─── Why the seed is FROZEN at entry ─────────────────────────────────
 *
 * `TournamentEntry.seedRating` is copied from the player's live rating when they
 * enter, and never updated. If the bracket read the live rating instead, a
 * player who won a league game on Tuesday would re-seed a tournament that is
 * already halfway played — and the bracket would silently disagree with the one
 * printed on the wall.
 */
export async function startTournament(
  db: PrismaClient,
  input: { tenantId: string; tournamentId: string },
): Promise<{ round: number; pairings: Pairing[] }> {
  const tournament = await db.tournament.findFirstOrThrow({
    where: { id: input.tournamentId, tenantId: input.tenantId },
  });

  if (tournament.status !== 'REGISTRATION') {
    throw new TournamentStateError(
      `Cannot start a tournament that is ${tournament.status}. Only a tournament in ` +
        `REGISTRATION can begin — starting one twice would re-pair a bracket people are ` +
        `already playing.`,
    );
  }

  const entries = await db.tournamentEntry.findMany({
    where: { tournamentId: tournament.id, tenantId: input.tenantId, withdrawnAt: null },
    orderBy: { createdAt: 'asc' },
    take: 512,
  });

  if (entries.length < 2) {
    throw new TournamentStateError(
      `A tournament needs at least two players; ${entries.length} entered.`,
    );
  }

  const players = entries.map((e) => ({ id: e.playerUserId, rating: e.seedRating ?? undefined }));

  const format = formatFor(tournament.format as TournamentFormatKind);

  let pairings: Pairing[];
  let stateJson: Prisma.InputJsonValue | undefined;

  if (format.kind === 'SWISS') {
    // Swiss keeps the library's own state — it randomises the opening bracket,
    // so the pairings cannot be recomputed later. See src/lib/tournaments/swiss.ts.
    const started = (format as Swiss).start(players);
    pairings = started.pairings;
    stateJson = started.state as Prisma.InputJsonValue;
  } else {
    pairings = format.pair({ players, round: 1, results: [] });
  }

  await db.$transaction(async (tx) => {
    await tx.tournament.update({
      where: { id: tournament.id },
      data: {
        status: 'IN_PROGRESS',
        currentRound: 1,
        totalRounds: format.roundsFor(players.length),
        ...(stateJson !== undefined ? { stateJson } : {}),
      },
    });

    await writeFixtures(tx, input.tenantId, tournament.id, pairings);
  });

  return { round: 1, pairings };
}

/**
 * Report a result.
 *
 * Idempotent on the FIXTURE. The unique on (tournamentId, round, homeUserId)
 * means a redelivered report updates the one fixture rather than creating a
 * second copy of the same game with a different score.
 */
export async function reportResult(
  db: PrismaClient,
  input: {
    tenantId: string;
    tournamentId: string;
    round: number;
    homeUserId: string;
    homeScore: number;
    awayScore: number;
  },
): Promise<void> {
  const match = await db.tournamentMatch.findFirstOrThrow({
    where: {
      tournamentId: input.tournamentId,
      tenantId: input.tenantId,
      round: input.round,
      homeUserId: input.homeUserId,
    },
  });

  if (!match.awayUserId) {
    throw new TournamentStateError(
      'That fixture is a bye — there is no result to report. A bye is scored automatically.',
    );
  }

  await db.tournamentMatch.update({
    where: { id: match.id },
    data: {
      homeScore: input.homeScore,
      awayScore: input.awayScore,
      reportedAt: new Date(),
    },
  });
}

/**
 * Close the current round and pair the next.
 *
 * Refuses while any fixture is unreported. Pairing on incomplete standings
 * produces a bracket that is simply wrong, and in a Swiss event the error
 * compounds through every subsequent round.
 */
export async function advanceRound(
  db: PrismaClient,
  input: { tenantId: string; tournamentId: string },
): Promise<{ round: number; pairings: Pairing[]; finished: boolean }> {
  const tournament = await db.tournament.findFirstOrThrow({
    where: { id: input.tournamentId, tenantId: input.tenantId },
  });

  if (tournament.status !== 'IN_PROGRESS') {
    throw new TournamentStateError(`Cannot advance a tournament that is ${tournament.status}.`);
  }

  const round = tournament.currentRound;

  const fixtures = await db.tournamentMatch.findMany({
    where: { tournamentId: tournament.id, tenantId: input.tenantId, round },
    take: 512,
  });

  const unreported = fixtures.filter((m) => m.awayUserId !== null && m.reportedAt === null);
  if (unreported.length > 0) {
    throw new TournamentStateError(
      `Round ${round} has ${unreported.length} unreported result(s). Standings that are ` +
        `missing a game are not standings, and the next round is paired from them.`,
    );
  }

  const results = await resultsSoFar(db, input.tenantId, tournament.id);
  const players = await playersOf(db, input.tenantId, tournament.id);

  const format = formatFor(tournament.format as TournamentFormatKind);

  let pairings: Pairing[];
  let finished: boolean;
  let stateJson: Prisma.InputJsonValue | undefined;

  if (format.kind === 'SWISS') {
    const next = (format as Swiss).advance({
      state: tournament.stateJson,
      round,
      results,
    });
    pairings = next.pairings;
    finished = next.finished;
    stateJson = next.state as Prisma.InputJsonValue;
  } else {
    finished = round >= tournament.totalRounds;
    pairings = finished ? [] : format.pair({ players, round: round + 1, results });
  }

  await db.$transaction(async (tx) => {
    await tx.tournament.update({
      where: { id: tournament.id },
      data: {
        status: finished ? 'COMPLETE' : 'IN_PROGRESS',
        currentRound: finished ? round : round + 1,
        ...(stateJson !== undefined ? { stateJson } : {}),
      },
    });

    if (!finished) {
      await writeFixtures(tx, input.tenantId, tournament.id, pairings);
    }
  });

  return { round: finished ? round : round + 1, pairings, finished };
}

export async function standings(
  db: PrismaClient,
  input: { tenantId: string; tournamentId: string },
): Promise<Standing[]> {
  const tournament = await db.tournament.findFirstOrThrow({
    where: { id: input.tournamentId, tenantId: input.tenantId },
  });

  const [players, results] = await Promise.all([
    playersOf(db, input.tenantId, tournament.id),
    resultsSoFar(db, input.tenantId, tournament.id),
  ]);

  return formatFor(tournament.format as TournamentFormatKind).standings({ players, results });
}

// ── helpers ──────────────────────────────────────────────────────────

async function writeFixtures(
  tx: Prisma.TransactionClient,
  tenantId: string,
  tournamentId: string,
  pairings: Pairing[],
): Promise<void> {
  if (pairings.length === 0) return;

  await tx.tournamentMatch.createMany({
    data: pairings.map((p) => ({
      tenantId,
      tournamentId,
      round: p.round,
      homeUserId: p.home,
      awayUserId: p.away,
      // A bye is scored the moment it is created. Leaving it unreported would
      // block the round from ever closing, because nobody can report a game
      // that was never played.
      ...(p.away === null ? { homeScore: 1, awayScore: 0, reportedAt: new Date() } : {}),
    })),
    // A re-run of a round's pairing must not duplicate its fixtures.
    skipDuplicates: true,
  });
}

async function playersOf(db: PrismaClient, tenantId: string, tournamentId: string) {
  const entries = await db.tournamentEntry.findMany({
    where: { tournamentId, tenantId, withdrawnAt: null },
    orderBy: { createdAt: 'asc' },
    take: 512,
  });

  return entries.map((e) => ({ id: e.playerUserId, rating: e.seedRating ?? undefined }));
}

async function resultsSoFar(
  db: PrismaClient,
  tenantId: string,
  tournamentId: string,
): Promise<ReportedResult[]> {
  const matches = await db.tournamentMatch.findMany({
    where: { tournamentId, tenantId, reportedAt: { not: null }, awayUserId: { not: null } },
    orderBy: { round: 'asc' },
    take: 2048,
  });

  return matches.map((m) => ({
    round: m.round,
    home: m.homeUserId,
    away: m.awayUserId!,
    homeScore: m.homeScore ?? 0,
    awayScore: m.awayScore ?? 0,
  }));
}
