import type { PrismaClient } from '@prisma/client';

import { sanitizePlainText } from '@/lib/security/sanitize';

/**
 * Open-play sessions.
 *
 * ─── Capacity is the same problem as double-booking, one level up ────
 *
 * The obvious join:
 *
 *     const s = await db.openPlaySession.findUnique(...);
 *     if (s.currentCount >= s.maxParticipants) throw new SessionFullError();
 *     await db.sessionParticipant.create(...);
 *     await db.openPlaySession.update({ currentCount: { increment: 1 } });
 *
 * Four players tap "Join" on the last slot at once. All four read
 * `currentCount = 3`, all four pass the check, all four insert. A 4-a-side
 * game now has 7 people and two of them drove across Sofia for nothing.
 *
 * The fix is the same in spirit as the booking EXCLUDE constraint: make the
 * DATABASE arbitrate. A single conditional UPDATE
 *
 *     UPDATE ... SET currentCount = currentCount + 1
 *     WHERE id = $1 AND currentCount < maxParticipants
 *
 * is atomic. It either increments or matches zero rows, and Postgres
 * serialises the writers. No read-then-write window exists to race in.
 */

export class SessionFullError extends Error {
  readonly code = 'session_full';
  constructor() {
    super('This session is already full.');
    this.name = 'SessionFullError';
  }
}

export class AlreadyJoinedError extends Error {
  readonly code = 'already_joined';
  constructor() {
    super('You have already joined this session.');
    this.name = 'AlreadyJoinedError';
  }
}

export async function joinSession(
  db: PrismaClient,
  input: { sessionId: string; userId: string },
): Promise<{ joined: true; currentCount: number }> {
  // ATOMIC claim of a seat. The WHERE clause is the capacity check, so the
  // check and the increment cannot be separated by another transaction.
  const claimed = await db.openPlaySession.updateMany({
    where: {
      id: input.sessionId,
      currentCount: { lt: db.openPlaySession.fields.maxParticipants },
    },
    data: { currentCount: { increment: 1 } },
  });

  if (claimed.count === 0) {
    throw new SessionFullError();
  }

  // `createMany({ skipDuplicates: true })`, NOT `create()`.
  //
  // The composite PK (sessionId, userId) rejects a double-join either way —
  // but `create()` does it by RAISING, and a constraint violation ABORTS the
  // surrounding Postgres transaction. Every command after it fails with
  // "current transaction is aborted", so the seat-rollback below could never
  // run: a user double-tapping "Join" would silently consume two places and
  // lock a real player out of the game.
  //
  // `skipDuplicates` reports the conflict as a COUNT OF ZERO instead of
  // throwing, which leaves the transaction healthy and the rollback possible.
  // (This is the same trap that bit createBooking's idempotency handling —
  // see docs/implementation-notes/p09-booking.md.)
  const inserted = await db.sessionParticipant.createMany({
    data: [{ sessionId: input.sessionId, userId: input.userId }],
    skipDuplicates: true,
  });

  if (inserted.count === 0) {
    // Already a participant. Give the seat back.
    await db.openPlaySession.update({
      where: { id: input.sessionId },
      data: { currentCount: { decrement: 1 } },
    });
    throw new AlreadyJoinedError();
  }

  const after = await db.openPlaySession.findUniqueOrThrow({
    where: { id: input.sessionId },
    select: { currentCount: true },
  });

  return { joined: true, currentCount: after.currentCount };
}

export async function leaveSession(
  db: PrismaClient,
  input: { sessionId: string; userId: string },
): Promise<void> {
  const removed = await db.sessionParticipant.deleteMany({
    where: { sessionId: input.sessionId, userId: input.userId },
  });

  // Only give the seat back if a row was ACTUALLY removed. Decrementing
  // unconditionally lets someone spam "leave" and drive currentCount
  // negative, which then lets the session over-fill.
  if (removed.count > 0) {
    await db.openPlaySession.update({
      where: { id: input.sessionId },
      data: { currentCount: { decrement: 1 } },
    });
  }
}

/**
 * Post a chat message.
 *
 * The body is sanitised on the WAY IN. Chat is the highest-risk surface in
 * the product: text one user writes and another user's browser renders.
 * Sanitising only on render means every future renderer has to remember —
 * and one that forgets is a stored XSS.
 */
export async function postChatMessage(
  db: PrismaClient,
  input: { tenantId: string; sessionId: string; senderUserId: string; body: string },
): Promise<{ id: string; body: string }> {
  const clean = sanitizePlainText(input.body);

  if (clean.trim().length === 0) {
    throw new Error('Message body is empty after sanitisation.');
  }

  const msg = await db.sessionChatMessage.create({
    data: {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      senderUserId: input.senderUserId,
      body: clean,
    },
  });

  return { id: msg.id, body: msg.body };
}
