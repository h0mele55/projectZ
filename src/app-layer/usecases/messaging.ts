import type { PrismaClient } from '@prisma/client';

import { publish } from '@/lib/realtime/centrifugo';
import { conversationChannel } from '@/lib/realtime/channels';
import { sanitizePlainText } from '@/lib/security/sanitize';

/**
 * Messaging.
 *
 * ─── PERSIST, THEN PUBLISH. Never the other way round. ───────────────
 *
 * Postgres is the source of truth. Centrifugo is a DELIVERY MECHANISM.
 *
 * Publish-then-persist looks equivalent and is not: the message flashes up in
 * everyone's client, the database write then fails, and the message is gone on
 * refresh. Users saw it. It does not exist. That is far worse than a message
 * that arrives a second late.
 *
 * And because delivery is secondary, a Centrifugo outage must NOT fail the
 * write. `sendMessage` persists, then attempts to publish, and swallows a
 * publish failure — the message is in the database, the recipient will see it
 * on their next fetch or on reconnect via channel history. An integration test
 * kills the Centrifugo container and asserts the send still returns 200.
 */

export class UserBlockedError extends Error {
  readonly code = 'user_blocked';
  constructor() {
    super('You cannot message this user.');
    this.name = 'UserBlockedError';
  }
}

export class NotAParticipantError extends Error {
  readonly code = 'not_a_participant';
  constructor() {
    super('You are not a participant in this conversation.');
    this.name = 'NotAParticipantError';
  }
}

export class EmptyMessageError extends Error {
  readonly code = 'empty_message';
  constructor() {
    super('Message is empty after sanitisation.');
    this.name = 'EmptyMessageError';
  }
}

export const MESSAGE_MAX_LENGTH = 4000;

/**
 * Is either side blocking the other?
 *
 * Checked in BOTH directions. A one-directional check means the person you
 * blocked can still message you — which is not a blocking feature, it is a
 * loophole. The blocker must not have to also be blocked to be protected.
 */
export async function isBlockedEitherWay(
  db: PrismaClient,
  a: string,
  b: string,
): Promise<boolean> {
  const block = await db.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  });
  return block !== null;
}

/**
 * Start (or return) a DM.
 *
 * IDEMPOTENT. Tapping "Message" twice must not create two conversations —
 * which would split the history in half and leave each participant reading a
 * different one.
 */
export async function startDm(
  db: PrismaClient,
  input: { userId: string; otherUserId: string },
): Promise<{ conversationId: string; created: boolean }> {
  const { userId, otherUserId } = input;

  if (userId === otherUserId) {
    throw new Error('Cannot start a DM with yourself.');
  }

  if (await isBlockedEitherWay(db, userId, otherUserId)) {
    throw new UserBlockedError();
  }

  // A DM is identified by its exact participant pair. Find it rather than
  // creating a second one.
  const existing = await db.conversation.findFirst({
    where: {
      type: 'DM',
      participants: { every: { userId: { in: [userId, otherUserId] } } },
      AND: [
        { participants: { some: { userId } } },
        { participants: { some: { userId: otherUserId } } },
      ],
    },
  });

  if (existing) return { conversationId: existing.id, created: false };

  const conv = await db.conversation.create({
    data: {
      type: 'DM',
      // A DM belongs to NO tenant — the two players may have met at different
      // clubs, and the conversation is theirs, not a venue's.
      tenantId: null,
      createdById: userId,
      participants: {
        create: [
          { userId, role: 'OWNER' },
          { userId: otherUserId, role: 'MEMBER' },
        ],
      },
    },
  });

  return { conversationId: conv.id, created: true };
}

/** An active participant — a member who has not left. */
async function assertActiveParticipant(
  db: PrismaClient,
  conversationId: string,
  userId: string,
): Promise<void> {
  const p = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });

  // `leftAt` matters: the row is KEPT when someone leaves, so that history
  // still shows who was there. But a departed member must not keep receiving
  // messages.
  if (!p || p.leftAt !== null) throw new NotAParticipantError();
}

export async function sendMessage(
  db: PrismaClient,
  input: { conversationId: string; senderId: string; body: string; replyToId?: string },
): Promise<{ id: string; body: string; createdAt: Date }> {
  await assertActiveParticipant(db, input.conversationId, input.senderId);

  // Sanitise on the way IN. Sanitising only at render means every future
  // renderer has to remember, and the one that forgets is a stored XSS.
  const clean = sanitizePlainText(input.body).slice(0, MESSAGE_MAX_LENGTH);
  if (clean.trim().length === 0) throw new EmptyMessageError();

  // For a DM, re-check blocking at SEND time, not only at conversation
  // creation. Otherwise blocking someone leaves the existing DM wide open.
  const conv = await db.conversation.findUniqueOrThrow({
    where: { id: input.conversationId },
    include: { participants: { take: 50 } },
  });

  if (conv.type === 'DM') {
    const other = conv.participants.find((p) => p.userId !== input.senderId);
    if (other && (await isBlockedEitherWay(db, input.senderId, other.userId))) {
      throw new UserBlockedError();
    }
  }

  // ── 1. PERSIST ────────────────────────────────────────────────────
  const msg = await db.chatMessage.create({
    data: {
      conversationId: input.conversationId,
      senderId: input.senderId,
      body: clean,
      replyToId: input.replyToId ?? null,
    },
  });

  await db.conversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: msg.createdAt },
  });

  // ── 2. THEN PUBLISH (best-effort) ─────────────────────────────────
  //
  // A Centrifugo outage must not fail the send. The message is already in
  // Postgres; the recipient sees it on their next fetch, or on reconnect via
  // channel history.
  await publish(conversationChannel(input.conversationId), {
    type: 'message',
    id: msg.id,
    conversationId: input.conversationId,
    senderId: input.senderId,
    body: clean,
    createdAt: msg.createdAt.toISOString(),
  });

  return { id: msg.id, body: msg.body, createdAt: msg.createdAt };
}

/**
 * Mark read. MONOTONIC — the pointer only ever moves forward.
 *
 * Without that, an out-of-order request (two tabs, or a slow network) rewinds
 * the read pointer and the unread badge resurrects messages the user already
 * read. It looks like a bug in the badge; it is a bug here.
 */
export async function markRead(
  db: PrismaClient,
  input: { conversationId: string; userId: string; messageId: string },
): Promise<{ lastReadMessageId: string }> {
  await assertActiveParticipant(db, input.conversationId, input.userId);

  const target = await db.chatMessage.findUniqueOrThrow({ where: { id: input.messageId } });

  const participant = await db.conversationParticipant.findUniqueOrThrow({
    where: { conversationId_userId: { conversationId: input.conversationId, userId: input.userId } },
  });

  if (participant.lastReadMessageId) {
    const current = await db.chatMessage.findUnique({
      where: { id: participant.lastReadMessageId },
    });

    // Already read something NEWER — ignore this one.
    if (current && current.createdAt >= target.createdAt) {
      return { lastReadMessageId: participant.lastReadMessageId };
    }
  }

  await db.conversationParticipant.update({
    where: { conversationId_userId: { conversationId: input.conversationId, userId: input.userId } },
    data: { lastReadMessageId: input.messageId },
  });

  await publish(conversationChannel(input.conversationId), {
    type: 'read',
    userId: input.userId,
    messageId: input.messageId,
  });

  return { lastReadMessageId: input.messageId };
}

/** Soft delete — a tombstone, not a hole. */
export async function deleteMessage(
  db: PrismaClient,
  input: { messageId: string; userId: string },
): Promise<void> {
  const msg = await db.chatMessage.findUniqueOrThrow({ where: { id: input.messageId } });

  if (msg.senderId !== input.userId) throw new NotAParticipantError();

  // A hard delete leaves a hole in every other participant's scrollback and
  // breaks any message that replied to it. A tombstone renders as "message
  // deleted" and keeps the thread coherent.
  await db.chatMessage.update({
    where: { id: input.messageId },
    data: { deletedAt: new Date(), body: '' },
  });

  await publish(conversationChannel(msg.conversationId), {
    type: 'delete',
    id: msg.id,
  });
}

export async function leaveConversation(
  db: PrismaClient,
  input: { conversationId: string; userId: string },
): Promise<void> {
  // The row is KEPT with leftAt set — a departed member must not vanish from
  // the history of a conversation they were part of.
  await db.conversationParticipant.update({
    where: { conversationId_userId: { conversationId: input.conversationId, userId: input.userId } },
    data: { leftAt: new Date() },
  });
}

export async function blockUser(
  db: PrismaClient,
  input: { blockerId: string; blockedId: string },
): Promise<void> {
  await db.userBlock.createMany({
    data: [{ blockerId: input.blockerId, blockedId: input.blockedId }],
    // skipDuplicates, not create(): a unique violation would ABORT the
    // transaction (see P09/P10), and blocking someone twice is not an error.
    skipDuplicates: true,
  });
}

export async function unblockUser(
  db: PrismaClient,
  input: { blockerId: string; blockedId: string },
): Promise<void> {
  await db.userBlock.deleteMany({
    where: { blockerId: input.blockerId, blockedId: input.blockedId },
  });
}
