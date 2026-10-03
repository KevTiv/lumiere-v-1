# COV-15 — Vehicle service / inspection cost history

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov15-fleet-service-cost`  
**Stack base:** `codex/cov14-helpdesk-ticket-lifecycle`  
**Module/surface:** Fleet  
**Operator surface:** `/fleet`

## Bounded path

COV-15 now certifies a real service-cost and inspection-history path:

1. record one vehicle service through the visible **Service history** form;
2. enter the service amount and select the canonical journal, expense account and
   offset account;
3. post a balanced accounting Entry at the service date in the same reducer
   transaction;
4. persist `cost_amount`, the Entry's `currency_id`, and the canonical
   `account_move_id` on the service row;
5. resolve the exact service through `client_request_id` and that Posted move;
6. replay the same service request and prove idempotent success with no duplicate
   service row or journal entry;
7. record and reconcile one inspection through its stable request key;
8. replay both writes as `fixture.reader@example.test` and require HTTP 403
   with the exact effects unchanged.

The browser proof uses seeded `Truck #101`. The only trusted setup is one
company-scoped Fleet service type because service-type administration is not a
current Fleet UI surface.

## Service-cost accounting model

`FleetServiceRecord` now owns the canonical service-cost relation:

- `cost_amount: Option<f64>`;
- `currency_id: Option<u64>`;
- `account_move_id: Option<u64>`.

A cost-bearing `RecordFleetServiceParams` requires:

- positive finite `cost_amount`;
- stable `client_request_id`;
- `journal_id`;
- `expense_account_id`;
- `offset_account_id`.

The Fleet reducer delegates accounting correctness to the existing Accounting
domain:

1. `create_account_move` creates an idempotent `MoveType::Entry` with ref
   `FLEET-SERVICE:{client_request_id}`;
2. one debit line posts the service amount to the selected expense account;
3. one credit line posts the same amount to the selected offset account;
4. `post_account_move` enforces balance, account/company scope and the normal
   accounting-period lock;
5. only after successful posting is the Fleet row inserted with the move ID and
   its actual currency.

Because all calls run inside the same SpacetimeDB reducer transaction, a failed
accounting post rolls back the move, lines, vehicle update and Fleet service row
together.

A non-cost backend service record remains supported for compatibility. The
visible COV-15 Service form is cost-bearing and requires the accounting inputs.

## Exact effect contract

Both service and inspection writes use a normalized `client_request_id`.

For a service, `resolveFleetHistoryEffect` requires:

- exact organization, company and vehicle;
- exact request key;
- exact service type;
- exact monetary amount when cost-bearing;
- non-null `currency_id` and `account_move_id`;
- exactly one linked account move with the same organization/company/currency;
- the exact submitted journal;
- exactly two linked move lines using the submitted expense and offset accounts,
  with equal debit/credit equal to the service amount;
- linked move state = `Posted`.

For an inspection it requires exact organization/company/vehicle/request key and
typed outcome.

Duplicate exact rows or duplicate exact accounting moves fail closed. No
newest-row, timestamp or display-name correlation is used.

If a UI caller omits the request key, the client generates it before dispatch.

## Replay semantics

A same-key retry with the same semantic payload is intentionally
**idempotent-success**:

- service row count remains one;
- accounting move count remains one;
- inspection row count remains one;
- exact IDs and values remain unchanged.

A same request key reused for a different service vehicle/type/cost/journal/GL
account mapping or a different inspection vehicle/inspector/outcome is rejected
instead of silently aliasing two business events.

A read-only actor is denied before the idempotency shortcut.

## Accounting and period-lock proof

The Fleet native lifecycle suite now proves:

- a cost-bearing service creates exactly one service row;
- its linked move is same-scope, same-currency and Posted;
- exactly two move lines exist;
- debit to the Fleet expense account equals the service amount;
- credit to the offset account equals the service amount;
- total debit equals total credit;
- same-key retry does not create a second move;
- same-key changed-cost retry is rejected;
- closing the accounting period before the service causes the service write to
  fail and leaves neither a Fleet service row nor an accounting move behind.

## Contract disposition

**Contract release required and triggered.**

COV-15 now changes both the reducer/table contract and the read projection:

- `RecordFleetServiceParams` gains cost/journal/account fields;
- `FleetServiceRecord` gains `cost_amount`, `currency_id`,
  `account_move_id`;
- `fleet-service-records` exposes those fields plus `client_request_id`;
- `fleet-inspections` exposes `client_request_id`.

The integration follow-up additionally exposes existing `create_date` on both
history projections. No table or reducer signature change is required for this
delta. Omitted-timestamp readback fails closed until that projection is released.

## D/A/O/E proof

| Gate | Proof in this branch | Acceptance condition |
| --- | --- | --- |
| D | `test_history_is_immutable_and_idempotent` proves exact service cost → Posted balanced Entry linkage and retry uniqueness; `test_service_cost_respects_period_lock` proves closed-period atomic rollback; invalid scope/value coverage remains. | `run_all_fleet_tests` passes. |
| A | Fleet permission and company organization scope run first, followed by pure request validation and exact replay reconciliation. New effects then validate mutable vehicle/service-type/inspector relations. Cost-bearing writes retain Accounting's move/line create + post authorization and account/company checks. Reader browser replays require 403. | Authorized actor can post the cost; reader/cross-company invalid relations cannot. |
| O | `cov15-fleet-service-cost.spec.ts` drives the visible Service form with amount + journal + expense/offset accounts, verifies the Posted Entry and balanced lines, then drives the Inspection form. | Focused Playwright proof passes. |
| E | `fleet-history-effect.test.ts` requires exact request identity and, for cost-bearing service, exact amount plus one same-scope/same-currency Posted move. Projection tests lock all effect fields. | Unit/native/browser evidence green on one head. |

## Acceptance

COV-15 becomes **ACCEPTED** only when the same branch head records:

1. automatic contracts release/pin for the new Fleet service-cost contract;
2. query-hooks/UI typecheck + unit tests + i18n check;
3. `run_all_fleet_tests` on a live stack;
4. focused COV-15 Playwright proof;
5. branch CI green.

Until then the truthful disposition is **IMPLEMENTED — runtime acceptance
pending**.

## Exact replay integration follow-up

Service and inspection readback now compare every canonical request field,
including default/explicit timestamps, optional odometer values, normalized
provider/notes, inspector/outcome, and exact stored cost with canonical accounting
linkage. A scoped request key with multiple effects fails closed before payload
or mutable-reference matching. Historical replay does not depend on an inspector
remaining active. Missing read columns, including no-cost monetary absence, are
not evidence.

The native mismatched-replay cases preserve complete service/inspection, vehicle,
account-move and line snapshots. Both Fleet lifecycle and full Fleet reducer
suites passed on disposable SpacetimeDB 2.8.2; the query-hook suite passed 21
tests. Evidence:
[`cov15-fleet-replay-proof.json`](../evidence/cov15-fleet-replay-proof.json).

On `80cbfd29f9c9f4a82a848cd3d873a89d06d01ce4`, the clean P0 suite also passed
`cov15-fleet-service-cost.spec.ts` as part of 130 passes, 5 annotated capability
skips and 0 failures. That adds actual browser service/inspection, accounting
link, retry and reader-denial proof. Driver assignment, fuel history, canonical
employee/fuel effects, refresh/direct navigation, cross-company denial and
same-head branch CI remain open; Fleet is therefore calibrated at U2/`review`,
not U4/U5.
