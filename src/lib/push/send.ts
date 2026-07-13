import webpush from 'web-push';

/**
 * Web Push.
 *
 * ─── On the licence ──────────────────────────────────────────────────
 *
 * `web-push` is MPL-2.0 — WEAK, file-level copyleft. Using it unmodified as a
 * dependency imposes nothing on our code; only changes to ITS files would have
 * to be published. It is not the Stockfish situation (see src/lib/chess/engine.ts)
 * and needs no quarantine. Do not modify it in place, and there is nothing to
 * think about.
 *
 * ─── What a push payload is, and what it must never contain ──────────
 *
 * The payload is encrypted end-to-end to the browser, so the push service (Google,
 * Mozilla, Apple) cannot read it. That is a real guarantee and it is worth having.
 *
 * It is also NOT the guarantee people assume. The decrypted notification is
 * rendered on a LOCK SCREEN — visible to anyone holding the phone, including the
 * person the message is about. So:
 *
 *   • never put the CONTENTS of a private message in a push;
 *   • never put a payment amount, a card detail, or a token;
 *   • never put anything you would not be happy showing a stranger on a train.
 *
 * A push says "Ivan sent you a message". The message itself lives behind the
 * lock. A ratchet enforces this — see tests/guardrails/push-payload.test.ts.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping it goes. */
  url?: string;
  /** Collapses older notifications about the same thing. */
  tag?: string;
}

export type PushOutcome =
  | { ok: true }
  /** The subscription is DEAD. Delete it — see below. */
  | { ok: false; gone: true }
  /** A transient failure. Keep the subscription, try again next time. */
  | { ok: false; gone: false; status?: number };

let configured = false;

function configure(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:support@playerz.bg';

  // The PRESENCE check runs every call. Caching a `configured = true` and
  // returning early on it means that once keys have been seen, the function
  // reports "configured" forever — even after they are gone. That is exactly the
  // shape of bug that makes a missing key in one environment look fine because
  // another environment had it.
  if (!publicKey || !privateKey) return false;

  // The `setVapidDetails` CALL is what we avoid repeating; it is pure setup.
  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }

  return true;
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Send one push.
 *
 * ─── 404 and 410 mean the device is GONE ─────────────────────────────
 *
 * A push service returns 404/410 when the subscription no longer exists — the
 * user cleared their browser data, uninstalled the PWA, or revoked permission.
 *
 * That is PERMANENT, and it must be treated as such. A subscription that is
 * retried forever is not merely wasted work: the failures accumulate, the queue
 * backs up behind endpoints that will never accept anything again, and the
 * genuine notifications behind them are late. Delete it.
 *
 * Everything else — a 429, a 500, a timeout — is transient. Deleting on those
 * would silently unsubscribe a user whose push service had a bad afternoon, and
 * they would never know why the notifications stopped.
 */
export async function sendPush(
  subscription: Subscription,
  payload: PushPayload,
): Promise<PushOutcome> {
  if (!configure()) {
    // No VAPID keys. Not an error worth throwing over — push is an ENHANCEMENT
    // on top of the notification centre, which has the row regardless. The user
    // sees it when they open the app.
    return { ok: false, gone: false };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      {
        // A notification about a booking in two hours is worthless in three.
        TTL: 3 * 60 * 60,
        urgency: 'normal',
      },
    );

    return { ok: true };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;

    // 404 Not Found / 410 Gone — the endpoint is dead and always will be.
    if (status === 404 || status === 410) {
      return { ok: false, gone: true };
    }

    return { ok: false, gone: false, status };
  }
}

/** The public key the browser needs in order to subscribe. */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}
