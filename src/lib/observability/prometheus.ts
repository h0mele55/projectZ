import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * The Prometheus registry, and the metrics worth waking someone for.
 *
 * ─── Label CARDINALITY is the whole discipline ───────────────────────
 *
 * Every distinct combination of label values is a separate time series that
 * Prometheus stores forever. A label with unbounded values — a user id, a
 * booking id, a raw URL path — creates a new series per value.
 *
 * At a thousand users that is a thousand series. At a hundred thousand it is a
 * hundred thousand, and Prometheus falls over. This is the single most common
 * way a metrics system kills the thing it was meant to observe, and it fails
 * gradually — memory creeps, queries get slow, and by the time anyone notices,
 * the retention is unusable.
 *
 * So EVERY label below is drawn from a bounded set: a sport (16), a status (5),
 * a normalised route template (`/api/bookings/[id]`, not `/api/bookings/abc123`).
 * There is a ratchet asserting no metric carries an id-shaped label.
 */

export const registry = new Registry();

registry.setDefaultLabels({ service: 'playerz' });

// CPU, memory, event-loop lag, GC. Free, and the first thing you want when a pod
// is misbehaving.
collectDefaultMetrics({ register: registry });

// ══ The booking spine ════════════════════════════════════════════════

export const bookingsCreated = new Counter({
  name: 'playerz_bookings_created_total',
  help: 'Bookings successfully created.',
  // `sport` is bounded (16). NOT venueId, NOT userId.
  labelNames: ['sport'] as const,
  registers: [registry],
});

/**
 * The one that means the system is WORKING, not failing.
 *
 * A rejected double-booking is the EXCLUDE constraint doing its job — two people
 * raced for the same court and Postgres refused the second. It is not an error,
 * and it should not page anybody.
 *
 * But the RATE matters enormously: a sudden spike means either a popular slot, or
 * a client retrying in a loop, or a bug that is hammering us. It is one of the
 * few numbers that tells you something is wrong before a user does.
 */
export const doubleBookingsRejected = new Counter({
  name: 'playerz_double_bookings_rejected_total',
  help: 'Booking attempts refused by the booking_no_overlap constraint. Healthy, but the rate matters.',
  labelNames: ['sport'] as const,
  registers: [registry],
});

// ══ Money ════════════════════════════════════════════════════════════

/**
 * A payment that FAILED. This one pages somebody.
 *
 * Split by reason, because "card declined" is a customer's problem and
 * "payouts_not_enabled" is ours — and the two must not average into one
 * reassuring line on a dashboard.
 */
export const paymentFailures = new Counter({
  name: 'playerz_payment_failures_total',
  help: 'Payments that failed, by reason.',
  labelNames: ['reason'] as const,
  registers: [registry],
});

/**
 * Money we owe a venue but have not settled.
 *
 * A gauge, not a counter — it goes up and down. If it starts climbing and does
 * not come back down, transfers are silently failing and clubs are not being
 * paid, which is the kind of thing that is discovered by an angry phone call.
 */
export const pendingPayoutCents = new Gauge({
  name: 'playerz_pending_payout_cents',
  help: 'Total value of confirmed bookings whose payout has not yet settled.',
  registers: [registry],
});

// ══ Latency ══════════════════════════════════════════════════════════

export const httpDuration = new Histogram({
  name: 'playerz_http_request_duration_seconds',
  help: 'HTTP request duration.',
  // The route TEMPLATE — `/api/bookings/[id]` — never the raw path. A raw path
  // carries the id, and an id label is an unbounded label.
  labelNames: ['method', 'route', 'status'] as const,
  // Buckets chosen around what a user actually notices: 100ms feels instant,
  // 1s feels slow, 3s feels broken. Default buckets waste resolution at the top.
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const dbDuration = new Histogram({
  name: 'playerz_db_query_duration_seconds',
  help: 'Database query duration.',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry],
});

// ══ Queues ═══════════════════════════════════════════════════════════

export const jobsProcessed = new Counter({
  name: 'playerz_jobs_processed_total',
  help: 'Background jobs processed.',
  labelNames: ['queue', 'outcome'] as const,
  registers: [registry],
});

/**
 * The oldest job still waiting.
 *
 * A queue DEPTH tells you almost nothing — a thousand fast jobs is fine, and ten
 * stuck ones is not. Age is what you actually care about: if the oldest job in
 * the reminder queue is two hours old, somebody's booking reminder is not going
 * to arrive before their booking does.
 */
export const oldestJobAgeSeconds = new Gauge({
  name: 'playerz_queue_oldest_job_age_seconds',
  help: 'Age of the oldest unprocessed job. Depth lies; age does not.',
  labelNames: ['queue'] as const,
  registers: [registry],
});

/** The Prometheus exposition text. */
export async function collectMetrics(): Promise<string> {
  return registry.metrics();
}

export const contentType = registry.contentType;
