/**
 * THE ONLY PLACE CHANNEL NAMES ARE BUILT.
 *
 * A channel name is an authorization boundary. `conv:{id}` means "everyone
 * subscribed to this string can read every message published to it" — so a
 * typo, or a name assembled from unvalidated input, is a data leak, not a
 * cosmetic bug.
 *
 * Two failure modes this file exists to prevent:
 *
 *   1. `` `conv:${userInput}` `` — if userInput is `*` or contains a namespace
 *      separator, the subscriber may end up on a channel they were never
 *      granted. Ids are validated here, once.
 *
 *   2. A channel string spelled inline somewhere else, slightly differently.
 *      The publisher writes `conv:abc` and the subscriber listens on
 *      `conversation:abc`. Nothing errors. Messages simply never arrive, and
 *      you spend a day debugging the WebSocket.
 *
 * A ratchet (`channel-name-discipline`) fails the build on an inline
 * `"conv:"` / `"notif:"` / `"presence:"` literal outside this file.
 */

/** Prisma ids are cuid. Anything else is not an id we issued. */
const CUID = /^c[a-z0-9]{20,32}$/i;

export class InvalidChannelIdError extends Error {
  constructor(kind: string, value: string) {
    super(`Refusing to build a ${kind} channel from a malformed id: ${JSON.stringify(value)}`);
    this.name = 'InvalidChannelIdError';
  }
}

function assertId(kind: string, id: string): void {
  if (!CUID.test(id)) throw new InvalidChannelIdError(kind, id);
}

/** Messages in a conversation. Namespace `conv` has presence + history. */
export function conversationChannel(conversationId: string): string {
  assertId('conversation', conversationId);
  return `conv:${conversationId}`;
}

/** A user's private notification feed. */
export function notificationChannel(userId: string): string {
  assertId('notification', userId);
  return `notif:${userId}`;
}

/** Online/offline for a user. */
export function presenceChannel(userId: string): string {
  assertId('presence', userId);
  return `presence:user:${userId}`;
}

/** Parse a channel back to its parts — used when authorizing a subscription. */
export function parseChannel(
  channel: string,
): { kind: 'conversation' | 'notification' | 'presence'; id: string } | null {
  const conv = channel.match(/^conv:(c[a-z0-9]{20,32})$/i);
  if (conv) return { kind: 'conversation', id: conv[1]! };

  const notif = channel.match(/^notif:(c[a-z0-9]{20,32})$/i);
  if (notif) return { kind: 'notification', id: notif[1]! };

  const pres = channel.match(/^presence:user:(c[a-z0-9]{20,32})$/i);
  if (pres) return { kind: 'presence', id: pres[1]! };

  return null;
}
