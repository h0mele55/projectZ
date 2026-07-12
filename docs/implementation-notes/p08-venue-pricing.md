# P08 — venue read side & pricing

## The DST bug this engine exists to avoid

A court's opening hours are a **wall-clock fact**: "09:00–22:00, local
time". They are not an instant. Sofia is UTC+2 in winter and UTC+3 in
summer.

The naive implementation — `new Date(day + 'T09:00:00Z')`, or worse,
building dates in the _server's_ timezone — is:

- correct on a laptop in Sofia,
- correct in a UTC CI runner for half the year,
- and then quietly shifts every slot by an hour at the end of March.

Players arrive an hour late for their court, and nothing in the codebase
looks wrong.

So opening hours are interpreted in the **venue's** timezone and converted
to absolute UTC _per day_, via `fromZonedTime`, which resolves the offset
for that specific date. A test pins it: 09:00 Sofia is `07:00Z` in January
and `06:00Z` in July — the same wall clock, two different instants.

## The half-open range appears in three places and must agree in all three

The Postgres EXCLUDE constraint uses `'[)'`. So does `computeSlots`'s
overlap check. So does the booking span validation.

If the app's notion of "overlap" disagreed with the database's, the UI
would offer a slot the INSERT then rejects — and that presents as a _race
condition_, which it isn't. You would look for it in the wrong place for a
long time.

## Pricing: containment, not overlap

A "peak 18:00–22:00" rule must **span the entire booking** to apply.

A booking of 17:00–18:30 _overlaps_ peak by thirty minutes. Charging the
peak rate for it means the club is billing peak prices for an off-peak
hour, and the player is right to call it a bug. Rule conditions are
evaluated as containment.

## `ruleTrace` is not a debugging luxury

When a player asks _"why did this cost €36?"_, support needs an answer, and
"the engine decided" is not one. Every rule considered is returned —
matched or not — with a reason.

The trace distinguishes **"did not match"** from **"would have matched, but
a higher-priority rule already won"**. Collapsing those two into one is what
makes a club's own pricing impossible to debug.

## Small money decisions that never reconcile

- `Math.round`, not `Math.floor`. Flooring systematically under-charges by
  up to a cent on _every_ booking. It is small, it is the club's money, and
  it never adds up.
- A `fixedPriceCents` rule **overrides** a multiplier when both are set.
  "€40 flat on holidays" must not also get the ×1.5 weekend surcharge
  stapled on top.
- The engine **sorts by priority itself** rather than trusting the caller's
  `ORDER BY`. A repository refactor that drops the order clause would
  otherwise silently start applying the wrong price, and nothing would fail.

## The query-shape ratchet

Two failure modes that pass every functional test and then take the site
down for your most successful customer:

- **D1 — a Prisma read inside a loop.** 12 queries with seed data, 4,000 on
  a real venue page. The code is _correct_, just catastrophically slow.
- **D2 — a `findMany` with no `take`.** Three rows in dev, 200,000 in
  production, then the pod OOMs.

Neither is caught by types, tests, or review. Both are caught here, and both
are negative-controlled.

## Public venue search is deliberately cross-tenant

It is the one read that must span tenants — a player looking for a padel
court in Sofia does not know which club owns it. That makes it the most
dangerous query in the product.

An integration test therefore asserts that granting it did **not** weaken
RLS for anything else: the public search sees both venues, while a
tenant-bound session still sees only its own.

`clampLimit` is not advisory either. Without a ceiling, this unauthenticated
GET is a one-request DoS.
