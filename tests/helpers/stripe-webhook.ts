import { createHmac } from 'node:crypto';

/**
 * Build a Stripe webhook payload and sign it with the test secret, so
 * `/api/webhooks/stripe` can verify it end-to-end.
 *
 * The point is to NOT mock the signature check. A test that stubs
 * `stripe.webhooks.constructEvent` proves nothing about the endpoint's
 * actual defence — the one thing a payment webhook must get right is
 * rejecting a forged body. P09's suite asserts a tampered payload is
 * rejected, and that assertion is only meaningful if the happy path runs
 * through the real verifier.
 */

// Stripe's test-mode placeholder. Signs fixtures in this repo and nothing else.
export const TEST_WEBHOOK_SECRET = 'whsec_test_dummy'; // pragma: allowlist secret

export interface SignedWebhook {
  payload: string;
  signature: string;
  header: string;
  timestamp: number;
}

/** Stripe's scheme: HMAC-SHA256 over `${timestamp}.${payload}`. */
export function signStripeWebhook(
  event: unknown,
  opts: { secret?: string; timestamp?: number } = {},
): SignedWebhook {
  const secret = opts.secret ?? TEST_WEBHOOK_SECRET;
  // Caller supplies the timestamp — Stripe rejects payloads outside its
  // tolerance window, and a test asserting that needs to control it.
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);

  const payload = JSON.stringify(event);
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');

  return {
    payload,
    signature,
    timestamp,
    header: `t=${timestamp},v1=${signature}`,
  };
}

/** A payment_intent.succeeded event shaped like the real thing. */
export function paymentIntentSucceeded(opts: {
  paymentIntentId: string;
  bookingId: string;
  amountCents: number;
  currency?: string;
}) {
  return {
    id: `evt_${opts.bookingId}`,
    object: 'event',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.paymentIntentId,
        object: 'payment_intent',
        amount: opts.amountCents,
        currency: opts.currency ?? 'eur',
        status: 'succeeded',
        metadata: { bookingId: opts.bookingId },
      },
    },
  };
}
