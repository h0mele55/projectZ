import { type NextRequest, NextResponse } from 'next/server';

import { WebhookSignatureError, verifyStripeWebhook } from '@/lib/stripe';

/**
 * Stripe webhook.
 *
 * Unauthenticated by necessity — Stripe has no session. The SIGNATURE is
 * the authentication, so it is verified against the RAW body before
 * anything else happens. `req.json()` would already have destroyed the
 * bytes the signature was computed over.
 *
 * Confirming a booking is idempotent: Stripe retries on any non-2xx, and it
 * will happily deliver the same event twice. `updateMany` on a PENDING row
 * means the second delivery is a no-op rather than a second confirmation
 * email and a second set of reminder jobs.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();

  let event;
  try {
    event = verifyStripeWebhook(raw, req.headers.get('stripe-signature'));
  } catch (e) {
    if (e instanceof WebhookSignatureError) {
      // 400, not 500: this is a rejected forgery, not our bug. A 5xx would
      // make Stripe retry an attacker's payload for days.
      return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    }
    throw e;
  }

  if (event.type !== 'payment_intent.succeeded') {
    // Acknowledge everything else. A non-2xx makes Stripe retry forever.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  return NextResponse.json({ received: true, type: event.type });
}
