# COV-20 — Configure → execute → export one scheduled report

**Status:** IMPLEMENTED — record-run slice; runtime acceptance pending  
**Module/surface:** Reports / Analytics  
**Plan target:** configure, execute, drill and export one report  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /reports

Existing operations (already reachable from the frontend command layer):

- `create_scheduled_report` — hook: `frontend/packages/query-hooks/src/hooks/reports.ts`
- `record_report_run` — hook: `frontend/packages/query-hooks/src/hooks/reports.ts`

Canonical resources: scheduled-reports

## Effect contract

Run effect resolves by (report id, run_count/last_run) — deterministic totals checked against the source query.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release required.** `scheduled-reports` did not expose `last_run` / `run_count` (now added to the registry projection).

Contract releases are automatic: pushing the registry or reducer change runs `.github/workflows/release-contracts.yml`, which publishes the next lumiere-contracts version and pins it on the branch. Pull its pin commit before continuing.

## Slice 1 — record one scheduled report run (implemented)

- **Reducer:** `record_report_run` (`spacetimedb/src/analytics/reports.rs`) now rejects (a) an
  owner-report schedule (those advance through `complete_scheduled_owner_report_run` and their run
  ledger), (b) an inactive schedule, and (c) a `next_run` that is not later than the current
  `next_run`. Before, every replay bumped `run_count` and re-stamped `last_run`.
- **Projection:** `scheduled-reports` in `crates/stdb-auth/assets/resource_registry.json` now
  exposes `last_run` and `run_count` (contract release trigger; pull the pin commit).
- **Hook:** `useRecordReportRun` reads the exact schedule's `run_count` before dispatch, then proves the
  effect when the same id + organization reads back with `run_count + 1` and a `last_run` stamp
  (`resolveReportRunEffect`, `report-run-effect.ts`). Server errors now surface.
- **UI:** unchanged — the existing Scheduled tab `Record run` action (`entity-action-record-run`)
  and form.
- **Not in this slice:** configure (create schedule) and export/drill proof, and a deterministic
  dataset check of report totals against the source query.

## Prerequisites / decisions

Contract release pin for the new `scheduled-reports` columns (automatic on push). Deterministic dataset fixture is still needed for the totals check.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | WRITTEN — `test_record_report_run_is_exact_and_replay_safe` in `spacetimedb/tests/analytics/relational_integrity_test.rs` (wired into `run_all_analytics_tests`) |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | WRITTEN — `check_permission(scheduled_report, write)` + org match; reader replay asserted 403 in the spec |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN — `frontend/web/tests/e2e/cov20-report-run.spec.ts`; not yet run against a stack |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | DONE (resolver) — `report-run-effect.test.ts`; snapshot assertions written in the spec |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
