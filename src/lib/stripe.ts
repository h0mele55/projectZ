import Stripe from 'stripe';

/**
 * The Stripe client + webhook verifier.
 *
 * `constructEvent` is the ONLY thing standing between your booking table
 * and anyone on the internet who can POST JSON. A webhook handler that
 * trusts its body is a handler where a stranger marks bookings as paid.
 */
let client: Stripe | undefined;

export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
      apiVersion: '2025-02-24.acacia' as never,
      maxNetworkRetries: 2,
    });
  }
  return client;
}

export class WebhookSignatureError extends Error {
  readonly code = 'invalid_signature';
  constructor(cause: string) {
    super(`Stripe webhook signature verification failed: ${cause}`);
    this.name = 'WebhookSignatureError';
  }
}

/**
 * Verify and parse. Never `JSON.parse(body)` in the handler.
 *
 * The signature also covers a TIMESTAMP, which is what makes a replay
 * attack fail — an attacker who captures a legitimate `payment_intent
 * .succeeded` cannot re-send it tomorrow to confirm a different booking.
 * That protection is lost the moment anyone "just parses the body to check
 * something first".
 */
export function verifyStripeWebhook(rawBody: string, signatureHeader: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new WebhookSignatureError('STRIPE_WEBHOOK_SECRET is not set');
  if (!signatureHeader) throw new WebhookSignatureError('missing stripe-signature header');

  try {
    return stripe().webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch (e) {
    throw new WebhookSignatureError(e instanceof Error ? e.message : 'unknown');
  }
}
