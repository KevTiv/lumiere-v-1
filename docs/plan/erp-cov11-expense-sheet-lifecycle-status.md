# COV-11 — Expense sheet submit → approve → post → reimburse

**Status:** IMPLEMENTED — runtime acceptance pending  
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

## Implementation

- **Reducers:** `submit_expense_sheet`, `approve_expense_sheet`, `post_expense_sheet` and
  `create_expense_reimbursement_payment` (`spacetimedb/src/expenses/expenses.rs`) already
  reject wrong-state transitions, approval by the submitter (SoD), and a second post;
  posting and reimbursing are idempotent on the sheet's stable `client_request_id`.
  `HrExpenseSheet` now derives `PartialEq` (Rust trait only; no schema or contract change)
  so the native proof compares whole rows.
- **Hooks:** `useSubmitExpenseSheet`, `useApproveExpenseSheet`, `usePostExpenseSheet` and
  `useCreateExpenseReimbursementPayment`
  (`frontend/packages/query-hooks/src/hooks/expenses.ts`) read `/api/query/expense-sheets`
  back and resolve the same sheet id and organization in the expected state through
  `resolveExpenseSheetEffect` (`expense-sheet-lifecycle.ts`):
  - submit → `Submitted`; approve → `Approved` (if a workflow gate created a human task the
    sheet stays `Submitted` and the hook says so);
  - post → `Posted` **and** the sheet's own `account_move_id` set;
  - reimburse → `Posted` (partial) or `Done`, with a `reimbursement_move_id` that **differs
    from the value read before dispatch** and from the posting move, so an earlier partial
    reimbursement never proves a later one. Never a newest-move lookup.
  Reducer errors (for example SoD) now reach the toolbar through `parseCallErrorExpenses`.
  Readback is scoped by organization and exact sheet id; the optional company check in the
  resolver is not used by the hooks because the operator's default company is not the
  sheet's company in a multi-company organization.
- **No contract delta:** `expense-sheets` already projects state, account_move_id and
  reimbursement_move_id.
- **Fixture note:** the first-org personas that hold `hr_expense_sheet:approve` cannot read
  expense sheets, so the browser proof has the admin session approve a sheet that another
  identity (the trusted owner token) submitted, after linking the admin identity to an
  employee record (EXP-007). The admin's approval of its own submission proves SoD.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | WRITTEN — `test_expense_sheet_replays_leave_row_unchanged` in `spacetimedb/tests/expenses/wave_a_test.rs` (registered in `run_expenses_wave_a_test`): submit/approve/post/reimburse replays, out-of-order transitions, idempotent same-request post and reimbursement, partial then final reimbursement with distinct moves — each rejection leaves the sheet row and the move count unchanged. **Not run in this environment (no Rust build); runs in CI.** |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | WRITTEN — `check_permission(hr_expense_sheet, update/approve/post)` + `account_move:create` + organization guard; reader replays of submit, approve, post and reimburse asserted 403 in the spec |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN — Submit, Approve, Post and Reimburse (partial, then final) run from the Expenses → Sheets toolbar in `frontend/web/tests/e2e/cov11-expense-sheet-lifecycle.spec.ts`; self-approval returns 422. **Spec not run in this environment (no browser stack); runs in CI.** |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | Resolver unit test DONE (passing); browser assertions WRITTEN — `expense-sheet-lifecycle.test.ts` (9 tests, passing); spec asserts the id/org/state/move-id snapshot after every replay |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
