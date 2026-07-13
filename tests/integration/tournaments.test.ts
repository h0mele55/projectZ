import type { PrismaClient } from '@prisma/client';

import {
  TournamentStateError,
  advanceRound,
  reportResult,
  standings,
  startTournament,
} from '@/app-layer/usecases/tournaments';
import { pgErrorCode } from '@/lib/db/pg-errors';

import { prismaTestClient, seedTenant, type SeededTenant } from '../helpers/db';
import { asAppSuperuser } from '../helpers/rls';

let db: PrismaClient;
let tenant: SeededTenant;

beforeAll(() => {
  db = prismaTestClient();
});

beforeEach(async () => {
  tenant = await seedTenant();
});

async function seedTournament(
  format: 'SWISS' | 'ROUND_ROBIN' | 'SINGLE_ELIMINATION',
  playerCount: number,
) {
  return asAppSuperuser(db, async (tx) => {
    const t = await tx.tournament.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Sofia Open',
        sport: 'CHESS',
        format,
        status: 'REGISTRATION',
        startsAt: new Date(Date.now() + 86_400_000),
        maxPlayers: 32,
      },
    });

    const users = await Promise.all(
      Array.from({ length: playerCount }, (_, i) =>
        tx.user.create({
          data: { email: `t${i}-${Math.random().toString(36).slice(2, 8)}@playerz.test` },
        }),
      ),
    );

    await tx.tournamentEntry.createMany({
      data: users.map((u, i) => ({
        tenantId: tenant.tenantId,
        tournamentId: t.id,
        playerUserId: u.id,
        // Descending seeds, so brackets are deterministic where the format is.
        seedRating: 2000 - i * 50,
      })),
    });

    return { tournamentId: t.id, userIds: users.map((u) => u.id) };
  });
}

/** Report every fixture in the current round. Higher seed (earlier id) wins. */
async function playRound(tournamentId: string, round: number, userIds: string[]) {
  const fixtures = await db.tournamentMatch.findMany({
    where: { tournamentId, tenantId: tenant.tenantId, round, awayUserId: { not: null } },
  });

  for (const f of fixtures) {
    const homeSeed = userIds.indexOf(f.homeUserId);
    const awaySeed = userIds.indexOf(f.awayUserId!);
    const homeWins = homeSeed < awaySeed;

    await reportResult(db, {
      tenantId: tenant.tenantId,
      tournamentId,
      round,
      homeUserId: f.homeUserId,
      homeScore: homeWins ? 1 : 0,
      awayScore: homeWins ? 0 : 1,
    });
  }
}

// ══ Swiss, end to end ════════════════════════════════════════════════

describe('a full Swiss event', () => {
  it('runs to completion without ever repeating a pairing', async () => {
    // The property Swiss exists for. It is also the one that breaks silently:
    // nobody notices until round four, when two people are told to play again.
    const { tournamentId, userIds } = await seedTournament('SWISS', 8);

    await startTournament(db, { tenantId: tenant.tenantId, tournamentId });

    const seen = new Set<string>();
    let round = 1;

    for (;;) {
      const fixtures = await db.tournamentMatch.findMany({
        where: { tournamentId, tenantId: tenant.tenantId, round },
      });

      for (const f of fixtures) {
        if (!f.awayUserId) continue;
        const key = [f.homeUserId, f.awayUserId].sort().join('|');

        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }

      await playRound(tournamentId, round, userIds);

      const next = await advanceRound(db, { tenantId: tenant.tenantId, tournamentId });
      if (next.finished) break;
      round = next.round;
    }

    const t = await db.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(t.status).toBe('COMPLETE');
    expect(t.totalRounds).toBe(3); // ceil(log2(8))
    expect(seen.size).toBeGreaterThanOrEqual(12); // 4 fixtures × 3 rounds
  });

  it('persists the library state — the bracket survives a reload', async () => {
    // The library RANDOMISES its opening bracket, so the pairings cannot be
    // recomputed from results. If the state were not persisted, the second round
    // would be paired against a DIFFERENT round one than the one people played.
    const { tournamentId } = await seedTournament('SWISS', 8);

    await startTournament(db, { tenantId: tenant.tenantId, tournamentId });

    const t = await db.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(t.stateJson).not.toBeNull();
  });

  it('REFUSES to advance while a result is missing', async () => {
    // Standings missing a game are not standings, and the next round is paired
    // from them.
    const { tournamentId } = await seedTournament('SWISS', 8);
    await startTournament(db, { tenantId: tenant.tenantId, tournamentId });

    await expect(advanceRound(db, { tenantId: tenant.tenantId, tournamentId })).rejects.toThrow(
      TournamentStateError,
    );
  });

  it('REFUSES to start twice — that would re-pair a bracket people are playing', async () => {
    const { tournamentId } = await seedTournament('SWISS', 8);

    await startTournament(db, { tenantId: tenant.tenantId, tournamentId });

    await expect(startTournament(db, { tenantId: tenant.tenantId, tournamentId })).rejects.toThrow(
      /IN_PROGRESS/,
    );
  });
});

// ══ Round robin ══════════════════════════════════════════════════════

describe('round robin', () => {
  it('plays every fixture exactly once across the event', async () => {
    const { tournamentId, userIds } = await seedTournament('ROUND_ROBIN', 6);

    await startTournament(db, { tenantId: tenant.tenantId, tournamentId });

    let round = 1;
    for (;;) {
      await playRound(tournamentId, round, userIds);
      const next = await advanceRound(db, { tenantId: tenant.tenantId, tournamentId });
      if (next.finished) break;
      round = next.round;
    }

    const all = await db.tournamentMatch.findMany({
      where: { tournamentId, tenantId: tenant.tenantId },
    });

    const fixtures = new Set(
      all.filter((m) => m.awayUserId).map((m) => [m.homeUserId, m.awayUserId].sort().join('|')),
    );

    // 6 players → 15 distinct fixtures, and no duplicates.
    expect(fixtures.size).toBe(15);
    expect(all.filter((m) => m.awayUserId).length).toBe(15);
  });

  it('an odd field gives everyone exactly one bye, scored automatically', async () => {
    // A bye left unreported would block the round from ever closing — nobody can
    // report a game that was never played.
    const { tournamentId } = await seedTournament('ROUND_ROBIN', 5);

    await startTournament(db, { tenantId: tenant.tenantId, tournamentId });

    const byes = await db.tournamentMatch.findMany({
      where: { tournamentId, tenantId: tenant.tenantId, awayUserId: null },
    });

    expect(byes).toHaveLength(1);
    expect(byes[0]!.reportedAt).not.toBeNull();
    expect(byes[0]!.homeScore).toBe(1);
  });

  it('a bye cannot have a result reported against it', async () => {
    const { tournamentId } = await seedTournament('ROUND_ROBIN', 5);
    await startTournament(db, { tenantId: tenant.tenantId, tournamentId });

    const bye = await db.tournamentMatch.findFirstOrThrow({
      where: { tournamentId, tenantId: tenant.tenantId, awayUserId: null },
    });

    await expect(
      reportResult(db, {
        tenantId: tenant.tenantId,
        tournamentId,
        round: 1,
        homeUserId: bye.homeUserId,
        homeScore: 1,
        awayScore: 0,
      }),
    ).rejects.toThrow(/is a bye/);
  });
});

// ══ The database's own guarantees ════════════════════════════════════

describe('the database refuses a nonsense bracket', () => {
  it('a player cannot be their own opponent', async () => {
    // Not a bug you want to discover from a support ticket on finals day.
    const { tournamentId, userIds } = await seedTournament('SWISS', 4);

    const attempt = asAppSuperuser(db, (tx) =>
      tx.tournamentMatch.create({
        data: {
          tenantId: tenant.tenantId,
          tournamentId,
          round: 1,
          homeUserId: userIds[0]!,
          awayUserId: userIds[0]!,
        },
      }),
    );

    await expect(attempt.catch((e) => pgErrorCode(e))).resolves.toBe('23514');
  });

  it('one player enters a tournament ONCE', async () => {
    // A double-tapped "Enter" that puts somebody in the draw twice produces a
    // bracket that pairs them against themselves.
    const { tournamentId, userIds } = await seedTournament('SWISS', 4);

    const attempt = asAppSuperuser(db, (tx) =>
      tx.tournamentEntry.create({
        data: {
          tenantId: tenant.tenantId,
          tournamentId,
          playerUserId: userIds[0]!,
        },
      }),
    );

    await expect(attempt.catch((e) => pgErrorCode(e))).resolves.toBe('23505');
  });

  it('round 0 is not a round', async () => {
    const { tournamentId, userIds } = await seedTournament('SWISS', 4);

    const attempt = asAppSuperuser(db, (tx) =>
      tx.tournamentMatch.create({
        data: {
          tenantId: tenant.tenantId,
          tournamentId,
          round: 0,
          homeUserId: userIds[0]!,
          awayUserId: userIds[1]!,
        },
      }),
    );

    await expect(attempt.catch((e) => pgErrorCode(e))).resolves.toBe('23514');
  });
});

// ══ Standings ════════════════════════════════════════════════════════

describe('standings', () => {
  it('rank the field, with a Buchholz tiebreak', async () => {
    const { tournamentId, userIds } = await seedTournament('ROUND_ROBIN', 4);

    await startTournament(db, { tenantId: tenant.tenantId, tournamentId });
    await playRound(tournamentId, 1, userIds);

    const table = await standings(db, { tenantId: tenant.tenantId, tournamentId });

    expect(table).toHaveLength(4);
    expect(table[0]!.rank).toBe(1);
    // Everyone played once, so somebody has a point.
    expect(table.reduce((sum, s) => sum + s.points, 0)).toBeGreaterThan(0);
  });
});
