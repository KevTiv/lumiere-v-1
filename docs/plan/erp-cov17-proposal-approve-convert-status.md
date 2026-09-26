# COV-17 — Versioned review → approve → convert to sale order

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Proposals  
**Plan target:** versioned review → canonical conversion  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /proposals

Existing operations (already reachable from the frontend command layer):

- `approve_proposal` — hook: `frontend/packages/query-hooks/src/hooks/proposals.ts`
- `convert_proposal_to_sale_order` — hook: `frontend/packages/query-hooks/src/hooks/proposals.ts`

Canonical resources: proposals, sale-orders

## Effect contract

Same proposal id reads back approved `status`; conversion resolves the created sale order through the proposal→order relation.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** `proposals` exposes status, sale_order_id and project_id, so approve and convert resolve through the proposal's own relations



## Prerequisites / decisions

Reviewer persona distinct from author.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov17-proposal-approve-convert.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
