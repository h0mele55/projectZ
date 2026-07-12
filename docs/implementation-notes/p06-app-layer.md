# P06 — app-layer scaffolding

## What was ported, and what was rewritten

P06 says: _"Rewrite for playerz.bg domain (keep SHAPE, change CONTENT)."_
That line does a lot of work, and the split matters:

**Ported (genuinely domain-neutral infrastructure):** `lib/errors`,
`lib/observability` (logger, tracing, metrics, context), `lib/security`
(headers, csp, cors, safe-url, sanitize, encryption, rate-limit),
`lib/pagination`, `env.ts`.

**Rewritten (inflect's version is a compliance product):**

- `lib/permissions.ts` — inflect's `PermissionSet` is
  `controls / evidence / policies / risks / vendors / tests`. playerz's is
  bookings / courts / coaches / open play / payments.
- `lib/security/encrypted-fields.ts` — shrunk from 40+ compliance fields to
  **six**. An encrypted column cannot be indexed, filtered, or sorted, so
  the list has to earn its place: Venue.description, SessionChatMessage.body,
  CoachBooking.notes, Coach.bio, Booking.notes, User.mfaSecret.
- `app-layer/{context,types,execute}.ts` — the shape is inflect's
  (`execute(ctx, fn(ctx, db))` binding the RLS transaction); the content is
  playerz's.

An earlier attempt let the import closure run unchecked and it dragged in
`src/auth.ts` and `src/lib/auth/*` — which is **P07's** job — and
overwrote `app-layer/context.ts` with the compliance version. 105 type
errors. Reverted, and re-done as a tight hand-picked port.

## Permissions are compile-time typed

`Permission` is a union of the 22 declared strings, not `string`.

The failure mode of a stringly-typed ACL is a check that **always returns
false**. `hasPermission(ctx, 'bookings.cancle')` denies everyone, forever —
and that reads as _"correctly denied"_ in every test you would think to
write. Making it a compile error is the only reliable defence, so the type
IS the test (there is a `@ts-expect-error` case asserting exactly that).

The unit tests assert the **negative space** as hard as the positive:

- MANAGER cannot grant `admin.owner_management` or `admin.tenant_lifecycle`
  — a manager who can promote themselves to owner _is_ an owner.
- STAFF can cancel a booking but **cannot refund** it. Cancelling is
  reversible; a refund moves real money.
- PLAYER cannot refund, cannot see others' bookings, cannot adjust credit.
  A player who can refund can drain the club's Stripe balance.

## The job registry is closed, and fails at boot

A queue that accepts a job name it has no handler for fails at 3am, in a
worker log nobody reads, _after_ the customer was told their booking was
confirmed. The reminder simply never sends.

So `register()` rejects an unknown name, rejects a double registration, and
`assertRegistryComplete()` **refuses to start the worker** if any job in
`JOB_NAMES` lacks a handler — naming the missing ones. Loud at boot beats
silent at runtime.

## playerz's own navigation (the P02 debt, paid)

P02 refused to port inflect's `SidebarNav` because its items are
`/controls`, `/risks`, `/evidence`, `/policies`, `/vendors` — that is a
compliance IA, and shipping it would have given a court-booking app a
"Risks" tab.

`src/components/layout/AppNav.tsx` is the replacement: Play / Open play /
Coaches / My bookings, plus a permission-gated admin surface. A rendered
test asserts the nav carries **no compliance vocabulary**, so quietly
re-porting the old one turns red.

The design-system primitives _underneath_ it (Button, Tooltip, StatusBadge,
CalendarMonth) are the ported ones — those were genuinely domain-neutral,
which was the entire basis of the distinction.

Note: hiding a nav link is a **UI courtesy, not a security control**. The
link is still reachable by typing the URL. P07's permission middleware is
what actually denies access.
