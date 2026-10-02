# COV-10 — Approved timesheet validation → billing handoff

**Status:** IMPLEMENTED — validate, reject and billing handoff with exact readback (contract release and runtime acceptance pending)  
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

**Correction to the scaffold, and a correction to this card's earlier text.** `timesheets-to-validate` and
`timesheets-unbilled` are server-filtered worklists (`api-server/src/query_exec/worklists.rs`): drafts, and
validated + billable + not-invoiced rows. The plain `timesheets` resource already projects `validation_status`
(it did when this slice was written; the earlier note that it did not was wrong), so validate and reject read back
exactly from it, including a rejected or non-billable entry that no worklist shows.

The billing link is the one missing field: `timesheets` did not project `timesheet_invoice_id`, so a billed entry
(which leaves `timesheets-unbilled`) could not name its invoice. `crates/stdb-auth/assets/resource_registry.json`
now also projects `timesheet_invoice_type` and `timesheet_invoice_id` on `timesheets` (registry only, no reducer or
table change; released automatically on push).

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

## Slice 2 — hook readback and billing handoff (implemented)

- **Resolvers:** `resolveTimesheetStatusEffects` and `resolveTimesheetBillingEffect`
  (`frontend/packages/query-hooks/src/hooks/project-timesheet-effects.ts`). A batch resolves only when **every**
  requested id is exactly one row in the same organization (and company) with the expected `validation_status`;
  billing resolves only when every id carries a `timesheet_invoice_id` and they all name the same invoice (one
  `bill_timesheets` call creates one invoice). Duplicate rows raise `AmbiguousOperationEffectError`.
- **Hooks:** `useValidateTimesheets` → `validated`, `useRejectTimesheets` → `rejected`, `useBillTimesheets` → the
  billed invoice, resolved as one `account-moves` row in the same organization and company (it reuses
  `resolveSubscriptionInvoiceMove`). Reducer errors now carry their message instead of a generic one.
- **Domain:** `bill_timesheets` (`spacetimedb/src/accounting/journal_entries.rs`) already requires validated,
  billable, not-yet-invoiced entries in the company, so a replay is rejected ("already invoiced"); its native proof
  (`wave_a_test.rs`, bill then a second bill) already existed.

| Gate | State |
| --- | --- |
| D | EXISTING — `test_validate_reject_rejects_replay` and the bill / already-invoiced / closed-period tests in `spacetimedb/tests/projects/wave_a_test.rs`. No new Rust. |
| A | WRITTEN — `account_move:create` for billing; reader replays of validate, reject and bill asserted 403. **Spec not run in this environment.** |
| O | WRITTEN — `cov10-project-timesheet-validation.spec.ts` now also bills the validated entry from the Timesheets toolbar and reads the invoice link. **Not run in this environment; needs the contract release.** |
| E | Resolver unit tests DONE (`project-timesheet-effects.test.ts`, 7 tests, passing); browser assertions WRITTEN: rejected and validated read back from `timesheets`, the billed entry carries one invoice that exists in the company, leaves `timesheets-unbilled`, and a replay is 422 with the snapshot unchanged. |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
