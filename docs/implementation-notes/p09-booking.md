# P09 — the booking golden path

## `createBooking` does not check whether the slot is free

That looks reckless. It is the opposite.

```ts
// WRONG — and wrong in a way testing will not reveal
const clash = await db.booking.findFirst({ ...overlapping... });
if (clash) throw conflict('slot_taken');
await db.booking.create({ ... });
```

Two requests both read "free". Both insert. Both succeed. The court is sold
twice. This passes every unit test you would think to write and fails on a
busy Saturday.

So we attempt the INSERT and let the Postgres EXCLUDE constraint arbitrate.
Postgres serialises the write; **nothing else can**. `23P01` becomes
`SlotTakenError`.

The read-before-write check is also a lie in the other direction: it makes
the code _look_ like it is the safeguard, so the next person "optimises
away" the constraint they think is redundant.

**Proven, not asserted.** `booking-golden-path.test.ts` starts two
`createBooking` promises before awaiting either, so they genuinely race
inside Postgres. Exactly one is fulfilled, exactly one is rejected — with a
clean `SlotTakenError`, not a raw 500 — and the table holds exactly one row.

## A bug I introduced and then caught: the aborted transaction

The first version of the idempotency handling did the obvious thing:

```ts
catch (err) {
  if (isUniqueViolation(err)) {
    const existing = await db.booking.findUnique({ ...byIdempotencyKey });
    return existing;            // ← CANNOT WORK
  }
}
```

**A constraint violation ABORTS the Postgres transaction.** Every subsequent
command in it fails with _"current transaction is aborted, commands ignored
until end of transaction block"_. The recovery read throws a second, more
confusing error on top of the first.

And it only ever fails on a **real retry**: the user taps "Book" once, the
network stalls, the app retries with the same idempotency key — and gets a
500 error page while their booking actually exists.

The fix is an idempotency **pre-check**, before the insert.

That is not the check-then-insert anti-pattern, and the distinction is
worth being precise about:

- checking whether the **slot** is free is unsafe — another transaction can
  take it between the check and the insert, so the EXCLUDE constraint must
  arbitrate;
- checking the **idempotency key** is a fast path, and the unique constraint
  still arbitrates. Racing there costs correctness nothing: the loser gets
  `23505` and is told to retry.

A regression test pins it by asserting the transaction is _still usable_
after a replay — which it would not be if recovery-by-catch had been used.

## The refund boundary belongs to the customer

`hoursUntilStart >= policy.fullRefundBeforeHours`, not `>`.

A strict `>` silently charges 50% to the person who **read the terms and
cancelled precisely on the deadline**. That is the kind of bug that becomes
a chargeback, and it is one character.

The resolved percentage is **written onto the Cancellation row**, not
recomputed later. The venue's policy may change next month; a receipt must
not.

## Webhook signature: the only thing between the booking table and the internet

The Stripe webhook is unauthenticated by necessity — Stripe has no session.
The **signature is the authentication**, verified against the **raw body**.
`req.json()` would already have destroyed the bytes the signature was
computed over.

The signature also covers a **timestamp**, which is what makes a replay fail:
an attacker who captures a legitimate `payment_intent.succeeded` cannot
re-send it tomorrow to confirm a different booking. That protection is lost
the moment anyone "just parses the body to check something first".

The tests run through the **real Stripe verifier**, not a stub. A test that
mocks `constructEvent` proves nothing about the defence it claims to test —
you cannot demonstrate that a forgery is caught unless the genuine article
passes through the same code. Tampered amount, wrong secret, missing header,
and a two-hour-old replay are all rejected.

## Confirmation is idempotent because Stripe retries

Stripe retries on any non-2xx and will happily deliver the same event twice.
An unguarded handler sends two confirmation emails and enqueues two sets of
reminder jobs. Forgery gets a **400, not a 500** — a 5xx would make Stripe
retry an attacker's payload for days.
