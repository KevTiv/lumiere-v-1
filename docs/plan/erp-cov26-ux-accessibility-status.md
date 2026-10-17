# COV-26 — One module quality pass per PR

**Status:** REVIEW — current-stack integration, contract release/pin, exact-head CI,
and hosted-Maincloud browser proof complete; public hosted-application U4/U5
certification deferred
**Module/surface:** UX / Accessibility  
**Plan target:** common UI-quality pass  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: all T0 modules

Existing operations (already reachable from the frontend command layer):

- none (composition/system-wide track)

Canonical resources: n/a

## Effect contract

Loading/empty/error/denied states, keyboard/focus, viewports and reconnect evidence per module.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release required.** The Reports mutation pass exposes
the complete governed `dashboard-widgets` definition projection for deterministic
rendering, including `metadata` for exact canonical readback. It also adds the
internal `run_analytics_dashboard_widget_idempotency_test` operation identity.
Release and pin regenerated contract artifacts before acceptance. The repaired
PR #154 through PR #175 stack now has monotonic ancestry. The successful Release
contracts run `38155126649` published and pinned immutable
`lumiere-contracts@0.3.99` in commit `3f191c7f5`.

## Current-stack shared read-state rollout (2026-10-16)

**State:** REVIEW — successor to PR #182, based on integrated UI PR #218
(`29b5f80e`), retaining current main's domain operations and safeguards.

PR #182's shared collection helpers, shared tests, ModuleView shutdown behavior
and Accounting adoption are already incorporated. They are not reimported.
The remaining collection states and dialog/action gates are ported into Calendar,
CRM, Documents, Fleet, Helpdesk, Inventory, IoT, Messages, Proposals, Purchasing,
Sales and Workflows. HR, Expenses, Projects and Manufacturing extend their newer
partial safeguards without replacing current record links, company guards,
material/cost checks, finance operations or protected secondary panels.

Denied and failed primary reads suppress cached rows and prevent new mutations;
async form submission guards reject with an error rather than resolve as a
false success. The existing state contract still distinguishes loading, empty,
partial and ready data. The existing operations, RBAC and readback owners remain
unchanged; this slice needs no new contract release.

Import recovery is deliberately retained: source-read failures no longer unmount
CSV or assistant dialogs or clear their selected session. Optional `sourceState`
props block new file/submit actions and hide unsubmitted stale previews, while
keeping existing submitted request identity, status and result/recovery controls.
No mutation is automatically replayed. Mounted component regressions cover
readiness loss before submit, during a file read and after submission.

Validation limits remain explicit. TypeScript, component/model checks and source
integration are not sixteen-module authenticated browser certification. Existing
CRM `contact-category-actions.test.ts` has a baseline mismatch for `{ none: [] }`;
both helper and test are unchanged by this successor. The standard web unit script
does not currently execute that separately invoked test. A full runtime/keyboard/
denial/reconnect matrix and current-head remote CI remain required before claiming
general COV-26 acceptance. PR #218's accounting browser fixture is synthetic and
does not prove these other modules' backend effects.

PR #181 was closed as superseded after auditing its baseline, generated HR
descriptors, C4 database names, C8 policy count and CI/census changes against main
`979de024`; the stale baseline is not reapplied.

## Reports / Analytics bounded pass (2026-10-10)

**State:** IMPLEMENTED — source read states, truthful definition handling,
focused runtime proof, current-stack integration, contract release/pin, and
exact-head CI complete; public hosted-application certification stays open.

The self-serve query builder now renders an accessible loading status separately
from a successfully loaded source with zero rows. The shared stored-dashboard
source hook now preserves denied and dependency/query failures as typed issues,
bounds automatic retry, and exposes explicit refresh/readback recovery. The
query builder and stored-dashboard dialog render status/alert semantics, suppress
partial data after a failed read, and provide a keyboard-reachable retry. Duplicate
registry resources that map to the same model table are collapsed into one source
option. Focused pure-state tests keep unselected, loading, refresh, denied,
query-error, legitimate-empty and ready states distinct.

The complete Playwright file passed on this exact worktree in 17.0 seconds (six of
six tests, one worker) against an optimized Next.js 16.1.6 `next build` / `next
start` server, the exact-head local module `lumiere-cov26-e2e`, and the rebuilt API
on port 8097. Controlled query responses proved loading, mobile empty layout,
denied/error rendering, bounded retry, and keyboard focus recovery. The stored
dashboard browser path also proved that an unsupported persisted operator renders
a card-scoped alert instead of plausible data.

Resolver tests now reject malformed filters, unknown operators, invalid bindings,
missing/unparseable timestamps, undeclared measures, non-numeric measures, and
unknown aggregations. Versioned query-builder configuration declares its time and
measure bindings and fail-closed completeness policies. The renderer surfaces the
diagnostic and rejected-row count; dashboard export stays disabled on source
failure. COV-D05, COV-D06, and COV-D07 are resolved for this bounded Reports path.

## Reports widget create-and-attach mutation pass (2026-10-10)

**State:** ACCEPTED for this bounded Reports pass — deterministic implementation,
exact-head local runtime proof, contract release/pin, hosted-Maincloud browser
proof, and same-head CI complete. Public hosted-application U4/U5 certification
is deferred and does not follow from this bounded acceptance.

The query builder no longer finds a created widget by display name or greatest id.
Each save attempt now carries one versioned creation request id in the canonical
`DashboardWidget.metadata` field. The request id is retained for the same payload
after an unresolved result. The STDB producer validates company ownership, treats
an identical replay as idempotent, rejects request-id reuse with different input,
and fails if the key already maps to multiple canonical rows.

`useCreateDashboardWidget` now performs exact pre/post readback by organization and
creation request id and returns the canonical widget reference. The query builder
passes that exact id to `add_widget_to_dashboard`. The attachment hook reports
success only after the exact dashboard's canonical `widget_ids` relation contains
the widget. Successful UI feedback links to the resulting widget or dashboard
record filter.

Focused resolver tests pass four of four, both query-hooks and web typechecks pass,
and the SpacetimeDB crate passes `cargo check` with only pre-existing warnings. The
focused Playwright case deliberately creates a higher-id same-name widget with a
different request id. The case fails if the UI returns to name/newest matching.

On 2026-10-11, the exact-head SpacetimeDB module was published to a disposable
local database. `run_all_core_tests` and
`run_analytics_dashboard_widget_idempotency_test` passed. An optimized Next.js
16.1.6 `next build` / `next start` server and the exact-head API then ran the
complete COV-26 Reports browser file with one worker: authentication and all five
Reports scenarios passed. The visible create-and-attach case passed in 5.1 seconds
and proved that only the exact lower-id widget was attached while the higher-id
decoy was excluded. A conflicting replay returned 422, a named reader-persona
replay returned 403, the canonical effect row remained singular after both, and a
full reload reopened the saved dashboard with the exact widget visible.

On 2026-10-11, the production module was also published without data deletion to
Maincloud database `lumiere-v1-j1uo0`. Owner-restricted provisioning produced
exactly one current credential, active membership, and active role assignment for
each of the seven accepted personas. The fixture health gate also found every
required COV-03 through COV-24 module row.

The final non-destructive republish used the exact production artifact with
SHA-256 `2e529632b1d982a22d6df3279c2ccab52884e12efa94fd1c8917edfbfa1ee270`
and `--delete-data=never`. The deployed schema hash remained
`0ae887e84d49c70bac3e44b7c0c34319c8d56ff100f463f682014e284a5b7f8e`.
The seven-persona fixture health check then returned `healthy: true` with no
failures.

An optimized Next.js 16.1.6 production build and the exact API source then ran the
complete six-test COV-26 Reports browser file against that hosted database. All six
tests passed with one worker. The canonical create-and-attach case retained the
exact success link across report cache refreshes, rejected a conflicting replay,
denied the reader persona, and proved the dashboard relation excluded the
higher-id same-name decoy.

This is hosted-data runtime evidence. The web and API processes are still local
loopback services, so it is not public hosted-application U4/U5 certification.

The exact implementation head `35c3ee1696794563472c356a9ff038211bbd43d7` passed all eight
reported GitHub checks, including the targeted Playwright smoke, E2E gate,
frontend contracts, semantic index, i18n, and security checks. No unresolved
review thread remained when this evidence was recorded.

## Workforce bounded pass (2026-10-13)

**State:** IMPLEMENTED LOCALLY — release-environment browser execution and
same-head CI remain open.

HR/Payroll, Projects/Tasks, and Expenses now pass their primary collections to
the shared typed module-data-state boundary. Loading remains distinct from a
successful empty result; server failures expose an alert and retry; 401/403 reads
fail closed as denied; and cached rows from denied or unclassified failures are
not reused by pickers, joins, dialogs, or dashboards. Concrete 5xx refresh
failures may retain rows only with an explicit partial/stale warning.

`cov26-workforce-resilience.spec.ts` adds a seeded browser matrix for successful
no-result empty states, read-only mutation-control denial, keyboard dialog focus
and return, 320px/390px viewport reachability, and offline reconnect followed by
exact canonical-id readback for employees, projects, and expenses. Shared pure
tests cover loading, empty, error, partial, denied, retry, stale-row suppression,
and keyboard tab navigation. The browser file was discovered locally; runtime
execution against the selected release environment remains required.

## Remaining gates

1. If public hosted-application certification is required, deploy the accepted
   head to the selected public web/API environment and record its application
   URL. This deployment is deferred and is not part of the Maincloud module
   publish.
2. Repeat the U4/U5 operator evidence through that public URL. The current
   production-build browser proof uses hosted Maincloud data but loopback web/API
   processes.

## Prerequisites / decisions

COV-03..25 candidates.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | IMPLEMENTED locally — exact-head idempotency reducer test passed; conflicting replay returned 422 and preserved one canonical row |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | IMPLEMENTED locally — named operations use server-derived organization scope; company ownership validation passed; named reader replay returned 403 |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | IMPLEMENTED against hosted Maincloud — the production-build query-builder case passed through the visible save action; public hosted-application repeat remains open |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | IMPLEMENTED against hosted Maincloud — exact creation/attachment, higher-id decoy exclusion, stale/denied preservation, reload, and exact saved-widget readback passed |

## Acceptance

This bounded Reports pass is accepted for implementation on exact head
`35c3ee1696794563472c356a9ff038211bbd43d7`: the required contract release is
pinned and same-head CI is green. COV-26 remains at `REVIEW` as a program-level
track because a bounded Reports pass does not certify every T0 module or establish
public hosted-application U4/U5 evidence.
