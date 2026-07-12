# P12 — consolidation, the coverage gate & the container

## The coverage gate: 23% or 88%?

The honest answer to "what is our coverage?" depends entirely on what you
count, and the two numbers tell very different stories.

Counting **all** of `src/lib` + `src/app-layer`: **23.5%**.

That number is dominated by infrastructure ported _verbatim_ from
inflect-compliance — observability, storage, rate-limit, csp, cors. It is
tested upstream, in the repository that owns it. Counting it here would make
the only route to a green gate "write tests for somebody else's
already-tested code", which is theatre, not testing.

Counting the code **P04–P11 actually authored** — the booking, pricing,
availability, refund and session use cases; the RLS middleware and pg-error
mapping; Glicko-2; the permission model; the auth guards: **88% lines, 85%
branches**.

That is the number that means something, because that is the code where a
regression costs you a double-booked court or a player refunding themselves.

So the gate's SCOPE is the authored domain logic, its FLOOR is P12's 70%,
and it is now **blocking**.

Two ratchets keep that honest:

- the floor may never silently drop below 70/60;
- **the scope may not silently narrow.** Excluding enough code makes 100%
  trivial — that is how a coverage gate quietly stops meaning anything. The
  meta-ratchet asserts that `usecases`, `lib/db`, `lib/auth` and
  `permissions.ts` all remain inside it.

## The meta-ratchet caught this very change

Changing `jest.thresholds.json`'s shape broke
`test-infra-integrity.test.ts`, which was still asserting the old contract.

That is the ratchet doing precisely its job: the test spine noticed that
somebody (me) had altered it, and refused to go quietly.

## The container

- **Non-root** (`uid 1001`). A container running as root turns any RCE in a
  dependency into root _in the container_ — and with a shared kernel that is
  one namespace escape from the host. Verified: `docker run … id` reports
  `uid=1001(nextjs)`.
- **Health check does not touch the database.** A liveness probe that queries
  Postgres reports the _database's_ health, not the pod's — so a brief
  database blip makes the orchestrator kill every healthy pod at once,
  turning a recoverable incident into an outage. Verified: the container
  answers `/api/health` with no `DATABASE_URL` reachable.
- **Trivy now scans the IMAGE, not just the filesystem.** The fs scan sees our
  dependency tree; it does _not_ see the base image. A CRITICAL in the
  alpine/node layers ships to production just as surely as one in
  `package.json`.

## E2E needs a seeded database, or it passes by looking at nothing

`globalSetup` migrates and seeds before the run.

Without it, `/venues` renders its empty state and every discovery spec passes
by asserting nothing. A suite that is green because it is staring at an empty
page is worse than no suite: it is a green light that means nothing.

## The image scan immediately earned its keep

The very first run of the new Trivy **image** scan failed the build on
`undici` **CVE-2026-12151** (HIGH — DoS via unbounded memory growth).

The interesting part is *where* it was:

```
usr/local/lib/node_modules/npm/node_modules/undici  → 6.26.0
```

**Not in our dependency tree at all.** It is bundled inside **npm itself**,
shipped in the `node:24-alpine` base image. No `overrides` entry in our
`package.json` can reach it, `npm audit` cannot see it, and the Trivy
*filesystem* scan structurally cannot see it either — it only reads the
project's own manifests.

That is precisely the gap the image scan exists to close, and it found a real
one on its first run.

The fix is not to patch npm. It is to **remove npm from the runtime image
entirely**:

- a production container has no business shipping a package manager — npm can
  reach the network and write to disk, which makes it a ready-made
  download-and-execute primitive for any RCE that lands in the app;
- and removing it takes the bundled CVE with it.

Next is invoked directly (`./node_modules/.bin/next start`) instead of through
`npm run start`. Verified: npm is gone, the container still boots as uid 1001,
and `/api/health` still answers. Image scan is now clean.

(We *also* added an `undici: ^7.28.0` override, which fixes our own tree.
Both were needed; neither alone was sufficient.)
