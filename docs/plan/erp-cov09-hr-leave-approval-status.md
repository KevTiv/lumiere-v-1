# COV-09 — Leave request submit → approve/refuse

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** HR / Payroll  
**Plan target:** employee contract → leave/time/pay  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /hr → Leave

Existing operations (already reachable from the frontend command layer):

- `submit_leave` — hook: `frontend/packages/query-hooks/src/hooks/hr/leave.ts`
- `approve_leave` — hook: `frontend/packages/query-hooks/src/hooks/hr/leave.ts`
- `refuse_leave` — hook: `frontend/packages/query-hooks/src/hooks/hr/leave.ts`

Canonical resources: leave-requests, leaves-to-approve

## Effect contract

Same leave id, scoped by organization_id + company_id, reads back `state` after each transition; self-approval must be denied (separation of duties).

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** `leave-requests` exposes id, organization_id, company_id, employee_id, state



## Prerequisites / decisions

Needs an HR manager persona distinct from the employee persona in the first-org fixture.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov09-hr-leave-approval.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
