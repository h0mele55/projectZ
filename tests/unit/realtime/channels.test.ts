/**
 * @jest-environment node
 */
import {
  CONNECTION_TOKEN_TTL,
  mintConnectionToken,
} from '@/lib/realtime/centrifugo';
import {
  InvalidChannelIdError,
  conversationChannel,
  notificationChannel,
  parseChannel,
  presenceChannel,
} from '@/lib/realtime/channels';

const CUID = 'clx1234567890abcdefghij';

describe('channel names are an AUTHORIZATION boundary', () => {
  it('builds the canonical shapes', () => {
    expect(conversationChannel(CUID)).toBe(`conv:${CUID}`);
    expect(notificationChannel(CUID)).toBe(`notif:${CUID}`);
    expect(presenceChannel(CUID)).toBe(`presence:user:${CUID}`);
  });

  it('REFUSES an id that is not a cuid', () => {
    // A channel name is "everyone subscribed to this string can read every
    // message on it". A name assembled from unvalidated input is a data leak,
    // not a cosmetic bug.
    for (const bad of ['*', 'conv:*', '../other', 'abc', '', 'c'.repeat(200)]) {
      expect(() => conversationChannel(bad)).toThrow(InvalidChannelIdError);
    }
  });

  it('refuses a name carrying a namespace separator', () => {
    // `conv:${input}` where input is `x:y` would place the subscriber in a
    // namespace they were never granted.
    expect(() => conversationChannel('clx123:presence:user:evil')).toThrow(InvalidChannelIdError);
  });

  it('parseChannel round-trips, and rejects anything else', () => {
    expect(parseChannel(conversationChannel(CUID))).toEqual({ kind: 'conversation', id: CUID });
    expect(parseChannel(notificationChannel(CUID))).toEqual({ kind: 'notification', id: CUID });
    expect(parseChannel(presenceChannel(CUID))).toEqual({ kind: 'presence', id: CUID });

    expect(parseChannel('conv:*')).toBeNull();
    expect(parseChannel('admin:secrets')).toBeNull();
    expect(parseChannel('')).toBeNull();
  });
});

describe('connection token', () => {
  it('is SHORT-LIVED — the TTL is the revocation window', () => {
    // A long-lived token cannot be revoked: block a user, or remove them from a
    // venue, and a token minted an hour ago still holds their subscription
    // open.
    expect(CONNECTION_TOKEN_TTL).toBeLessThanOrEqual(15 * 60);
  });

  it('carries `sub` and an expiry, and nothing else', () => {
    const token = mintConnectionToken(CUID, Date.parse('2026-08-01T10:00:00Z'));
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString());

    expect(payload.sub).toBe(CUID);
    expect(payload.exp - payload.iat).toBe(CONNECTION_TOKEN_TTL);

    // Deliberately NOT a capability list. Channel grants in the token would
    // freeze them for its lifetime — exactly the bug the short TTL bounds.
    // Authorization happens per-subscription, against the database.
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
  });

  it('is a well-formed JWT', () => {
    expect(mintConnectionToken(CUID).split('.')).toHaveLength(3);
  });
});
