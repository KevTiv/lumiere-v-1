# COV-11 — Expense sheet submit → approve → post → reimburse

**Status:** ACCEPTED — bounded expense-sheet path passed; owning module remains at `review`
**Branch:** `codex/cov11-expense-sheet-lifecycle`  
**Stack base:** `codex/cov08e-finance-certification`  
**Module/surface:** Expenses  
**Plan target:** receipt-backed expense submit/approve/post/reimburse

## Bounded path

Operator surface: `/expenses` → Expense sheets.

The bounded lifecycle is:

1. Draft → Submitted through `submit_expense_sheet`;
2. Submitted → Approved through `approve_expense_sheet` under a distinct finance actor;
3. Approved → Posted through `post_expense_sheet`;
4. Posted → Done through `create_expense_reimbursement_payment`.

The browser path now creates the sheet and expense through their operator forms.
It uploads real PDF bytes through the authenticated presign → object-store PUT →
complete flow, verifies the persisted receipt checksum/storage identity, and
links the draft expense to the sheet through the visible row-action form.

## Exact effect contract

All four transitions resolve the **same expense sheet ID**, organization and
company.

- Submit resolves the same sheet in `Submitted`.
- Approve resolves the same sheet in `Approved`.
- Post resolves the same sheet in `Posted` and requires its own
  `account_move_id` to resolve to the same scoped Posted account move.
- Reimburse resolves the same sheet in `Done` and requires both
  `account_move_id` and `reimbursement_move_id` to resolve to exact scoped
  Posted account moves.

Duplicate exact sheet or move identities fail closed. No newest-move, timestamp
or name correlation is used.

## Replay semantics

This slice preserves the domain's intentional distinction between stale
transitions and retry-safe accounting writes:

- submit replay after acceptance: rejected; canonical sheet unchanged;
- approve replay after acceptance: rejected; canonical sheet unchanged;
- post replay with the same stable `client_request_id`: **idempotent success**;
  the same `account_move_id` remains linked and no move is duplicated;
- post with a changed retry key after posting: rejected;
- full reimbursement replay after the sheet reaches Done: rejected; both move
  relations remain unchanged.

The UI now also sends a stable per-sheet reimbursement
`client_request_id`, matching the existing stable post key.

## Contract disposition

**No generated contract delta expected.** `expense-sheets` already exposes
`id`, `organization_id`, `company_id`, `state`, `account_move_id`
and `reimbursement_move_id`. `account-moves` already exposes the exact move
identity, organization/company scope and state required by readback.

## D/A/O/E proof

| Gate | Proof in this branch | Acceptance condition |
| --- | --- | --- |
| D | `test_expense_lifecycle_posts_move` now proves submit and approve stale rejection, same-key post idempotency without move duplication, changed-key post rejection, full reimbursement, and reimbursement replay preservation. Existing Wave A/F/G coverage retains receipt, SoD, company isolation and locked-period invariants. | `run_all_expenses_tests` passes. |
| A | Existing generated operations retain `hr_expense_sheet` update/approve/post and `account_move:create` permissions plus organization/company guards. Browser proof uses admin as submitter, `fixture.finance@example.test` as distinct approver, and requires `fixture.reader@example.test` to receive 403 for every captured lifecycle request. | Authorized personas succeed; reader denial preserves exact effects. |
| O | `cov11-expense-sheet-lifecycle.spec.ts` drives receipt upload, sheet creation, expense creation/linking, Submit, Approve, Post and Reimburse through visible `/expenses` forms and actions. Only conditional finance-employee identity linkage remains trusted fixture preparation. | Focused Playwright proof passes. |
| E | `expenses-lifecycle-effect.test.ts` covers exact state/scope/identity, post source-move relation, reimbursement source/payment move relations and ambiguity. Browser proof preserves exact sheet and move snapshots across stale/idempotent/denied requests. | Query-hook unit, native and browser proofs green on one head. |

## Acceptance

COV-11 is **ACCEPTED** for this bounded path because the final review head records:

1. contract generation with no generated shape delta;
2. query-hooks typecheck + unit tests;
3. `run_all_expenses_tests` on a live stack;
4. focused COV-11 Playwright proof;
5. branch CI green.

This bounded acceptance does not award U4/U5 or enable first-org launch admission.

## Integrated runtime evidence

On `80cbfd29f9c9f4a82a848cd3d873a89d06d01ce4`, the clean local P0 suite passed
`cov11-expense-sheet-lifecycle.spec.ts` as part of 130 passes, 5 annotated
capability skips and 0 failures. This closes the local runtime condition for the
selected submit/approve/post/reimburse transitions. In that historical run,
receipt, sheet and expense line creation were fixture-assisted. On final review head
`e23bac1c0420ae2c15b190a678f2198285fb5df6`, GitHub Actions targeted run
`37116733371` included this spec and passed with 54 passes, 17 annotated
capability skips and 0 failures. Human usability/accessibility review remains
open, and the owning COV-11 row therefore remains below U4/U5 and at `review`.

## Wave 2 operator/runtime closure

`codex/cov-u5-closure-wave2` removes the fixture-assisted receipt/sheet/line
setup from the focused browser proof. The test now additionally asserts:

- the receipt bytes complete through the real blob API and persist their exact
  SHA-256 checksum, MIME/file name and non-synthetic storage key;
- replaying the exact receipt-create and expense-create HTTP requests leaves
  exactly one receipt and one expense;
- the persisted submitter and approver identities are both canonical and
  distinct before accounting posting is allowed;
- post remains same-key idempotent while stale submit/approve/reimbursement and
  reader-persona requests preserve the exact sheet and move identities.

Focused verification commands:

```text
node --import tsx --test lib/expenses-create-params.test.ts
playwright test --config playwright.config.ts tests/e2e/cov11-expense-sheet-lifecycle.spec.ts --list
```

The browser spec is runtime-ready but still requires the standard authenticated
E2E stack, object-storage credentials and first-org persona fixture for live
execution. This document does not claim a new runtime pass until that command is
executed against one immutable head.
