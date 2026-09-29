# COV-15 — Vehicle service / inspection history

**Status:** IMPLEMENTED — bounded history slice; runtime acceptance pending  
**Branch:** `codex/cov15-fleet-service-cost`  
**Stack base:** `codex/cov14-helpdesk-ticket-lifecycle`  
**Module/surface:** Fleet  
**Operator surface:** `/fleet`

## Bounded path

This COV-15 slice certifies the existing service and inspection history path:

1. record one service through the visible **Service history** form;
2. resolve it through the exact stable `client_request_id`;
3. replay the same request and prove idempotent success with no duplicate row;
4. record one inspection through the visible **Inspection history** form;
5. resolve it through the exact stable `client_request_id`;
6. replay the same request and prove idempotent success with no duplicate row;
7. replay both accepted writes as `fixture.reader@example.test` and require
   HTTP 403 with both canonical rows unchanged.

The browser proof uses seeded `Truck #101`. The only trusted setup is creating
one company-scoped Fleet service type because the normal Fleet UI does not
currently expose service-type administration.

## Exact effect contract

The backend already had proper idempotency support before this slice:

- `RecordFleetServiceParams.client_request_id`;
- `RecordFleetInspectionParams.client_request_id`;
- both reducers normalize the key and return successfully without inserting a
  second history row when the same key already exists in the same org/company.

The missing piece was read visibility. COV-15 exposes the existing
`client_request_id` field on:

- `fleet-service-records`;
- `fleet-inspections`.

`resolveFleetHistoryEffect` then requires:

- exact organization;
- exact company;
- exact vehicle;
- exact `client_request_id`;
- exact service type for service records;
- exact typed outcome for inspections;
- one and only one matching persisted row.

Duplicate exact effects fail closed. No newest-row or timestamp correlation is
used.

If a hook caller omits `clientRequestId`, the client generates one before
dispatch so every UI write still has a stable readback identity.

## Replay semantics

Service and inspection writes are intentionally **idempotent-success**, not
stale-422 transitions.

A same-request replay:

- passes authorization first;
- finds the existing same-scope request key;
- returns success without inserting another row;
- leaves the same row ID and history contents unchanged.

A read-only actor is denied before that idempotency short-circuit.

The existing native lifecycle suite already covered duplicate suppression and
invalid org/company/value cases. This slice strengthens it to assert the exact
request key, organization, company, vehicle, service type / inspector and typed
outcome persisted on the single canonical row.

## Contract disposition

**Contract release required and triggered.**

Projection-only change:

- expose existing `fleet_service_record.client_request_id`;
- expose existing `fleet_inspection.client_request_id`.

No reducer signature, table column or business field was added.

## Monetary cost note

The milestone label historically says “service/inspection cost history,” but
the current Fleet domain has **no monetary service-cost field** in
`FleetServiceRecord`, no currency/accounting relation for that record, and no
cost input in the Fleet forms.

This bounded slice does **not** invent a finance model and does not claim
monetary-cost certification. A future Fleet/Finance slice must define the
canonical amount/currency/accounting relation before that title-level capability
can be considered complete.

## D/A/O/E proof

| Gate | Proof in this branch | Acceptance condition |
| --- | --- | --- |
| D | Existing `test_history_is_immutable_and_idempotent` now asserts exact request IDs and tenant/vehicle/service/inspection relations; `test_history_rejects_invalid_scope_and_values` retains cross-company/org and invalid-value denial. | `run_all_fleet_tests` passes. |
| A | Existing reducers check `fleet_vehicle:write` first and validate organization/company/vehicle/service-type/inspector scope. Browser reader replay requires 403 before the idempotency shortcut. | Authorized actor succeeds; reader and invalid scope do not mutate history. |
| O | `cov15-fleet-service-cost.spec.ts` drives Service and Inspection creation through the visible `/fleet` forms. | Focused Playwright proof passes. |
| E | `fleet-history-effect.test.ts` covers exact request identity, scope, vehicle, service type/outcome and ambiguity. Same-key browser retries must return success while preserving the exact snapshot. | Query-hook unit/native/browser evidence green on one head. |

## Acceptance

This bounded COV-15 history slice becomes **ACCEPTED** only when the same branch
head records:

1. automatic contracts release/pin exposing `client_request_id`;
2. query-hooks typecheck + unit tests;
3. `run_all_fleet_tests` on a live stack;
4. focused COV-15 Playwright proof;
5. branch CI green.

Until then the truthful disposition is **IMPLEMENTED — bounded history slice;
runtime acceptance pending**.
