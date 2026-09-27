# COV-24 — Order → delivery → collection exception workspace

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Distributor workspace  
**Plan target:** order through delivery/collection exception  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /distributor

Existing operations (already reachable from the frontend command layer):

- none (composition/system-wide track)

Canonical resources: sale-orders, stock-pickings, account-moves (reused)

## Effect contract

Workspace actions must reuse the canonical CRM/Sales/Inventory/Finance operations and their readbacks — no distributor-local state.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** none expected (composition over existing resources)



## Prerequisites / decisions

COV-04, COV-06, COV-08, COV-19 accepted.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `n/a` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
