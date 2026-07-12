# P15 — realtime & messaging

## The migration that silently deleted the previous prompt's feature

`prisma migrate diff --from-config-datasource` compares the **live database**
to the schema. Anything in that database which Prisma cannot *model* — a
PostGIS `geography` column, a GiST index, an EXCLUDE constraint — looks like
**drift to be removed**.

The generated messaging migration contained:

```sql
DROP INDEX "court_tenantId_resourceType_idx";
DROP INDEX "venue_geog_idx";
ALTER TABLE "venue" DROP COLUMN "geog";
```

A migration for **chat** would have deleted the entire **geo** feature added
one prompt earlier — and it did, in the working database. Forty-three
integration tests failed with:

```
The column `(not available)` does not exist in the current database.
```

An error that names nothing useful and points nowhere near the cause.

This is the **second time** Prisma's differ proposed destroying a load-bearing
database object. In P13 it wanted to `DROP COLUMN "courtId"` — which would have
taken `booking_no_overlap`, the double-booking defence, with it.

**The lesson is now a rule: Prisma's differ is a suggestion, not an oracle.
Read every generated migration before applying it.**

Two defences, both in place:

1. `venue.geog` is declared `Unsupported("geography(Point, 4326)")` in the
   schema, so Prisma **knows it exists** and stops proposing its removal.
2. The migration's destructive statements were stripped by hand, and the header
   documents exactly what was removed and why.

Verified by **replaying the entire migration chain into an empty database**:
43 tables, `geog` and its GiST index intact, `booking_no_overlap` intact,
messaging tables created. A migration history that only works forward from the
current state is not a migration history.

## Persist, then publish. Never the reverse.

Postgres is the source of truth. Centrifugo is a **delivery mechanism**.

Publish-then-persist looks equivalent and is not: the message flashes up in
every client, the database write then fails, and it is gone on refresh. **Users
saw it. It does not exist.** That is far worse than a message that arrives a
second late.

And because delivery is secondary, a Centrifugo outage must **not fail the
write**. An integration test points the client at a dead broker and asserts the
message still lands in Postgres. A message lost because a *WebSocket broker*
was restarting would be an absurd way to lose a write — and it would turn a
degraded-realtime incident into a total outage of chat.

## Blocking is global, and checked at send time

`UserBlock` has **no tenantId**. If a block were tenant-scoped, someone you
blocked at one venue could message you from another. That is not a blocking
feature; it is a loophole with extra steps.

It is checked **in both directions** — a one-directional check means the person
you blocked can still reach you — and at **send** time, not only at conversation
creation. Otherwise blocking someone leaves the existing DM wide open, which is
the case that actually matters.

## Channel names are an authorization boundary

`conv:{id}` means "everyone subscribed to this string can read every message
published to it". So a channel name assembled from unvalidated input is a data
leak, and one spelled inline somewhere else — `conv:abc` published,
`conversation:abc` subscribed — fails **silently**: no error, no failing test,
messages simply never arrive, and you spend a day inside the WebSocket.

`channels.ts` is the only place they are built, ids are validated as cuid, and
a ratchet fails the build on an inline `"conv:"` literal.

## The connection token is short-lived, and carries no capabilities

15 minutes, and the client refreshes.

A long-lived token **cannot be revoked**: block a user, or remove them from a
venue, and a token minted an hour ago still holds their subscription open. The
TTL *is* the revocation window.

The token carries `sub` and nothing else. Channel grants in the token would
freeze authorization for the token's lifetime — exactly the bug the short TTL
exists to bound. Subscriptions are authorized per-request, against the database.

## Smaller decisions

- **`markRead` is monotonic.** Without it, an out-of-order request (two tabs, a
  slow network) rewinds the read pointer and the unread badge resurrects
  messages the user already read. It looks like a bug in the badge.
- **`deleteMessage` is a tombstone.** A hard delete leaves a hole in every other
  participant's scrollback and breaks any reply to it.
- **A departed participant keeps their row** (`leftAt`), so history still shows
  they were there — but stops receiving and sending.
- **`blockUser` uses `createMany({ skipDuplicates })`**, not `create()`. A unique
  violation aborts the Postgres transaction (see P09/P10), and blocking someone
  twice is not an error.
