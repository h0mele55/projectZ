/**
 * @jest-environment node
 *
 * Node, not jsdom: this exercises the Stripe SDK (needs global fetch),
 * MSW's interceptors (need TextEncoder) and Prisma — none of which jsdom
 * provides.
 */
import Stripe from 'stripe';

import {
  TEST_WEBHOOK_SECRET,
  paymentIntentSucceeded,
  signStripeWebhook,
} from '../../helpers/stripe-webhook';

/**
 * The signer must produce a payload the REAL Stripe SDK accepts. If it
 * didn't, P09's "tampered body is rejected" test would be vacuous — you
 * cannot prove a forgery is caught unless the genuine article passes.
 */
describe('signStripeWebhook', () => {
  // Two things matter here:
  //  1. Stripe defaults to Node's `https` module; MSW intercepts `fetch`
  //     far more reliably in the jest runtime.
  //  2. The fetch reference must be resolved LAZILY. The describe body runs
  //     BEFORE beforeAll(listen), so `createFetchHttpClient(fetch)` would
  //     capture the un-patched global and the request would escape to the
  //     real api.stripe.com (it did: "Invalid API Key provided").
  const stripe = new Stripe('sk_test_dummy', {
    apiVersion: '2025-02-24.acacia' as never,
    httpClient: Stripe.createFetchHttpClient((...args: Parameters<typeof fetch>) =>
      globalThis.fetch(...args),
    ),
    maxNetworkRetries: 0,
  });

  const event = paymentIntentSucceeded({
    paymentIntentId: 'pi_test_123',
    bookingId: 'bk_test_123',
    amountCents: 2400,
  });

  it('produces a payload the Stripe SDK verifies as genuine', () => {
    const { payload, header } = signStripeWebhook(event);

    const verified = stripe.webhooks.constructEvent(payload, header, TEST_WEBHOOK_SECRET);

    expect(verified.type).toBe('payment_intent.succeeded');
    const intent = verified.data.object as unknown as { metadata: { bookingId: string } };
    expect(intent.metadata.bookingId).toBe('bk_test_123');
  });

  it('a tampered body fails verification', () => {
    const { payload, header } = signStripeWebhook(event);
    const tampered = payload.replace('2400', '1');

    expect(() => stripe.webhooks.constructEvent(tampered, header, TEST_WEBHOOK_SECRET)).toThrow(
      /signature/i,
    );
  });

  it('the wrong secret fails verification', () => {
    const { payload, header } = signStripeWebhook(event);

    expect(() => stripe.webhooks.constructEvent(payload, header, 'whsec_wrong')).toThrow(
      /signature/i,
    );
  });
});
