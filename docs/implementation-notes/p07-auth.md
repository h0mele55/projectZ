# P07 — auth, guards & permission middleware

## The bug the route table's ORDER prevents

`/api/t/:slug/bookings/:id/refund` also matches the pattern for
`/api/t/:slug/bookings`. `requiredPermission()` returns the **first** match.

If the generic rule came first, a refund would only require
`bookings.create` — which **every PLAYER has**. Any player could refund
their own booking, and keep going until the club's Stripe balance was
empty.

So the specific rules precede the generic one, and a test pins the **order**
rather than merely the outcome — a future edit that reorders the array
reintroduces the hole, and a test asserting only "refund needs
payments.refund" would still pass if someone rewrote the lookup.

**Negative-controlled:** moving the generic rule above the refund rule fails
4 tests, including _"a PLAYER cannot satisfy the refund route"_.

## The timing oracle in the obvious sign-in code

```ts
const user = await findUser(email);
if (!user) return null; // ← ~1ms
return bcrypt.compare(pw, user.hash); // ← ~100ms
```

That 100× gap is a **user-enumeration oracle**. An attacker times the
response and learns which email addresses have accounts — no error message
required. On a booking platform that leaks your customer list, and combined
with a password dump it turns credential-stuffing from a shotgun into a
rifle.

`dummyVerify()` runs a bcrypt comparison against a fixed hash on every
failure path — user not found, no password set (an OAuth-only account),
user deactivated. Skipping it on any **one** of those reopens the oracle for
that case.

A unit test measures both paths and asserts they stay within 3× of each
other.

## Login throttling ramps, because flat lockouts fail both ways

A flat "5 attempts then locked for 15 minutes" is wrong in both directions:

- **too weak** — an attacker with 10,000 stolen credential pairs needs only
  ONE attempt per account, so a per-account counter never trips;
- **too harsh** — it hands the attacker a free denial-of-service: spray five
  wrong passwords at a real customer and they cannot reach their booking.

So the first two failures are free (a typo must not be punished), then 5s,
then 30s, then a hard lockout only at a volume that is unambiguously
automated.

## HIBP fails OPEN, on purpose

If Have I Been Pwned is down, we allow the password.

- **fail closed** → HIBP's outage becomes _our_ outage. Nobody can sign up
  or reset a password. That is an availability dependency on a free
  third-party service.
- **fail open** → for the duration of the outage a user _might_ choose a
  breached password. That weakens a defence which is advisory anyway — the
  password is still bcrypt-hashed, the account is still rate-limited, MFA is
  still available.

The result carries a `degraded` flag so the fail-open is visible in logs. A
silent fail-open is how a security control quietly stops existing.

Only the first **five** characters of the SHA-1 leave the process
(k-anonymity). Sending the full hash would hand a third party a password-reuse
oracle.

## The JWT membership cap has a security consequence

A JWT rides in a cookie on **every** request. Past ~4KB it does not throw —
the cookie is silently dropped and the user is mysteriously logged out. A
player who plays at 200 clubs would carry 200 memberships, so the claim is
capped at 50.

But that creates a subtler bug: **absence from a truncated list proves
nothing.** If `checkTenantAccess` denied on "slug not in memberships[]", a
player would be locked out of their 51st club — a failure that only the most
engaged users ever hit, and which looks like a permissions problem rather
than a truncation one.

So the token carries `membershipsTruncated`, and the guard returns
`needs_db_check` instead of `forbidden` when it is set. The database is
asked; RLS is the backstop either way.

## Middleware order is the reverse of what feels natural

1. **Health probes first.** A liveness check that needs a valid session is
   not a liveness check, and a rate-limited one will get your pods killed
   during an incident — precisely when you least want that.
2. Read the token once.
3. Tenant access — _is this your club at all?_
4. Permission — _are you allowed to do THIS to it?_

Steps 3 and 4 are **defence in depth, not the defence**. Postgres RLS is the
guarantee: delete this file and a query bound to the wrong tenant still
returns zero rows. The middleware buys a clean 403 instead of a baffling
empty page, and a request that never reaches the database.

Note the matcher deliberately covers `/api/**`. A matcher that excludes it
is the classic way to ship a guard that protects the pages and leaves the
data wide open.

## The default-deny ratchet

An unprotected admin endpoint never ships as a _decision_. It ships as an
**omission**: someone adds `POST /api/t/[slug]/admin/refunds` and simply
does not think about the permission table. Nothing fails. The route works
beautifully — for everyone.

`route-permission-coverage.test.ts` walks `src/app/api/**/route.ts`, finds
every exported mutating verb under `/api/t/`, and fails the build if any of
them has no rule — naming the file and spelling out the fix.

**Negative-controlled:** adding an unprotected `POST /admin/refunds` fails
immediately with _"open to every authenticated member of that tenant —
including PLAYERs"_.

## Tenant enumeration

`checkTenantAccess` returns the **same** decision for "no such tenant" and
"a real tenant you don't belong to". Distinguishing them is an enumeration
oracle that lets an attacker map your customer list by URL-guessing.
