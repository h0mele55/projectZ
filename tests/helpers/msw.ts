import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * MSW handlers for the third-party edges: Stripe, Resend, HIBP.
 *
 * These intercept at the HTTP layer rather than stubbing the SDK objects.
 * That distinction matters: stubbing `stripe.paymentIntents.create` proves
 * only that we call a function we wrote; intercepting the request proves
 * we send Stripe a well-formed body — and lets a test assert on the
 * amount, currency and idempotency key that actually go over the wire.
 */

/** Every request MSW intercepted this run, for assertions. */
export const recorded: Array<{ url: string; method: string; body: unknown }> = [];

async function record(request: Request) {
  let body: unknown = null;
  try {
    const text = await request.clone().text();
    body = text.startsWith('{') ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
  } catch {
    body = null;
  }
  recorded.push({ url: request.url, method: request.method, body });
  return body;
}

/** Configurable HIBP response — number of times a password was pwned. */
let hibpPwnedCount = 0;
export function setHibpPwnedCount(n: number) {
  hibpPwnedCount = n;
}

export const handlers = [
  // ── Stripe ────────────────────────────────────────────────────────
  http.post('https://api.stripe.com/v1/payment_intents', async ({ request }) => {
    const body = (await record(request)) as Record<string, string> | null;
    const id = `pi_test_${Math.random().toString(36).slice(2, 12)}`;
    return HttpResponse.json({
      id,
      object: 'payment_intent',
      amount: Number(body?.amount ?? 0),
      currency: body?.currency ?? 'eur',
      status: 'requires_payment_method',
      client_secret: `${id}_secret_test`,
      metadata: {},
    });
  }),

  http.get('https://api.stripe.com/v1/payment_intents/:id', ({ params }) =>
    HttpResponse.json({
      id: params.id,
      object: 'payment_intent',
      status: 'succeeded',
    }),
  ),

  http.post('https://api.stripe.com/v1/refunds', async ({ request }) => {
    const body = (await record(request)) as Record<string, string> | null;
    return HttpResponse.json({
      id: `re_test_${Math.random().toString(36).slice(2, 12)}`,
      object: 'refund',
      amount: Number(body?.amount ?? 0),
      payment_intent: body?.payment_intent ?? null,
      status: 'succeeded',
    });
  }),

  http.post('https://api.stripe.com/v1/checkout/sessions', async ({ request }) => {
    await record(request);
    const id = `cs_test_${Math.random().toString(36).slice(2, 12)}`;
    return HttpResponse.json({
      id,
      object: 'checkout.session',
      url: `https://checkout.stripe.com/c/pay/${id}`,
    });
  }),

  // ── Resend ────────────────────────────────────────────────────────
  http.post('https://api.resend.com/emails', async ({ request }) => {
    await record(request);
    return HttpResponse.json({ id: `mock-${Math.random().toString(36).slice(2, 12)}` });
  }),

  // ── HIBP (k-anonymity range API) ──────────────────────────────────
  http.get('https://api.pwnedpasswords.com/range/:prefix', () => {
    // The real API returns `SUFFIX:COUNT` lines. A caller hashes the
    // password, sends the first 5 hex chars, and scans for its suffix.
    const suffix = '0'.repeat(35);
    return HttpResponse.text(`${suffix}:${hibpPwnedCount}`);
  }),
];

export const mswServer = setupServer(...handlers);

/** Wire MSW into a jest suite: strict, and reset between tests. */
export function useMswServer() {
  beforeAll(() => {
    // `error` — an unhandled outbound request is a bug, not a warning. A
    // test that silently reaches the real Stripe would be far worse than
    // one that fails loudly here.
    mswServer.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    mswServer.resetHandlers();
    recorded.length = 0;
    hibpPwnedCount = 0;
  });

  afterAll(() => {
    mswServer.close();
  });
}

/** Find a recorded request by URL fragment. */
export function findRequest(fragment: string) {
  return recorded.find((r) => r.url.includes(fragment));
}
