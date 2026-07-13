/**
 * @jest-environment node
 */
import { sendPush } from '@/lib/push/send';

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
  },
}));

 
const webpush = require('web-push').default as {
  sendNotification: jest.Mock;
  setVapidDetails: jest.Mock;
};

const SUB = { endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a' };
const PAYLOAD = { title: 'Booking confirmed', body: 'Court 1, Saturday.' };

describe('sendPush', () => {
  const originalPublic = process.env.VAPID_PUBLIC_KEY;
  const originalPrivate = process.env.VAPID_PRIVATE_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VAPID_PUBLIC_KEY = 'test-public'; // pragma: allowlist secret
    process.env.VAPID_PRIVATE_KEY = 'test-private'; // pragma: allowlist secret
  });

  afterAll(() => {
    if (originalPublic !== undefined) process.env.VAPID_PUBLIC_KEY = originalPublic;
    if (originalPrivate !== undefined) process.env.VAPID_PRIVATE_KEY = originalPrivate;
  });

  it('sends, and reports success', async () => {
    webpush.sendNotification.mockResolvedValueOnce({});

    const r = await sendPush(SUB, PAYLOAD);

    expect(r).toEqual({ ok: true });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
  });

  it.each([404, 410])(
    'treats %i as PERMANENT — the device is gone and must be deleted',
    async (status) => {
      // The browser was cleared, the PWA uninstalled, permission revoked. It will
      // never accept anything again. Retrying it forever backs the queue up
      // behind endpoints that are dead, and the genuine notifications behind them
      // are late.
      webpush.sendNotification.mockRejectedValueOnce({ statusCode: status });

      const r = await sendPush(SUB, PAYLOAD);

      expect(r).toEqual({ ok: false, gone: true });
    },
  );

  it.each([429, 500, 503])('treats %i as TRANSIENT — the subscription survives', async (status) => {
    // Deleting on a 500 would silently unsubscribe a user whose push service
    // had a bad afternoon, and they would never find out why the notifications
    // stopped.
    webpush.sendNotification.mockRejectedValueOnce({ statusCode: status });

    const r = await sendPush(SUB, PAYLOAD);

    expect(r).toEqual({ ok: false, gone: false, status });
  });

  it('a network error with no status is TRANSIENT, not fatal', async () => {
    webpush.sendNotification.mockRejectedValueOnce(new Error('ECONNRESET'));

    const r = await sendPush(SUB, PAYLOAD);

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ gone: false });
  });

  it('does nothing, quietly, when VAPID is not configured', async () => {
    // Push is an ENHANCEMENT on top of the notification centre, which has the
    // row regardless. Throwing here would fail a booking confirmation because a
    // key was missing.
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const r = await sendPush(SUB, PAYLOAD);

    expect(r).toEqual({ ok: false, gone: false });
  });

  it('sets a TTL — a reminder about a booking in two hours is worthless in three', async () => {
    webpush.sendNotification.mockResolvedValueOnce({});

    await sendPush(SUB, PAYLOAD);

    const options = webpush.sendNotification.mock.calls[0]![2] as { TTL: number };
    expect(options.TTL).toBeGreaterThan(0);
    expect(options.TTL).toBeLessThanOrEqual(24 * 3600);
  });
});
