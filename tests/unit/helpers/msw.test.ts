/**
 * @jest-environment node
 *
 * Node, not jsdom: this exercises the Stripe SDK (needs global fetch),
 * MSW's interceptors (need TextEncoder) and Prisma — none of which jsdom
 * provides.
 */
import Stripe from 'stripe';

import { findRequest, useMswServer } from '../../helpers/msw';

/**
 * MSW must intercept at the HTTP layer, not by stubbing the SDK. This test
 * drives the REAL Stripe SDK and asserts the request body that went over
 * the wire — which is what makes P09's "Stripe was called with the right
 * refund amount" assertions meaningful.
 */
describe('MSW Stripe handlers', () => {
  useMswServer();

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

  it('intercepts PaymentIntents.create and sees the real request body', async () => {
    const intent = await stripe.paymentIntents.create({
      amount: 2400,
      currency: 'eur',
      metadata: { bookingId: 'bk_1' },
    });

    expect(intent.id).toMatch(/^pi_test_/);
    expect(intent.client_secret).toContain('_secret_test');

    // The SDK form-encodes; the handler decoded it. This is the proof we
    // are asserting on the wire, not on our own call site.
    const req = findRequest('/v1/payment_intents');
    expect(req).toBeDefined();
    expect((req!.body as Record<string, string>).amount).toBe('2400');
    expect((req!.body as Record<string, string>).currency).toBe('eur');
  });

  it('intercepts refunds.create with the amount', async () => {
    const refund = await stripe.refunds.create({ payment_intent: 'pi_test_1', amount: 1200 });
    expect(refund.status).toBe('succeeded');

    const req = findRequest('/v1/refunds');
    expect((req!.body as Record<string, string>).amount).toBe('1200');
  });
});
