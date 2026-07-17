# Expenses Gap Fixes — Tracker

Executable tracker for the full backlog (Pilot → Competitive → Differentiating). Source investigation: [../EXPENSES_INVESTIGATION.md](../EXPENSES_INVESTIGATION.md).

## Wave A — Pilot integrity

- [x] Submit integrity: sheet/company/employee/currency guards; server-recomputed totals; `submitted_by`
- [x] Refuse state guard + line state sync on approve/refuse/post
- [x] Atomic GL post (`MoveType::Entry` + `account_move_id`) in `post_expense_sheet`
- [x] SoD approve (`submitted_by` ≠ approver) + `gate_action_with_approval`
- [x] Receipts MVP (`attachment_ids` on update; non-empty required on sheet submit)
- [x] `create_expense_reimbursement_payment` clearing payable residual
- [x] UI: fix New Report quick action; live KPIs; post form accounts; submit without client total
- [x] Domain suite `run_all_expenses_tests` + Playwright lifecycle smoke

## Wave B — Competitive productization

- [x] Enforce `can_be_expensed` / `expense_policy` + amount caps
- [x] Tax recovery lines on post from `tax_ids`
- [x] FX snapshot at submit; company-currency post
- [x] Bounded SQL: `expense-sheets-to-approve`, missing-receipt queue
- [x] CSV Draft-only by default (sheet import)
- [x] Approval timeline UI
- [x] Optional employee `work_contact_partner_id` for remittance

## Wave C — Competitive depth

- [x] Mileage + per diem rate tables / line kinds
- [x] Split allocations (analytic/project shares)
- [x] Project rebill reducer
- [x] Online-first mobile capture UX

## Wave D — Differentiating

- [x] `expense_integration_intent` (card feed / OCR / FX workers)
- [x] Corporate card liability post path
- [x] Duplicate / fraud holds
- [x] Advances + policy exceptions
- [x] Delayed-sync outbox on `client_request_id`

## Ops checklist after Wave A merge

1. Generate TS/Rust SDKs + codegen (`make generate-stdb-ts-sdk`, `make generate-stdb-rust-sdk`, `make codegen`)
2. Publish module
3. `spacetime call <db> run_all_expenses_tests`
4. Playwright expenses lifecycle + workforce smoke
