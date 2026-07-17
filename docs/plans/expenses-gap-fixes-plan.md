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

## Wave E — Ops validation leftovers + investigation gaps

- [x] Pack-driven tax-evidence rules (`expense_require_receipt` / `expense_require_tax_ids` on country packs)
- [x] Corporate card statement match (`expense_card_statement_line` + match/unmatch)
- [x] OCR / email inbox workers (`email_inbox` intent + `apply_pending_expense_integration_intents` + api-server worker)
- [x] Delayed-sync conflict UI (retry / discard on capture outbox)
- [x] Cross-border card FX fee lines on post (`fx_fee_account_id` / matched statement fees)
- [x] Domain suite `run_expenses_wave_e_test` wired into `run_all_expenses_tests`
- [x] Playwright `expenses-wave-lifecycle.spec.ts`

## Ops checklist

1. [x] Generate TS/Rust SDKs + codegen (run after Wave E schema publish)
2. [x] Publish module (`make publish-clear` → `lumiere-v1-j1uo0` local) — 2026-07-17
3. [x] `spacetime call lumiere-v1-j1uo0 run_all_expenses_tests --server local` — green 2026-07-17
4. [x] Playwright expenses lifecycle + workforce smoke (`expenses-wave-lifecycle.spec.ts`)
