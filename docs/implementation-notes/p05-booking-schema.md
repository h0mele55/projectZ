# P05 — booking & matchmaking schema

## The EXCLUDE constraint is the whole point

An application-layer "is this slot free?" check **cannot work** under
concurrency:

```
request A: SELECT … → free
request B: SELECT … → free
request A: INSERT   → ok
request B: INSERT   → ok
```

You have now sold the same court twice. No amount of care in the app layer
fixes this; only the database can, because only the database can serialise
the write.

So P09's `createBooking` will deliberately **not check**. It attempts the
INSERT and catches SQLSTATE `23P01` (`exclusion_violation`), mapping it to
`conflict('slot_taken')`.

That design is only safe if the constraint really fires, so
`booking-exclusion.test.ts` asserts the **SQLSTATE**, not merely that
something threw — a NOT NULL violation also throws, and would let a broken
constraint pass silently.

### Two details in the constraint that are load-bearing

**`'[)'` — a half-open range.** A booking `[09:00, 10:00)` and one starting
at `[10:00, 11:00)` share only the instant 10:00, which the half-open range
excludes. Back-to-back slots are the _normal_ case at any club; a closed
`[]` range would reject them.

**`WHERE (status IN ('CONFIRMED','PENDING'))`.** A CANCELLED booking must
free its slot, or a cancellation holds the court hostage forever. A PENDING
booking still _holds_ it — somebody is at checkout — which is exactly why
`Booking.expiresAt` exists: without an expiry, an abandoned checkout would
hold the slot indefinitely.

## Prisma 7 buries the SQLSTATE

The top-level `code` on a Prisma error is Prisma's own `P2010`. The real
SQLSTATE sits at a depth that **varies with how the driver adapter
classified the violation**:

- a _unique_ violation gets a mapped `kind` and an `originalCode`;
- an _exclusion_ or _CHECK_ violation has no mapped kind, so the raw pg
  error (with `code`) is carried instead;
- and both are re-wrapped again inside a `$transaction`.

Hard-coding one path silently returns `undefined` the moment Prisma shifts
it — and `undefined !== '23P01'` means a double-booking conflict surfacing
as a 500 instead of a clean "someone just took this slot".

`src/lib/db/pg-errors.ts` therefore walks the error graph for a value that
_is_ a SQLSTATE. It lives in `src/` rather than in the test, because P09
depends on it — and the integration test imports it, so the test proves the
production code.

## Index coverage is a ratchet, not a review item

A missing index is invisible until it isn't. The seed database has three
venues and every query is instant; production has fifty thousand bookings
and the same query is a sequential scan that takes the site down. The code
is _correct_ — just catastrophically slow. Nothing in the type system,
the tests, or code review catches that.

`schema-index-coverage.test.ts` therefore tests the schema itself:

- **Layer A** — every `tenantId` must **lead** an index. RLS adds
  `tenantId = …` to every query on the table whether the caller wrote it or
  not, and a tenantId sitting _second_ in a composite index cannot serve
  that predicate.
- **Layer B** — every foreign key must be indexed. Postgres does **not**
  auto-index a FK (unlike MySQL); without one, every `ON DELETE CASCADE`
  seq-scans the child table.
- **Layer C** — curated composite indexes for the list queries P08 will
  run, declared _before_ the queries exist, so the index lands with the
  schema rather than after the first slow-query alert.

**Verified by negative control:** deleting `@@index([tenantId, courtId,
startTs])` from `Booking` fails immediately with the reason attached
("availability lookup — the hottest read in the product").

Two parser subtleties, both of which produced false positives until fixed:
a _field-level_ `@unique` creates a real index, and a composite `@@id([a,
b])` is a btree index leading on its first column.

## Currency: EUR, not BGN

P05's prompt says `currency default "BGN"`. Bulgaria adopted the euro on
2026-01-01; BGN is no longer the country's currency. The default is `EUR`
throughout, consistent with what P04 already shipped.
