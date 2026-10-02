# COV-15 — Vehicle service/inspection cost history

**Status:** IMPLEMENTED — contract release and runtime acceptance pending  
**Module/surface:** Fleet  
**Plan target:** vehicle/driver service-cost lifecycle  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /fleet (dedicated route now exists on main; /map stays the live-map view)

Existing operations (already reachable from the frontend command layer):

- `record_fleet_service` — hook: `frontend/packages/query-hooks/src/hooks/fleet.ts`
- `record_fleet_inspection` — hook: `frontend/packages/query-hooks/src/hooks/fleet.ts`

Canonical resources: fleet-service-records, fleet-inspections, fleet-vehicles

## Effect contract

Recorded service/inspection resolves by a stable key (vehicle_id + serviced_at/inspected_at or an idempotency key), never newest row.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release required (registry projection only).** The scaffold note that "the record
params carry no idempotency key" was wrong: `RecordFleetServiceParams` and
`RecordFleetInspectionParams` already carry `client_request_id`, and both reducers return without
inserting when a row in the same organization and company already has it. The projections did not
expose it, so a recorded row could not be named exactly. `crates/stdb-auth/assets/resource_registry.json`
now also projects `client_request_id` on `fleet-service-records` and `fleet-inspections` (no reducer or
table change).

Contract releases are automatic: pushing the registry or reducer change runs `.github/workflows/release-contracts.yml`, which publishes the next lumiere-contracts version and pins it on the branch. Pull its pin commit before continuing.

## Implementation

- **Reducers:** `record_fleet_service` / `record_fleet_inspection` (`spacetimedb/src/fleet/lifecycle.rs`)
  are immutable history writes, idempotent on `client_request_id`, scoped by organization and company,
  and never regress the vehicle's odometer (the vehicle keeps the maximum). The fleet form already sends
  a fresh UUID per submission.
- **Resolver:** `resolveFleetHistoryEffect` (`frontend/packages/query-hooks/src/hooks/fleet-history.ts`)
  resolves the one row for the request id in the same organization and company, for the same vehicle and
  service type (service) or typed outcome (inspection). A second match throws
  `AmbiguousOperationEffectError`; the same id in another company is a different request.
- **Hooks:** `useRecordFleetService` / `useRecordFleetInspection` (`fleet.ts`) generate a request id when
  the caller sends none (a keyless write can not be read back exactly and is not replay-safe), read the
  history resource back by it, and now surface reducer error messages.
- **Not in this slice:** the module has no cost field on service records, so "cost history" here is the
  immutable service/inspection history and odometer projection.

## Prerequisites / decisions

Confirm the route decision: `/fleet` exists on main, so COV-15 certifies `/fleet` and treats `/map` as a view.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | EXISTING — `test_history_is_immutable_and_idempotent` and `test_history_rejects_invalid_scope_and_values` in `spacetimedb/tests/fleet/lifecycle_test.rs` (`run_fleet_lifecycle_test`): same-request replay adds no row, text is normalized, an older inspection odometer does not regress the vehicle, cross-company / cross-organization / invalid values are rejected and persist nothing. No new Rust was needed. |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | WRITTEN — `check_permission(fleet_vehicle, write)` + company/vehicle/service-type/driver scope guards; reader replay of both writes asserted 403 in the spec. **Spec not run in this environment; runs in CI.** |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN — the service and inspection forms on `/fleet` in `frontend/web/tests/e2e/cov15-fleet-service-cost.spec.ts`, including an older-odometer inspection that must not regress the vehicle. **Spec not run in this environment; runs in CI after the contract release.** |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | Resolver unit test DONE (`fleet-history.test.ts`, 6 tests, passing; `fleet-lifecycle.test.ts` projection/readback contract, 5 tests, passing); browser assertions WRITTEN. A replay is an idempotent success (not 422), so the spec asserts the history snapshot and vehicle odometer are unchanged; the reader's 403 leaves them unchanged. |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
