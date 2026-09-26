# COV-11 — Expense sheet submit → approve → post → reimburse

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Expenses  
**Plan target:** receipt-backed expense submit/approve/post/reimburse  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /expenses

Existing operations (already reachable from the frontend command layer):

- `submit_expense_sheet` — hook: `frontend/packages/query-hooks/src/hooks/expenses.ts`
- `approve_expense_sheet` — hook: `frontend/packages/query-hooks/src/hooks/expenses.ts`
- `post_expense_sheet` — hook: `frontend/packages/query-hooks/src/hooks/expenses.ts`
- `create_expense_reimbursement_payment` — hook: `frontend/packages/query-hooks/src/hooks/expenses.ts`

Canonical resources: expense-sheets, account-moves

## Effect contract

Same sheet id reads back `state` per step; post/reimburse effects must resolve through a stable sheet→move relation, never newest-move lookup.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** `expense-sheets` exposes state, account_move_id and reimbursement_move_id, so post and reimburse resolve through the sheet's own relations



## Prerequisites / decisions

Receipt attachment path (COV-18 documents) for the receipt-backed variant.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov11-expense-sheet-lifecycle.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
