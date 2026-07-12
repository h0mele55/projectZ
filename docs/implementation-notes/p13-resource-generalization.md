# P13 — sport registry & Court → Resource

## The migration Prisma wanted to write would have deleted the crown jewel

For the `courtId` → `resourceId` rename, `prisma migrate diff` generates:

```sql
ALTER TABLE "booking" DROP COLUMN "courtId",
                      ADD COLUMN  "resourceId" TEXT NOT NULL;
```

That is **data loss** — every booking's resource reference destroyed — and it
takes **`booking_no_overlap` with it**, because an EXCLUDE constraint on a
dropped column is dropped too.

The double-booking defence, the single most important guarantee in the
product, would have silently disappeared in a migration whose diff looks
entirely routine. Prisma's differ cannot see a rename; it only sees "a column
went away, a column appeared".

So the migration is **hand-written**:

```sql
ALTER TABLE "booking" RENAME COLUMN "courtId" TO "resourceId";
```

Postgres carries dependent indexes, foreign keys and **constraints** across a
rename automatically. Verified against the live database rather than assumed:

```
booking_no_overlap -> EXCLUDE USING gist ("resourceId" WITH =, tstzrange(…) WITH &&)
```

And the proof that matters: **all 42 integration tests still pass**, including
the P09 test that races two `createBooking` calls inside Postgres and the P10
test that races eight players for four seats. The rename touched the booking
spine and broke nothing.

The physical table stays `court` (via `@@map`). Renaming the table *and*
rewriting every FK in the same migration is exactly how you lose the
constraint; that rename is a separate, later migration.

## Endurance sports are not bookable, and that is a schema fact

You do not reserve a 10km route for an hour. You agree to meet at a point at a
time.

Modelling running as bookable would force a fake `Resource` row for every
single run — and, worse, the EXCLUDE constraint would then stop two groups
running the same trail at once, which is absurd.

So `OpenPlaySession.resourceId` is **nullable**, with a CHECK enforcing that a
session has either a resource **or** a meeting point, never neither:

```sql
CHECK (
  ("locationMode" = 'RESOURCE'      AND "resourceId" IS NOT NULL)
  OR
  ("locationMode" = 'MEETING_POINT' AND "meetingPointLat" IS NOT NULL
                                    AND "meetingPointLng" IS NOT NULL)
)
```

## Sport behaviour is DATA, and two ratchets keep it that way

`if (sport === 'CHESS')` looks harmless with three sports. With sixteen it is
unmaintainable — and the part that actually hurts is that it fails **silently**.
Add a seventeenth sport and every branch you miss does not throw; it falls
through to the else, and the new sport quietly behaves like tennis. Nobody
finds out until a pickleball player is offered a 90-minute padel slot.

- **`no-sport-conditionals`** fails the build on a hard-coded `sport === "…"`
  in a component or a route.
- **`sport-registry-completeness`** is a **four-way cross-walk**: Prisma enum
  ⟷ registry ⟷ `messages/bg.json` ⟷ `messages/en.json`.

That second one matters more than it looks. Add a sport to the enum and forget
the Bulgarian label and *nothing fails* — a Bulgarian user simply sees the raw
string `PICKLEBALL` where a sport name should be. Add it to the registry and
forget the enum, and the **database** rejects the write, in production, for the
first person who tries to book one.

**Negative-controlled:** deleting the Bulgarian label for CHESS fails with
*"MISSING (a user sees the raw enum key): CHESS"*. There is also a test that
the label is not merely the enum key pasted back in — the laziest way to
"satisfy" a cross-walk.

## `SPORTS` is typed `Record<SportType, SportConfig>`

So adding a sport to the Prisma schema without a config is a **compile error**,
not a runtime surprise.

## Glicko-2 survives only for chess

openskill (Weng-Lin) has **native team support**, which is what padel,
volleyball and football actually need: a 2v2 padel result is *one observation
about four players*, not four independent 1v1s. Glicko-2 has no team model, so
faking it means inventing a "team rating" that belongs to nobody.

Chess is genuinely 1v1, and Glicko-2 is the established standard there — it is
what Lichess uses. An openskill rating for chess would be incomparable to every
rating a player already has. A registry test asserts `GLICKO2` appears for
chess and nothing else.
