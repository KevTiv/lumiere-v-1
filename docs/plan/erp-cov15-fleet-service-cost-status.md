# COV-15 — Vehicle service/inspection cost history

**Status:** SCAFFOLDED — implementation pending  
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

**Contract release possibly required.** projections expose vehicle_id, company_id and serviced_at/inspected_at, so a natural-key readback needs no release; the record params carry no idempotency key, so replay-safety needs a params change (contract release)

Contract releases cannot be cut from CI or from the authoring session; stop at IMPLEMENTED with the registry diff prepared and hand off `make publish-contracts VERSION=x.y.z` to a maintainer with `lumiere-contracts` access.

## Prerequisites / decisions

Confirm the route decision: `/fleet` exists on main, so COV-15 certifies `/fleet` and treats `/map` as a view.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov15-fleet-service-cost.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
