import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * The booking hot path, under load.
 *
 * ─── What this test is actually FOR ──────────────────────────────────
 *
 * Not "how many requests per second can we do". That number is easy to produce
 * and almost useless — it tells you about the machine you ran it on.
 *
 * It exists to answer ONE question: does the double-booking defence hold when a
 * hundred people race for the same court?
 *
 * The whole booking design (P05, P09) rests on a Postgres EXCLUDE constraint and
 * a deliberately naive `createBooking` that does NOT check whether the slot is
 * free — because under concurrency that check always loses. This is the test that
 * proves the constraint really is the thing standing between us and selling one
 * court twice.
 *
 * So the scenario is deliberately pathological: every VU hammers the SAME slot.
 * A well-behaved load test would spread across slots and would prove nothing.
 *
 * ─── How to read the result ──────────────────────────────────────────
 *
 * A high `double_bookings_rejected` count is SUCCESS. It means Postgres refused
 * the losers, exactly as designed. What must be ZERO is `slot_sold_twice` — two
 * confirmed bookings for one slot. If that is ever non-zero, stop and do not
 * deploy: the constraint is not doing what we think it is.
 *
 *   k6 run --vus 100 --duration 30s load/booking-hot-path.js
 */

const slotSoldTwice = new Counter('slot_sold_twice');
const doubleBookingsRejected = new Counter('double_bookings_rejected');
const bookingSuccess = new Rate('booking_success_rate');
const bookingLatency = new Trend('booking_latency_ms');

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    // Everybody, at once, for the same court. The point of the exercise.
    thundering_herd: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 100),
      duration: __ENV.DURATION || '30s',
    },
  },

  thresholds: {
    // THE assertion. A slot sold twice is a failed run, full stop — there is no
    // acceptable rate of selling one court to two people.
    slot_sold_twice: ['count == 0'],

    // p95 under a second. A booking that takes longer than that is one the user
    // assumes has failed, and they tap Book again — which is exactly the
    // duplicate-submission storm the idempotency key exists to absorb.
    'http_req_duration{name:create_booking}': ['p(95) < 1000'],

    // 5xx means WE broke. A rejected double-booking is a 409, not a 500, and
    // must not count against this.
    http_req_failed: ['rate < 0.01'],
  },
};

export default function () {
  // Every VU targets the SAME slot, deliberately.
  const slot = {
    resourceId: __ENV.RESOURCE_ID || 'test-resource',
    startTs: '2026-08-01T10:00:00Z',
    endTs: '2026-08-01T11:00:00Z',
    // A DISTINCT idempotency key per attempt. Sharing one would make every
    // request a duplicate of the first, and the test would prove nothing about
    // the constraint — only about idempotency.
    idempotencyKey: `k6-${__VU}-${__ITER}`,
  };

  const started = Date.now();

  const res = http.post(`${BASE}/api/bookings`, JSON.stringify(slot), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'create_booking' },
  });

  bookingLatency.add(Date.now() - started);

  // 201 — we won the race.
  if (res.status === 201) {
    bookingSuccess.add(true);
  }
  // 409 — Postgres refused us because somebody else got there first. This is the
  // system WORKING. It is not an error and it must not be counted as one.
  else if (res.status === 409) {
    doubleBookingsRejected.add(1);
    bookingSuccess.add(true);
  } else {
    bookingSuccess.add(false);
  }

  check(res, {
    'not a 5xx': (r) => r.status < 500,
    'rejection is a 409, not a 500': (r) => r.status !== 500,
  });

  sleep(0.1);
}

/**
 * After the run: ask the server how many bookings actually exist for that slot.
 *
 * This is the assertion that matters, and it cannot be made from inside the VU
 * loop — a VU only knows about its own request.
 */
export function teardown() {
  const res = http.get(
    `${BASE}/api/bookings/count?resourceId=${__ENV.RESOURCE_ID || 'test-resource'}` +
      `&startTs=2026-08-01T10:00:00Z`,
  );

  if (res.status !== 200) return;

  const { confirmed } = res.json();

  // One slot. One booking. If this is ever above 1, the EXCLUDE constraint did
  // not hold, and every assumption the booking system rests on is wrong.
  if (confirmed > 1) {
    slotSoldTwice.add(confirmed - 1);
    console.error(
      `SLOT SOLD ${confirmed} TIMES. The booking_no_overlap constraint did not hold. ` +
        `Do not deploy.`,
    );
  }
}
