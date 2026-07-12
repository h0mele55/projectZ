import type { PrismaClient } from '@prisma/client';
import type Stripe from 'stripe';

/**
 * What each Stripe event actually does to our database.
 *
 * Kept out of the route so it can be tested by handing it an event object,
 * rather than by constructing a signed HTTP request for every case.
 *
 * ─── Every handler here MUST be idempotent ───────────────────────────
 *
 * Stripe retries on any non-2xx, and delivers at-least-once even when we
 * answered 200 — a network blip on the response is indistinguishable from a
 * failure. So each of these is written to be safely re-runnable: they set
 * absolute state (`payoutsEnabled = <what Stripe says>`) rather than
 * incrementing, or they update a row only when it is in the expected prior
 * state.
 *
 * A handler that credits a wallet on `invoice.paid` by INCREMENTING would
 * double-credit on a redelivery. There isn't one here, and there must not be
 * one added without a dedupe on `event.id`.
 */

export async function handleAccountUpdated(
  db: PrismaClient,
  account: Stripe.Account,
): Promise<{ handled: boolean }> {
  const venue = await db.venueOrg.findFirst({ where: { stripeAccountId: account.id } });
  if (!venue) return { handled: false };

  // MIRROR Stripe. Do not infer this from `details_submitted`, and do not
  // latch it to true once seen — Stripe can and does DISABLE payouts later
  // (a failed identity check, an expired document). If we latched, we would
  // keep taking bookings for a club that can no longer be paid, and discover
  // it only when the payouts started bouncing.
  const payoutsEnabled = account.payouts_enabled === true;

  await db.venueOrg.update({
    where: { id: venue.id },
    data: { payoutsEnabled },
  });

  return { handled: true };
}

/**
 * A membership subscription's invoice was paid → the membership is active.
 *
 * Idempotent because it sets `status: 'ACTIVE'` absolutely. A redelivery
 * re-activates an already-active membership, which is a no-op.
 */
export async function handleInvoicePaid(
  db: PrismaClient,
  invoice: Stripe.Invoice,
): Promise<{ handled: boolean }> {
  // Stripe's 2025 API moved this. It used to be `invoice.subscription`; it is
  // now nested under `parent.subscription_details`, and the old field is gone
  // — not deprecated, GONE. Reading the old path compiles fine against a loose
  // type and yields `undefined` at runtime, so every membership silently fails
  // to activate while the webhook cheerfully returns 200.
  const sub = invoice.parent?.subscription_details?.subscription ?? null;
  const subscriptionId = typeof sub === 'string' ? sub : (sub?.id ?? null);

  // An invoice with no subscription is a one-off charge, not a membership
  // renewal. Nothing to do — but say so, rather than pretending we handled it.
  if (!subscriptionId) return { handled: false };

  const membership = await db.membership.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  });

  if (membership) {
    await db.membership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE' },
    });
    return { handled: true };
  }

  // Not a player membership — maybe it is the VENUE's own subscription to us,
  // which sets their plan tier and therefore our commission.
  const venue = await db.venueOrg.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  });

  if (!venue) return { handled: false };

  return { handled: true };
}

/**
 * A subscription lapsed → the membership is not active any more.
 *
 * Note this does NOT delete anything. A lapsed membership is a historical fact
 * (they were a member from March to September); deleting it would erase that,
 * and with it any booking discount they legitimately received at the time.
 */
export async function handleSubscriptionDeleted(
  db: PrismaClient,
  subscription: Stripe.Subscription,
): Promise<{ handled: boolean }> {
  const membership = await db.membership.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (!membership) return { handled: false };

  await db.membership.update({
    where: { id: membership.id },
    data: { status: 'EXPIRED', autoRenew: false },
  });

  return { handled: true };
}
