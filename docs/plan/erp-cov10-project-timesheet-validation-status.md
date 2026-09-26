# COV-10 — Approved timesheet validation → billing handoff

**Status:** PARTIAL — validate/reject proven (runtime acceptance pending); hook-level exact readback and billing handoff need a contract release  
**Module/surface:** Projects / Tasks  
**Plan target:** approved timesheet → billing/cost handoff  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /projects → Timesheets

Existing operations (already reachable from the frontend command layer):

- `validate_timesheets` — hook: `frontend/packages/query-hooks/src/hooks/projects.ts`
- `reject_timesheets` — hook: `frontend/packages/query-hooks/src/hooks/projects.ts`

Canonical resources: timesheets-to-validate, timesheets-unbilled

## Effect contract

Same timesheet ids read back `validation_status`; billing handoff proven through `timesheet_invoice_id` on `timesheets-unbilled`.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Correction to the scaffold:** `timesheets-to-validate` and `timesheets-unbilled` are
server-filtered worklists (`api-server/src/query_exec/worklists.rs`): the first returns only
`draft` rows, the second only `validated` + billable + not-invoiced rows, and the plain
`timesheets` resource does not project `validation_status`. So:

- a validated **billable** timesheet reads back exactly from `timesheets-unbilled`;
- a validated non-billable or a **rejected** timesheet is not visible in any projection.

Exact hook-level readback for both operations therefore needs `validation_status` added to the
`timesheets` default projection in `crates/stdb-auth/assets/resource_registry.json` — a
**contract delta** (batch it into the next `lumiere-contracts` release).

## Prerequisites / decisions

Seed project + employee + timesheet fixture.

## Slice 1 — validate / reject (implemented)

- **Reducers:** `validate_timesheets` / `reject_timesheets` (`spacetimedb/src/projects/timesheets.rs`)
  already rejected wrong-state transitions (so replays fail), billed entries, an empty
  rejection reason, and self-validation (validator = logger). No domain change was needed.
  `ProjectTimesheet` now derives `PartialEq` (Rust trait only; no schema or contract change).
- **Hooks:** unchanged. A readback inside `useValidateTimesheets` would falsely fail for
  non-billable entries until `validation_status` is projected (see above).

## D/A/O/E proof checklist (slice 1)

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | DONE — `test_validate_reject_rejects_replay` in `spacetimedb/tests/projects/wave_a_test.rs`: validate/reject replays, reject-after-validate and validate-after-reject, empty reason and self-validation — each rejected with the row unchanged |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | DONE — `check_permission(project_timesheet, validate)` + org/company guards; reader replays of validate and reject asserted 403 |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | DONE — Projects → Timesheets toolbar in `frontend/web/tests/e2e/cov10-project-timesheet-validation.spec.ts`: the admin (logger) is refused (422) through the UI, the `hr-project` persona validates and rejects |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | PARTIAL — the spec asserts the exact worklist placement (validated entry in `timesheets-unbilled` with org/company/status; rejected entry in neither worklist) after every replay. A resolver + hook readback waits on the `validation_status` projection |

## Slice 2 — billing handoff (pending)

Bill the validated entry (`bill-timesheets` toolbar action) and prove `timesheet_invoice_id`
links to exactly one invoice; `timesheets-unbilled` drops the entry once billed.

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
