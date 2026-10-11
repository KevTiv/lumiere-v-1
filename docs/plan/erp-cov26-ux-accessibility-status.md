# COV-26 — One module quality pass per PR

**Status:** REVIEW — three bounded Reports quality passes implemented and locally verified; current-stack integration, contract release/pin, same-head CI, and hosted U4/U5 pending
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
Release and pin regenerated contract artifacts before acceptance. The fetched
remote contains the newer `v0.3.94` application pin on PR #155, while the current
top draft stack head regresses to `v0.3.91`; this branch's inherited `v0.3.80` pin
is also not a valid release base. Repair the stack to a monotonic contract base
first, then use the next available immutable tag after a live tag check.

## Reports / Analytics bounded pass (2026-10-10)

**State:** IMPLEMENTED locally — source read states, truthful definition handling,
and focused runtime proof complete; stack/release/CI and hosted acceptance gates
stay open.

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

**State:** REVIEW — deterministic implementation and exact-head local runtime proof
complete; contract release/pin and same-head CI pending.

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

This is local runtime evidence. It does not certify hosted production behavior or
U4/U5. Current-stack integration, same-head CI, and the contract release/pin remain
acceptance gates.

## Remaining gates

1. Integrate this divergent work onto the current UI stack and repair its contract
   pin regression: PR #155 pins `v0.3.94`, but the current top draft head pins
   `v0.3.91`.
2. From the clean integrated source, regenerate contracts, publish the next free
   immutable version after a live tag check, and repin the same source commit.
3. Run the required CI suite on that exact pushed head.
4. Collect hosted U4/U5 operator evidence on the same released head. Local Docker
   and browser evidence do not satisfy this gate.

## Prerequisites / decisions

COV-03..25 candidates.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | IMPLEMENTED locally — exact-head idempotency reducer test passed; conflicting replay returned 422 and preserved one canonical row |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | IMPLEMENTED locally — named operations use server-derived organization scope; company ownership validation passed; named reader replay returned 403 |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | IMPLEMENTED locally — production-build query-builder case passed against the exact-head local stack |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | IMPLEMENTED locally — exact creation/attachment, higher-id decoy exclusion, stale/denied preservation, reload, and exact saved-widget readback passed |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
