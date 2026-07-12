# P03 — the test spine

## The playbook has a circular dependency

P03's harness cannot be proven without tables: `seedTenant()` creates a
`VenueOrg` + `User` + `TenantMembership`, and the two integration tests
must demonstrate RLS isolation against real rows. But those models are
P04's deliverable.

Resolution: **P03 lands the minimum tenancy schema its own harness needs
to prove itself** — `VenueOrg`, `User`, `TenantMembership`, the `Role` /
`MembershipStatus` enums, and the RLS baseline. P04 expands it
(`PlayerProfile`, `UserSession`, `PasswordResetToken`, `Invite`,
`TenantSecuritySettings`, `TenantCustomRole`, `ApiKey`, the full enum set,
and RLS on the tables it adds).

An unprovable harness is worse than no harness, so the alternative —
shipping helpers nothing exercises — was not acceptable.

## The coverageThreshold trap

P03's prompt puts `coverageThreshold` at the TOP LEVEL of a multi-project
jest config. **Jest silently ignores it there.** The run exits 0 no matter
how far below the floor coverage actually is. The port source hit exactly
this and documents it: its thresholds were "documented but NEVER enforced"
until enforcement moved to the CLI flag.

We do both:

1. thresholds live INSIDE each project block, where they are honoured; and
2. `jest.thresholds.json` is the single source of truth the CI gate passes
   via `--coverageThreshold`, which IS enforced (exit 1 + a violation
   message).

`tests/guardrails/test-infra-integrity.test.ts` asserts the top-level key
stays absent. Moving it back turns the ratchet red.

## Coverage is reporting-only until P12

The 70% floor on `src/lib` + `src/app-layer` is a **P12** deliverable. P02
ported ~21 `src/lib` files that no unit test covers yet, so enforcing the
floor today would block every PR on debt the playbook does not schedule
until the end. The `coverage` job runs, reports, and warns — it is not in
the required checks. **P12 drops `continue-on-error` and adds it.**

## Prisma 7 notes

- `datasource db { url = env(...) }` is rejected. Connection URLs live in
  `prisma.config.ts`.
- `new PrismaClient({ datasources: … })` and `{ datasourceUrl: … }` are
  BOTH rejected. Prisma 7 requires a driver adapter: `@prisma/adapter-pg`.

## Things the harness proves about itself

These are not decorative — each was verified by breaking it on purpose:

| Property                                     | Negative control                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| RLS genuinely isolates tenants               | `DISABLE ROW LEVEL SECURITY` on `tenant_membership` → the unscoped session returns 2 rows and all 3 tests fail with "RLS is failing OPEN" |
| The meta-ratchet catches a lost jest project | renaming the `integration` project → red                                                                                                  |
| The meta-ratchet catches the coverage trap   | moving `coverageThreshold` to the top level → red                                                                                         |
| The `@/` alias resolves                      | deleting `moduleNameMapper` → `harness-sanity` red                                                                                        |
| The no-raw-tokens ratchet bites              | injecting `text-slate-700` → red, with file:line                                                                                          |

## Why `FORCE ROW LEVEL SECURITY`

`ENABLE` alone does not apply the policy to the table's OWNER — and
migrations run as the owner. Without `FORCE`, the policy would be untested
in exactly the session that matters most.

## Why the RLS policy uses `current_setting('app.tenant_id', true)`

The two-argument form returns NULL when the setting is unset; the bare
one-argument form RAISES. With NULL, `tenantId = NULL` evaluates to NULL —
not TRUE — so an unscoped session matches **zero rows**. That is the
fail-closed property tenant isolation rests on. Both spellings "work" on
the happy path, so only a test pins the difference:
`tests/unit/helpers/rls.test.ts` asserts the bare form never appears in a
migration.

## The CI secret-detection gate was a no-op

`scripts/detect-secrets.sh` defaults to scanning **staged** files
(`git diff --cached`) — that is what makes it useful as a pre-commit hook.
CI has no staged files, so the "Gate: secret detection" step was scanning
**nothing** and passing vacuously on every PR from #1 onward.

It now runs `--all`. Three findings surfaced immediately, all genuine
false positives (CI boot values and Stripe's documented test placeholder),
each annotated with the script's own line-level
`pragma: allowlist secret` and a reason.

A gate that cannot fail is worse than no gate: it buys false confidence.
