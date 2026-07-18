# Expenses Gap Fixes — Tracker

Executable tracker for the full backlog (Pilot → Competitive → Differentiating). Source investigation: [../EXPENSES_INVESTIGATION.md](../EXPENSES_INVESTIGATION.md).

**Coordinator:** [.cursor/plans/expenses-coordinator-mission.md](../../.cursor/plans/expenses-coordinator-mission.md) · **Skill:** [.cursor/skills/expenses-coordinator/SKILL.md](../../.cursor/skills/expenses-coordinator/SKILL.md)

**Product boundary:** Spend lives in `spacetimedb/src/expenses/` (+ JE helpers in accounting, pack evidence in `core/country_pack.rs`). Project rebill stays in expenses (`create_expense_project_rebill`); projects UI may call it but must not fork a second rebill path. OCR/card/FX HTTP stays on `expense_integration_intent` workers — never in reducers.

## Waves A–E — Historical (landed 2026-07)

Spine already in tree: server totals, SoD/workflow approve, atomic JE post, reimbursement, policy, mileage/per diem, allocations, rebill, fraud, advances, card match, intents, pack flags, bounded queues, capture outbox, domain waves A–E. See investigation §1 and prior checkboxes in git history if needed.

- [x] Waves A–E complete per investigation + prior tracker

## Wave F — Pilot polish (evidence + close integrity)

- [x] Reject stub receipt IDs; register real receipt rows (`hr_expense_receipt` or equivalent) before `attachment_ids` accepted
- [x] Kill UI/capture/OCR stub `[1n]` / `attachment_ids: [1]` — wire receipt create → expense create
- [x] Expose create/edit fields: `productId`, `taxIds`, `paymentMode`, `merchantKey`, `hasReceipt` on edit form
- [x] Refuse reason captured in UI → `RefuseExpenseSheetParams`
- [x] `ensure_accounting_period_open_for_date` on post / reimburse / rebill
- [x] Explicit debit=credit assert (or shared poster helper) on expense JE paths
- [x] Harden post/reimburse/rebill idempotency (exact `client_request_id` lookup — not metadata `.contains`)
- [x] CSV `import_expense_csv` Draft-only by default (privileged break-glass optional)
- [x] Domain: gate-enabled SoD approve (no `skip_approval_check`); isolation for rebill/card/advance
- [x] Playwright: submit → approve (2nd identity or mocked SoD) → post → reimburse path
- [x] Workflow `execute_approved_action` handles `approve_expense_sheet` (gate completion path)

## Wave G — Competitive productization

- [x] Mileage/per-diem: enforce rate effective dates; kind-safe `update_expense`; rate admin UI
- [x] Capture panel: distance / days / rate selects for mileage & per diem
- [x] Allocation tax split on post; UI allow >2 shares
- [x] Rebill tax compute + surface action from projects UI (call existing reducer)
- [x] Inbox UIs: to-approve, missing-receipt, unmatched-card (query hooks + tabs/panels)
- [x] Pack evidence overlays for BR/AR/CL + MY/ID/PH/TH (metadata flags + tests)
- [x] Partial reimbursement; sheet → move drill-down links in UI
- [x] FBT/entertainment category flag (AU) — minimal product metadata + policy hold path
- [x] Rate list query resources + select dropdowns (not raw rate IDs)

## Wave H — Differentiating

- [x] Advance issuance GL (cash/prepaid) + advances admin UI (create/apply)
- [x] Policy exception reject reducer + request/approve/reject UI
- [x] Fraud hold admin UI + stronger duplicate rules (attachment hash when available)
- [x] Card unmatched inbox + unmatch UX; create-form `CorporateCard` path
- [x] Real OCR/email blob pipeline (worker writes receipt row + storage key — not stub IDs)
- [ ] Service Worker / background delayed-sync (stretch — deferred; localStorage outbox remains)
- [x] Statutory mileage rate seeds by pack (AU/NZ) — `seed_statutory_expense_mileage_rates` + Ops button
- [ ] Settlement fee schedule beyond single FX fee line (stretch — deferred; FX fee line Present)

## Ops checklist (after each wave that touches schema)

1. [x] `make generate-stdb-ts-sdk` + `make codegen` (TS bindings for rates/seed/receipts); re-run rust SDK if api-server needs new reducers
2. [x] Publish module (`make local-publish` → `lumiere-v1-j1uo0`)
3. [x] `spacetime call … run_all_expenses_tests --server local` — green 2026-07-18 (org-scoped finds hardened in wave_d/e)
4. [x] Playwright: `expenses-wave-lifecycle.spec.ts` — **8/8 passed** 2026-07-18 (`E2E_CLEAR_DB=1 make e2e-single`); phase-5 workforce smoke optional
5. [x] Update investigation §7 priority tables when a wave lands

## Raised issues closed in polish pass

- [x] Workflow `execute_approved_action` → `approve_expense_sheet`
- [x] Rate list query keys + select dropdowns (not raw IDs) + statutory seed Ops button
- [x] Domain tests: org-scoped sheet/advance/expense finds; unique `client_request_id`s; move-scoped GL asserts
- [x] Wave B/D receipt stubs replaced with `test_receipt_id`
- [x] Expenses table `rowSelectionToggleOnClick` so toolbar post/reimburse can select rows
- [x] Option-field registry + hooks for expense params (`PostExpenseSheetParams`, receipts, etc.)
- [x] Seed fiscal periods use real date ranges (period-lock safe for “today”)
- [x] `expense-sheets` query whitelist includes `account_move_id` (+ drill-down FKs)

## Notes

- Reuse `ensure_accounting_period_open_for_date` from `accounting/fiscal_periods.rs` — do not invent a second period check.
- Reuse `expense_integration_intent` for OCR/card/FX — do not add HTTP inside reducers.
- Forms: `FormConfig` in `frontend/packages/ui/src/lib/expenses-form-configs.ts` + `FormModal` + `ModularForm`.
- Reducers: `.cursor/rules/lumiere-reducer-conventions.mdc` (`*Params`, `write_audit_log_v2`, company guards).
- SpacetimeDB: keep atomic post in one reducer txn; external I/O → workers/procedures.
