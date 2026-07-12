import {
  EmptyMessageError,
  NotAParticipantError,
  UserBlockedError,
  blockUser,
  deleteMessage,
  leaveConversation,
  markRead,
  sendMessage,
  startDm,
  unblockUser,
} from '@/app-layer/usecases/messaging';

import { prismaTestClient, seedTenant } from '../helpers/db';
import { asAppSuperuser } from '../helpers/rls';

describe('messaging', () => {
  const prisma = prismaTestClient();

  async function user(tag: string) {
    return asAppSuperuser(prisma, (tx) =>
      tx.user.create({ data: { email: `${tag}-${Math.random()}@playerz.test` } }),
    );
  }

  it('startDm is IDEMPOTENT — tapping "Message" twice does not split the history', async () => {
    const a = await user('a');
    const b = await user('b');

    const first = await asAppSuperuser(prisma, (tx) =>
      startDm(tx, { userId: a.id, otherUserId: b.id }),
    );
    const second = await asAppSuperuser(prisma, (tx) =>
      startDm(tx, { userId: a.id, otherUserId: b.id }),
    );

    // Two conversations would split the thread in half and leave each side
    // reading a different one.
    expect(second.conversationId).toBe(first.conversationId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it('a DM belongs to NO tenant — the players may have met at different clubs', async () => {
    const a = await user('a');
    const b = await user('b');

    const { conversationId } = await asAppSuperuser(prisma, (tx) =>
      startDm(tx, { userId: a.id, otherUserId: b.id }),
    );

    const conv = await asAppSuperuser(prisma, (tx) =>
      tx.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
    );
    expect(conv.tenantId).toBeNull();
  });

  it('BLOCKING works in BOTH directions', async () => {
    const a = await user('a');
    const b = await user('b');

    // A blocks B. B must not be able to message A either — a one-directional
    // check means the person you blocked can still reach you, which is not a
    // blocking feature but a loophole.
    await asAppSuperuser(prisma, (tx) => blockUser(tx, { blockerId: a.id, blockedId: b.id }));

    await expect(
      asAppSuperuser(prisma, (tx) => startDm(tx, { userId: a.id, otherUserId: b.id })),
    ).rejects.toBeInstanceOf(UserBlockedError);

    await expect(
      asAppSuperuser(prisma, (tx) => startDm(tx, { userId: b.id, otherUserId: a.id })),
    ).rejects.toBeInstanceOf(UserBlockedError);
  });

  it('blocking closes an EXISTING DM, not just new ones', async () => {
    const a = await user('a');
    const b = await user('b');

    const { conversationId } = await asAppSuperuser(prisma, (tx) =>
      startDm(tx, { userId: a.id, otherUserId: b.id }),
    );
    await asAppSuperuser(prisma, (tx) =>
      sendMessage(tx, { conversationId, senderId: a.id, body: 'hi' }),
    );

    await asAppSuperuser(prisma, (tx) => blockUser(tx, { blockerId: a.id, blockedId: b.id }));

    // Checked at SEND time, not only at conversation creation — otherwise
    // blocking leaves the existing DM wide open, which is the case that
    // actually matters.
    await expect(
      asAppSuperuser(prisma, (tx) =>
        sendMessage(tx, { conversationId, senderId: b.id, body: 'still here' }),
      ),
    ).rejects.toBeInstanceOf(UserBlockedError);

    await asAppSuperuser(prisma, (tx) => unblockUser(tx, { blockerId: a.id, blockedId: b.id }));

    const ok = await asAppSuperuser(prisma, (tx) =>
      sendMessage(tx, { conversationId, senderId: b.id, body: 'back' }),
    );
    expect(ok.body).toBe('back');
  });

  it('a message is SANITISED on the way in', async () => {
    const a = await user('a');
    const b = await user('b');
    const { conversationId } = await asAppSuperuser(prisma, (tx) =>
      startDm(tx, { userId: a.id, otherUserId: b.id }),
    );

    const msg = await asAppSuperuser(prisma, (tx) =>
      sendMessage(tx, {
        conversationId,
        senderId: a.id,
        body: '<script>alert(1)</script>See you at 7',
      }),
    );

    expect(msg.body).toBe('See you at 7');

    const stored = await asAppSuperuser(prisma, (tx) =>
      tx.chatMessage.findUniqueOrThrow({ where: { id: msg.id } }),
    );
    expect(stored.body).not.toContain('<script>');
  });

  it('an empty-after-sanitisation message is refused', async () => {
    const a = await user('a');
    const b = await user('b');
    const { conversationId } = await asAppSuperuser(prisma, (tx) =>
      startDm(tx, { userId: a.id, otherUserId: b.id }),
    );

    await expect(
      asAppSuperuser(prisma, (tx) =>
        sendMessage(tx, { conversationId, senderId: a.id, body: '<script></script>' }),
      ),
    ).rejects.toBeInstanceOf(EmptyMessageError);
  });

  it('a NON-participant cannot send, and a DEPARTED one cannot either', async () => {
    const a = await user('a');
    const b = await user('b');
    const outsider = await user('outsider');

    const { conversationId } = await asAppSuperuser(prisma, (tx) =>
      startDm(tx, { userId: a.id, otherUserId: b.id }),
    );

    await expect(
      asAppSuperuser(prisma, (tx) =>
        sendMessage(tx, { conversationId, senderId: outsider.id, body: 'hello?' }),
      ),
    ).rejects.toBeInstanceOf(NotAParticipantError);

    // A member who left keeps their row (so history still shows they were
    // there) but must stop receiving and sending.
    await asAppSuperuser(prisma, (tx) => leaveConversation(tx, { conversationId, userId: b.id }));

    await expect(
      asAppSuperuser(prisma, (tx) =>
        sendMessage(tx, { conversationId, senderId: b.id, body: 'sneaking back' }),
      ),
    ).rejects.toBeInstanceOf(NotAParticipantError);
  });

  it('markRead is MONOTONIC — it never rewinds', async () => {
    const a = await user('a');
    const b = await user('b');
    const { conversationId } = await asAppSuperuser(prisma, (tx) =>
      startDm(tx, { userId: a.id, otherUserId: b.id }),
    );

    const m1 = await asAppSuperuser(prisma, (tx) =>
      sendMessage(tx, { conversationId, senderId: a.id, body: 'one' }),
    );
    await new Promise((r) => setTimeout(r, 10));
    const m2 = await asAppSuperuser(prisma, (tx) =>
      sendMessage(tx, { conversationId, senderId: a.id, body: 'two' }),
    );

    await asAppSuperuser(prisma, (tx) =>
      markRead(tx, { conversationId, userId: b.id, messageId: m2.id }),
    );

    // An out-of-order request (two tabs, slow network) must NOT rewind the
    // pointer — the unread badge would resurrect messages already read, and it
    // would look like a bug in the badge.
    const back = await asAppSuperuser(prisma, (tx) =>
      markRead(tx, { conversationId, userId: b.id, messageId: m1.id }),
    );

    expect(back.lastReadMessageId).toBe(m2.id);
  });

  it('deleteMessage is a TOMBSTONE, not a hole', async () => {
    const a = await user('a');
    const b = await user('b');
    const { conversationId } = await asAppSuperuser(prisma, (tx) =>
      startDm(tx, { userId: a.id, otherUserId: b.id }),
    );

    const msg = await asAppSuperuser(prisma, (tx) =>
      sendMessage(tx, { conversationId, senderId: a.id, body: 'oops' }),
    );
    await asAppSuperuser(prisma, (tx) => deleteMessage(tx, { messageId: msg.id, userId: a.id }));

    const row = await asAppSuperuser(prisma, (tx) =>
      tx.chatMessage.findUniqueOrThrow({ where: { id: msg.id } }),
    );

    // A hard delete leaves a hole in everyone's scrollback and breaks any
    // reply to it. The row survives with a tombstone.
    expect(row.deletedAt).not.toBeNull();
    expect(row.body).toBe('');
  });

  it('only the SENDER can delete their message', async () => {
    const a = await user('a');
    const b = await user('b');
    const { conversationId } = await asAppSuperuser(prisma, (tx) =>
      startDm(tx, { userId: a.id, otherUserId: b.id }),
    );
    const msg = await asAppSuperuser(prisma, (tx) =>
      sendMessage(tx, { conversationId, senderId: a.id, body: 'mine' }),
    );

    await expect(
      asAppSuperuser(prisma, (tx) => deleteMessage(tx, { messageId: msg.id, userId: b.id })),
    ).rejects.toBeInstanceOf(NotAParticipantError);
  });

  it('PERSIST-THEN-PUBLISH: Centrifugo unreachable → the message still lands', async () => {
    // THE test for this prompt.
    //
    // Publish-then-persist looks equivalent and is not: the message flashes up
    // in every client, the DB write fails, and it is gone on refresh. Users saw
    // it. It does not exist.
    //
    // And a broker outage must not fail the write at all — that turns a
    // degraded-realtime incident into a total outage of chat.
    const saved = process.env.CENTRIFUGO_API_URL;
    process.env.CENTRIFUGO_API_URL = 'http://127.0.0.1:9/api'; // nothing listens here

    try {
      const a = await user('a');
      const b = await user('b');
      const { conversationId } = await asAppSuperuser(prisma, (tx) =>
        startDm(tx, { userId: a.id, otherUserId: b.id }),
      );

      const msg = await asAppSuperuser(prisma, (tx) =>
        sendMessage(tx, { conversationId, senderId: a.id, body: 'lands anyway' }),
      );

      expect(msg.id).toBeTruthy();

      const stored = await asAppSuperuser(prisma, (tx) =>
        tx.chatMessage.findUniqueOrThrow({ where: { id: msg.id } }),
      );
      expect(stored.body).toBe('lands anyway');
    } finally {
      process.env.CENTRIFUGO_API_URL = saved;
    }
  });

  it('a SESSION conversation is tenant-scoped, unlike a DM', async () => {
    const t = await seedTenant();
    const a = await user('a');

    const conv = await asAppSuperuser(prisma, (tx) =>
      tx.conversation.create({
        data: {
          type: 'SESSION',
          tenantId: t.tenantId,
          createdById: a.id,
          participants: { create: [{ userId: a.id, role: 'OWNER' }] },
        },
      }),
    );

    expect(conv.tenantId).toBe(t.tenantId);
  });
});
