# Expenses Investigation — Employee Spend, Approvals & Reimbursement

Current-state assessment of Lumiere expenses against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-18  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this investigation unless noted under Validation.

**Verdict:** Lumiere has a **substantive expense-to-ledger spine** after Waves A–E — draft/mileage/per-diem lines → sheet submit (server totals + FX snapshot) → SoD/workflow approve → refuse with line detach → atomic `AccountMove` post (tax recovery, OOP payable / card liability / advance clearing / FX fees) → reimbursement Entry → optional project rebill — plus policy caps, fraud holds, advances, card statement match, integration intents, pack evidence flags, bounded queues, capture outbox, domain wave tests, and 28 BFF reducers (0 phantoms). Against the quality bar it is **partially competitive for pilot spend control** but still **unsuitable for statutory close and field-grade evidence**: receipt attachments are stubbed (`[1n]`), advance *issuance* has no cash/prepaid GL, expense-line CSV can still insert Posted/Done without moves, post bypasses shared accounting-period lock / balance assert helpers, idempotency for post/reimburse uses fragile metadata substring match, and several Wave D/E surfaces (advances, fraud, policy exceptions, rate admin, unmatched-card queue) exist in backend/BFF without product UI.

**Quality benchmark (not a spec):** Oracle NetSuite Expense Management patterns emphasize report lifecycle with auditable approvals, policy-aware categories (incl. mileage/per diem), corporate-card import and GL credit to card liability, project accounting / client rebilling, and seamless reimbursement posting ([NetSuite Expense Management](https://www.netsuite.com/portal/products/professional-services-automation/expense-management.shtml); [Corporate Card Expenses](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1531259544.html); [Expense automation overview](https://www.netsuite.com/portal/resource/articles/financial-management/expense-management-automation.shtml)). Lumiere is judged on whether it can meet that *depth of control and posting integrity*, not on SuiteApp parity.

**V1 roadmap reconciliation:** `docs/V1_ROADMAP.md` does **not** currently call out an Expenses wedge. Treat this investigation as the source of truth for expenses depth until a roadmap claim is added. Wave tracker: `docs/plans/expenses-gap-fixes-plan.md` (Waves A–E marked complete in code).

**Compile check:** `cargo check` in `spacetimedb/` — **passed** (2026-07-18; unrelated warnings in subscriptions).

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/expenses` + adjacent)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Expense lines | `hr_expense` | `expenses/expenses.rs` | Line kinds Standard/Mileage/PerDiem; tax/account/analytic/project; `attachment_ids` / `has_receipt`; `client_request_id`; `payment_mode`; fraud/policy holds; `merchant_key` / `duplicate_of_id` |
| Expense reports | `expense_sheet` | `expenses/expenses.rs` | `account_move_id`, `reimbursement_move_id`, `rebill_move_id`; FX `currency_rate` / `company_currency_id`; `submitted_by` / `approver_id` |
| Company policy | `hr_expense_policy` | `expenses/expenses.rs` | `max_line_amount`, `max_sheet_amount` |
| Mileage rates | `hr_expense_mileage_rate` | `expense_depth.rs` | `rate_per_unit`, unit, currency, effective window, `active` |
| Per diem rates | `hr_expense_per_diem_rate` | `expense_depth.rs` | `location_code`, amount/day, currency, effective window |
| Split allocations | `hr_expense_allocation` | `expense_depth.rs` | analytic/project shares; `billable`; amounts |
| Integration intents | `expense_integration_intent` | `expense_wave_d.rs` | card_feed / ocr_receipt / email_inbox / fx_rate / delayed_sync; `idempotency_key` |
| Advances | `hr_expense_advance`, `hr_expense_advance_application` | `expense_wave_d.rs` | residual tracking; **no issuance GL** |
| Policy exceptions | `hr_expense_policy_exception` | `expense_wave_d.rs` | Pending/Approved; `Rejected` enum unused |
| Card statements | `expense_card_statement_line` | `expense_wave_e.rs` | match/unmatch; `fx_fee_amount` |
| Product (adjacent) | `product_product` | `inventory/product.rs` | `can_be_expensed`, `expense_policy` — **enforced** on create when product set |
| HR (adjacent) | `hr_employee` | `hr/employees.rs` | `employee_id`; remittance via `work_contact_partner_id` when set |
| Accounting (adjacent) | `account_move` / lines, taxes, payments | accounting | Post + reimbursement create Posted `Entry` moves |
| Projects (adjacent) | `project_project` | `projects/` | Rebill via `create_expense_project_rebill` → OutInvoice + `rebill_move_id` |
| Workflow (adjacent) | approval gate | `workflow/` | `gate_action_with_approval` on sheet approve |
| Country packs (adjacent) | evidence metadata | `core/country_pack.rs` | `expense_require_receipt` / `expense_require_tax_ids` on AU/NZ/ZA/SG seeds |
| Approval history table | — | — | **No** dedicated immutable history table; workflow timeline + audit log + sheet fields |

**Enums** (`spacetimedb/src/types.rs`):  
`ExpenseState` / `ExpenseSheetState`: `Draft | Submitted | Approved | Posted | Done | Refused`.  
`ExpenseLineKind`: `Standard | Mileage | PerDiem`.  
`ExpensePaymentMode`: `OutOfPocket | CorporateCard`.  
`ExpensePolicyExceptionState`: `Pending | Approved | Rejected` (Rejected unused).  
`ExpenseAdvanceState`: `Open | PartiallyApplied | Closed`.

### 1.2 Backend reducers (callable SpacetimeDB surface)

**Core (`expenses/expenses.rs`):**  
`create_expense`, `update_expense`, `submit_expense`, `create_expense_sheet`, `submit_expense_sheet`, `approve_expense_sheet`, `refuse_expense_sheet`, `post_expense_sheet`, `create_expense_reimbursement_payment`, `upsert_expense_policy`

**Depth (`expense_depth.rs`):**  
`upsert_expense_mileage_rate`, `upsert_expense_per_diem_rate`, `set_expense_allocations`, `create_expense_project_rebill`

**Wave D (`expense_wave_d.rs`):**  
`create_expense_integration_intent`, `apply_expense_integration_intent`, `fail_expense_integration_intent`, `create_expense_advance`, `apply_expense_advance_to_sheet`, `request_expense_policy_exception`, `approve_expense_policy_exception`, `set_expense_fraud_hold`

**Wave E (`expense_wave_e.rs`):**  
`create_expense_card_statement_line`, `match_expense_card_statement_line`, `unmatch_expense_card_statement_line`, `apply_pending_expense_integration_intents`

**Imports (`data_ops/expenses_imports.rs`):**  
`import_expense_csv`, `import_expense_sheet_csv`

| Reducer | Behavior | Gap |
|---------|----------|-----|
| `create_expense` | Kind-aware totals; product/company caps; duplicate → `fraud_hold`; idempotent `client_request_id` | Rate effective dates not enforced; UI often omits product/tax |
| `update_expense` | Draft-only; company/org guard | Recalc always `unit × qty` — breaks mileage/per-diem semantics |
| `submit_expense` | Attach line → `Submitted` + sheet guards | Does **not** recompute sheet total (fixed at sheet submit) |
| `create_expense_sheet` | Draft; totals 0; FX fields init | |
| `submit_expense_sheet` | Server `total_amount`; FX snapshot; receipt/tax/fraud/policy gates; line sync | |
| `approve_expense_sheet` | SoD (`submitted_by` ≠ approver) + `gate_action_with_approval` | Domain tests often call `_impl(..., skip_approval_check: true)` |
| `refuse_expense_sheet` | Submitted-only → `Refused`; lines → Draft, detached | Reason param supported; UI sends `{}` |
| `post_expense_sheet` | **Creates + posts `AccountMove`**, sets `account_move_id`; tax recovery; OOP/card/advance credits; FX fee; allocation-split expense debits | No `ensure_accounting_period_open`; no debit=credit assert; tax lines not allocation-split; inline post vs shared move poster |
| `create_expense_reimbursement_payment` | Second Posted Entry; `reimbursement_move_id`; sheet → `Done` | Full residual only; no partial pay |
| `upsert_expense_policy` | One policy row / company | No UI |
| Mileage / per diem upsert | Rate tables | Effective window unused at create; no UI |
| `set_expense_allocations` | Draft; shares = 100% | UI max 2 lines |
| `create_expense_project_rebill` | Posted/Done → OutInvoice; `rebill_move_id` | `amount_tax: 0`; single partner from first project |
| Integration intents | Durable worker queue + apply/fail | OCR/email may inject stub `attachment_ids: [1]` |
| Advances create/apply | Residual + post clearing account | **No GL on advance issuance** |
| Policy exception request/approve | Clears `policy_hold` | No reject reducer; no UI |
| Fraud hold | Manual on Draft/Submitted | No UI |
| Card statement create/match/unmatch | ±0.05 tolerance; FX fee on post | Unmatch/no queue list UI |
| CSV expense import | Can force any line state incl. Posted/Done | **Workflow bypass** |
| CSV sheet import | Draft-only; clears GL link fields | Safer than line import |

### 1.3 Frontend contracts (BFF / hooks)

[`EXPENSES_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/expenses-http.ts): **28** keys. **0 phantoms** — every key has a generated SpacetimeDB reducer binding.

| Surface | Status |
|---------|--------|
| Query hooks | Core lifecycle + most Wave C–E; **missing hooks:** unmatch card, fail intent, request/approve policy exception, upsert policy |
| Hooks without UI | mileage/per-diem upsert, fraud hold, advances create/apply, single intent apply |
| Create params | `toCreateExpenseParams` hardcodes empty product/tax/account; stub `attachmentIds: [1n]` when `hasReceipt` |
| Capture / outbox | `expense-capture-outbox.ts` + `ExpensesCapturePanel` — delayed_sync intent + `clientRequestId` |
| Ops panel | Card statement create/match + flush pending intents |
| Post / reimburse / rebill | Wired in sheet row dialog + single-row toolbar |
| Contract test | `expenses.contract.ts` — compile-only BFF enumeration |

### 1.4 Subscriptions & queries

`EXPENSES_WORKSPACE_RESOURCE_KEYS` ([`expenses-workspace.ts`](../frontend/packages/stdb/src/subscriptions/expenses-workspace.ts)): five keys, all in `ERP_ORG_SQL`.

| Key | In `ERP_ORG_SQL` | Filter / notes |
|-----|------------------|----------------|
| `expenses` | Yes | Org-scoped → `hr_expense` |
| `expense-sheets` | Yes | Org-scoped → `expense_sheet` |
| `expense-sheets-to-approve` | Yes | `state = 'Submitted'` |
| `expenses-missing-receipt` | Yes | `has_receipt = false AND state = 'Draft'` |
| `expense-card-statement-unmatched` | Yes | `status = 'unmatched'` — **subscribed; no React Query list hook / queue tab** |

KPIs: `ExpensesClientLoaded` overrides dashboard with live counts (pending approve, missing receipts, approved, sheet total sum). Unmatched cards not surfaced as a KPI.

### 1.5 UI operations (`/expenses`)

Tabs from `expensesModuleConfig` + [`expenses-client.tsx`](../frontend/web/app/(modules)/expenses/expenses-client.tsx) + capture/ops panels:

| Tab / surface | End-to-end operations | Gaps |
|---------------|----------------------|------|
| Dashboard | Live KPIs; New Report / New Expense quick actions | Template zeros replaced at runtime |
| Expenses | Create / edit draft / add-to-report / split alloc (≤2) / CSV | No product/tax/GL/paymentMode fields; stub receipts; no fraud/exception UI |
| Expense Reports | Create / submit / approve / refuse / post / reimburse / rebill / approval timeline / CSV | Refuse reason empty; post needs account IDs; bulk post/reimburse single-select only |
| Capture panel | Online-first + outbox flush; conflict retry/discard | Mileage/per-diem fields incomplete; always OOP; stub attachments |
| Ops panel | Card statement create/match; flush intents | Prompt-driven IDs; no unmatched queue table; no unmatch |

Mobile-first delayed-sync: **Partial** (localStorage outbox + conflict UI; not SW/background sync). OCR/camera blob store: **Absent** (intent stubs only).

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain | `spacetimedb/tests/expenses/` waves A–E via `run_all_expenses_tests` | Policy exception approve/reject; workflow gate happy path (non-skip); advance issuance GL; CSV bypass; period lock; GL balance assert; partial reimbursement |
| Contract | `expenses.contract.ts` BFF keys | Runtime reducer presence |
| Playwright | `expenses-wave-lifecycle.spec.ts` — panels, capture, ops, conflict UI, allocations seed | Full UI submit→approve→post→reimburse lifecycle; SoD second identity |
| Smoke | `phase-5-workforce-smoke.spec.ts` — module + CSV/toolbar visibility | Mutations |

### 1.7 Seed

`seed.rs` Tier 9: sample Approved sheet/lines still useful for demos; production path no longer depends on Posted-without-JE. Country pack catalog seeds AU/NZ/ZA/SG with expense evidence metadata flags.

---

## 2. Gap matrix (quality bar vs inventory)

Definitions:

- **Present** — usable end to end with operational and/or financial consequences.
- **Partial** — implemented at limited depth, or missing an essential UI, policy, reporting, or integration layer.
- **Absent** — no meaningful implementation.
- **Unsuitable** — surface exists but cannot safely meet the workflow / accounting requirement.

| Capability | State | Evidence | Priority |
|------------|-------|----------|----------|
| Expense line create / edit (draft) | **Present** (MVP) | Reducers + UI + audit | — |
| Mileage / per diem calculate | **Present** (MVP) | Rate tables + effective dates + kind-safe update + rate admin/selects + capture fields; statutory AU/NZ seed | — |
| Expense report (sheet) create | **Present** | Reducers + UI | — |
| Attach line to report | **Present** | `submit_expense` with sheet/company/employee/currency guards | — |
| Submit report (server totals + FX) | **Present** | `submit_expense_sheet` recomputes total + rate snapshot | — |
| Approval routing / SoD / workflow | **Present** (MVP) | SoD + gate; workflow `execute_approved_action` → `approve_expense_sheet`; Wave F gate test | — |
| Refuse / reject | **Present** | Submitted-only + line detach; refuse reason in UI | — |
| Durable approval timeline | **Partial** | Workflow timeline hook + audit; sheet `approver_id` overwriteable | Competitive |
| Policy engine (limits, categories) | **Partial** | Product + company caps + exceptions request/approve/reject + UI; no full category matrix UI | Competitive |
| Receipt capture / evidence | **Present** (MVP) | `hr_expense_receipt` + create; stub `[1]`/`[1n]` rejected; OCR/email require `storage_key` | — |
| Advances | **Present** (MVP) | Issuance GL (Dr advance / Cr cash) + apply/clear + admin UI | — |
| Corporate cards | **Present** (MVP) | Liability post + match/unmatch + FX fee + create-form CorporateCard + unmatched inbox | — |
| Reimbursements | **Present** | Posted Entry + residual clear → Done; partial reimburse | — |
| Project rebilling | **Present** (MVP) | Rebill OutInvoice + tax compute + projects UI surface | — |
| Tax recovery / VAT reclaim | **Present** (MVP) | Percent/Fixed purchase taxes on post; pack tax_ids; real receipts | — |
| Duplicate / fraud detection | **Present** (MVP) | Heuristic + content-hash hold; clear + fraud admin UI | — |
| Policy exceptions | **Present** (MVP) | Request/approve/reject + UI | — |
| Split allocations | **Present** (MVP) | 100% shares; expense + tax split on post; UI >2 shares | — |
| Multicurrency settlement | **Partial** | FX at submit; company-currency post; card FX fee line; **no multi-line settlement fee schedule** | Differentiating |
| Accounting post / reconciliation | **Present** (MVP) | Real JE + period lock + balance assert + exact `client_request_id` idempotency | — |
| Atomic AP / project accounting post | **Present** (MVP) | Post atomic; rebill separate; advance issuance on create | — |
| Idempotent submissions | **Present** (MVP) | Exact `client_request_id` on create/post/reimburse/rebill/intents | — |
| Mobile-first / delayed-sync | **Partial** | Outbox + conflict UI; online-first; **SW delayed-sync deferred** | Differentiating |
| Region tax-evidence requirements | **Present** (MVP) | Pack flags AU/NZ/ZA/SG + BR/AR/CL + MY/ID/PH/TH overlays; AU FBT soft hold | — |
| Live exception queues | **Present** (MVP) | To-approve / missing-receipt / unmatched-card inbox panels | — |
| Multi-entity isolation | **Present** (MVP) | Org/company guards + Wave F isolation (rebill/card/advance) | — |
| Audit coverage | **Present** (MVP) | `write_audit_log_v2` on mutators | — |
| Phantom UI contracts | **Present** (cleared) | BFF ⊆ reducers | — |
| Dashboard / KPI fidelity | **Present** (live override) | Pending/missing/approved/totals live | — |
| CSV bootstrap | **Present** (MVP) | Sheet + line import Draft-only by default | — |
| Extensibility (intents/workers) | **Present** (pattern) | Intent table + apply batch + api-server worker path | — |
| Period lock on post | **Present** | `ensure_accounting_period_open_for_date` on post/reimburse/rebill | — |
| Drill-down sheet → JE → payment | **Present** (MVP) | FKs + UI move drill-down links | — |

---

## 3. Required invariants

### Accounting

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Post creates balanced JE / AP exposure | **Partial** | `post_expense_sheet` inserts Posted `AccountMove` + lines + `account_move_id` | Explicit debit=credit assert; reuse shared poster; period lock |
| Out-of-pocket → employee payable / reimbursement | **Yes** (basic) | Payable credit on post; `create_expense_reimbursement_payment` | Partial pay; bank reconcile UX |
| Corporate card → liability | **Yes** | Card mode + `card_liability_account_id`; statement FX fee | Productize paymentMode + unmatched queue UI |
| Tax recoverable amount recorded | **Partial** | `compute_tax_recovery_for_line` on post | Real tax invoice evidence; allocation-aware tax; Division/Python taxes |
| Sheet total = sum(lines) | **Yes** (submit/post) | Server recompute + post validate | Keep; optionally refresh on `submit_expense` |
| FX snapshot at submit/approve/post | **Yes** (submit) | `currency_rate` / company currency on sheet | Worker override via fx_rate intent; harden rate source |
| Analytic / project cost + rebill | **Partial** | Allocations + `create_expense_project_rebill` | Tax on rebill; project margin surface |
| Advance issuance ↔ clearing | **Partial** | Clearing on post; residual apps | Cash/prepaid JE on `create_expense_advance` |
| Period locks | **No** (expenses) | Close helpers elsewhere | Block post/reimburse/rebill when period locked |
| Reimbursement ↔ bank reconcile drill-down | **Partial** | Move FKs exist | Sheet → move → payment → bank statement UI |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Reducer permissions | Yes | `check_permission` on expense/sheet/move | Keep deny-by-default |
| Tenant / company ownership | Yes (core paths) | Org/company guards; Wave A isolation test | Extend isolation tests to rebill/card/advance |
| Approval SoD | Yes | `submitted_by` ≠ approver | Prove with gate-enabled domain + e2e second identity |
| Field-level / pack evidence | Partial | Pack receipt/tax flags; stub IDs defeat intent | Real attachment store + pack overlays for BR/SEA |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Append-only mutation log | Yes | `write_audit_log_v2` | Richer post snapshots (tax, FX, liability split) |
| Immutable approval history | Partial | Workflow timeline + sheet fields | Append-only expense approval events; exception Rejected path |
| Source-document links | Partial | `account_move_id` / reimbursement / rebill FKs | UI drill-down; real receipt document IDs |

### Concurrency / integrity

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Atomic post + GL | **Yes** (txn) | One reducer for move+lines+sheet | Shared period/balance helpers |
| Stale-state rejection | Yes (core) | Approve/refuse/post preconditions; double-post blocked | Keep line sync on refuse |
| Idempotent submit/post | Partial | Create/intent keys; post metadata `.contains` | Dedicated idempotency column / intent row |
| No client multi-step financial commit | Intent OK for post | Single `post_expense_sheet` | Never mark Posted without move (satisfied); keep rebill/reimburse explicit |
| Live exception queues | Partial | Bounded SQL for approve/missing receipt/unmatched | Inbox UIs; unmatched query hook |
| CSV cannot create Posted-without-JE | **Violated** (lines) | `import_expense_csv` any state | Draft-only default for lines |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). External HTTP (card feeds, OCR, FX providers, tax authority) belongs in procedures/workers, not reducers — already modeled via `expense_integration_intent`.

---

## 4. Reference workflows

1. **Capture expense line (draft)** — Present; category/tax/receipt productization Partial/Unsuitable.
2. **Attach receipt evidence** — Server Partial; live capture Unsuitable (stub IDs).
3. **Create report → add lines → submit** — Present (server totals + FX).
4. **Approval routing / SoD / workflow gate** — Partial/Present API; e2e SoD thin.
5. **Refuse with reason** — API Present; UI reason Absent.
6. **Post to GL / AP / card liability** — Present (atomic Entry); period lock Absent.
7. **Reimburse employee** — Present (full residual).
8. **Corporate card import → match → credit liability** — Partial (ops panel + domain).
9. **Mileage / per diem calculate** — Partial (tables + create; admin/UI weak).
10. **Advance issue → apply → settle** — Partial (apply/settle; issue GL Absent; no UI).
11. **Project analytic + client rebill** — Partial (rebill; tax 0).
12. **VAT/GST reclaim with evidence** — Partial compute / Unsuitable evidence.
13. **Duplicate / fraud hold** — Partial (auto + manual; no UI).
14. **Split cost across analytics/projects** — Partial.
15. **Multicurrency settlement + card FX fee** — Partial.
16. **Mobile offline capture → delayed sync** — Partial outbox/conflict.
17. **Cross-company isolation** — Partial (tested on post).
18. **CSV bootstrap** — Partial sheets / Unsuitable lines.
19. **Live pending-approval / missing-receipt queues** — Partial (SQL + KPI; weak inbox UX).
20. **Drill-down report → JE → payment** — Partial FKs / weak UI.
21. **Policy exception override** — Partial API / Absent UI.
22. **Pack-driven tax evidence** — Partial (AU/NZ/ZA/SG flags).

### Acceptance scenarios (≥12)

1. Employee creates Draft Standard expense with product (`can_be_expensed`), amount, currency, tax ids, and real receipt attachment IDs; pack `expense_require_*` enforced; audit CREATE.
2. Mileage: distance × active rate (respecting effective dates) creates line; per diem: location/date schedule × days; both honor company/product caps.
3. Employee creates Draft sheet, attaches ≥1 Draft line (`submit_expense`); server rejects cross-company / wrong-employee / currency mismatch.
4. Submit sheet recomputes `total_amount` from lines, snapshots FX to company currency; fraud_hold or policy_hold without approved exception fails closed; lines + sheet → `Submitted`.
5. Approver (≠ submitter) approves via workflow gate → `Approved`, timeline event, line states sync; self-approve blocked.
6. Second approval step when amount > policy threshold (workflow definition); immutable history retains both decisions.
7. Refuse only from `Submitted`, with reason; lines return to editable Draft detached from sheet; cannot refuse `Posted`.
8. `post_expense_sheet` in one transaction: balanced Posted `AccountMove` (Dr expense ± tax recoverable, Cr employee payable and/or card liability and/or advance), optional FX fee, sets `account_move_id`, sheet+lines → `Posted`; period lock blocks; re-post with same `client_request_id` is idempotent no-op.
9. Reimbursement payment clears employee payable residual (full or partial); bank reconcile drills sheet → move → payment.
10. Corporate-card line posts Cr card liability (not employee payable); statement match (±tol) closes/links line; unmatched queue live-updates.
11. Split allocation: one receipt → N analytic/project shares totaling 100%; expense **and** tax shares; billable share → `create_expense_project_rebill` with tax → client invoice once.
12. Duplicate detection: same employee + merchant/date/amount (±tol) or same attachment hash → hold; clear only via authorized `set_expense_fraud_hold` with audit.
13. Multicurrency: foreign receipt stores FX snapshot at submit; company-currency post uses snapshot; card FX fee explicit account.
14. Tax reclaim: GST/VAT input tax line posted only when pack evidence satisfied (real tax invoice fields / attachment — not stub `1`).
15. Offline mobile: capture with `client_request_id`; delayed_sync intent + create once; conflict UI retry/discard; no double JE.
16. Company B cannot approve/post/rebill company A’s sheet (domain + e2e).
17. Advance: issue creates cash/prepaid GL; apply reduces residual before post; post clears advance account; residual → Closed.
18. Policy exception: manager approves or rejects one-time override; immutable exception record; post metadata flags exception.
19. CSV import into Draft only (or privileged break-glass); cannot silently create Posted lines/sheets without JE in production policy mode.
20. Exception subscriptions update live: Submitted-to-approve, missing-receipt, unmatched cards, over-policy holds — inbox UIs without full-table client scans.
21. `update_expense` on mileage/per-diem recalculates from rate tables (or rejects kind-unsafe edits).
22. Period-closed company rejects post/reimburse/rebill with clear error; open period appears on P&L / AP aging with origin `EXPn`.

---

## 5. Localization matrix (expenses / tax-evidence / settlement)

Country packs today are **tax-seed + company-ID metadata + expense evidence flags** (`spacetimedb/src/core/country_pack.rs` → `pack_expense_evidence_rules`). Expenses still need richer **mileage statutory tables, FBT/entertainment overlays, and tax-invoice field schemas** — flags alone are not live statutory adapters.

**i18n:** UI ships **English only** (`SupportedLanguage = "en"`). Expense strings live under module/dashboard configs and `en.json` where present. Country packs are not language packs.

Rates and rules below are **dated requirements as of 2026-07-18**, cited from official sources where linked — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA only in-tree) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|-----------------------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` only | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| VAT/GST seed | GST-AU 10%; GST-NZ 15% | VAT-ZA 15% | ICMS/IVA seeds | GST/SST/PPN/VAT seeds |
| Expense evidence flags | AU: receipt+tax_ids; NZ: receipt | ZA: receipt | **No** expense flags in catalog seed | SG: receipt; MY/ID/PH/TH thin |
| Input-tax reclaim evidence | Tax invoice / valid GST tax invoice (ATO / IRD) — pack flag only; stub attachments defeat reclaim | Tax invoice for VAT vendors — flag only | NF-e / recibos rules — outside reducers; need procedure validation | IRAS / SST / e-Faktur / BIR / RD — SG flag only; e-invoice **workers** |
| Mileage | ATO cents/km; IRD mileage — corporate rate tables exist; statutory tables not seeded | SARS travel allowances — need rates | Local km tables | Corporate rate tables common |
| Per diem / travel | Corporate policies; FBT risk AU entertainment/cars — **not** flagged in reducers | Subsistence allowances | Per diem + FX (ARS) volatility | Per diem + multi-currency travel |
| Corporate cards | AUD/NZD settlement | ZAR | High FX / card FX fees — fee line Present | Multi-currency cards (SGD/MYR/…) — fee line Present |
| Employee reimbursement FX | Snapshot AUD/NZD functional | ZAR functional | BRL/ARS/CLP; ARS volatility → FX snapshot critical (Present at submit) | SGD + regional currencies |
| Advances | Policy + payroll interaction | Same | Same | Same |
| Expenses pack gap | Enforce real GST tax-invoice fields; FBT flags on entertainment categories | VAT tax-invoice fields on receipt | NF-e / local receipt types as **procedures** | Configurable evidence by pack; MY/ID e-invoice **workers** for merchant docs — not in-reducer HTTP |

### Official sources (dated; verify)

| Region | Authority / reference |
|--------|----------------------|
| Australia GST / FBT / cents per km | [ATO — GST](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst); [ATO — cents per kilometre](https://www.ato.gov.au) |
| New Zealand GST / mileage | [IRD — GST](https://www.ird.govt.nz/gst); [IRD — mileage rates](https://www.ird.govt.nz) |
| South Africa VAT | [SARS — VAT](https://www.sars.gov.za/tax-rates/value-added-tax-vat/) |
| Singapore GST | [IRAS — GST](https://www.iras.gov.sg/taxes/goods-services-tax-gst) |
| Malaysia e-Invoice | [LHDN MyInvois](https://www.hasil.gov.my) |
| Indonesia | [DJP / Coretax](https://www.pajak.go.id) |
| Brazil NF-e | [Receita Federal](https://www.gov.br/receitafederal) |
| Thailand VAT | [Revenue Department](https://www.rd.go.th) |
| Philippines VAT | [BIR](https://www.bir.gov.ph) |
| Chile IVA | [SII](https://www.sii.cl) |
| Argentina IVA | [AFIP / ARCA](https://www.afip.gob.ar) |

Neighboring Southern African markets (e.g. Botswana, Namibia, Mozambique) have **no** in-tree packs.

---

## 6. SpacetimeDB architecture decision (Expenses)

Quality benchmark for integrated expense → finance controls: NetSuite expense reporting, corporate-card accounting, and project linkage ([NetSuite Expense Management](https://www.netsuite.com/portal/products/professional-services-automation/expense-management.shtml); [Corporate Card Expenses](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1531259544.html)). Architecture constraints from SpacetimeDB: reducers are automatically transactional; procedures are the HTTP boundary ([SpacetimeDB Functions](https://spacetimedb.com/docs/functions/); [Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Subscription semantics](https://spacetimedb.com/docs/subscriptions/semantics)).

| Topic | Decision |
|-------|----------|
| **Atomic post** | Keep `post_expense_sheet` as the single txn that creates the `AccountMove` (expense / tax / payable / card / advance / FX fee lines), sets `account_move_id`, syncs line states, and audits. A “Posted” sheet without a move remains **forbidden**. Next: call shared period-open + balance helpers used by accounting close. |
| **Submit integrity** | Keep server-recomputed totals + FX snapshot inside `submit_expense_sheet`. Retain attach guards on `submit_expense`. Optionally refresh sheet total on each attach for UX consistency (non-authoritative until submit). |
| **Approvals** | Keep SoD + `gate_action_with_approval` on approve. Prefer append-only approval/exception events over sole reliance on mutable `approver_id`. Implement exception **reject**. |
| **Idempotency / mobile** | Prefer durable `client_request_id` / intent rows for create/submit/post/reimburse. Replace metadata substring matching with exact key lookup. Capture outbox remains client-side; reducers stay retry-safe. |
| **Policy** | Enforce product + company policy **server-side** (already). Extend pack overlays and category rules; never UI-only. |
| **Receipts** | Reducers validate attachment ID presence/metadata only. Blob upload, OCR, email inbox → **clients + workers** writing intents; stop accepting stub `1` in production policy mode. |
| **Subscriptions** | Keep five workspace keys. Productize inbox UIs for to-approve / missing-receipt / unmatched cards. Avoid config KPI zeros as finance truth (live override already). |
| **Isolation / scale** | Index org, company, employee, sheet, state, fraud_hold, merchant_key, external_ref. Domain tests for company A ↛ B on post/rebill/card/advance. Index names unique module-wide. |
| **External I/O** | Card feeds, FX providers, tax-authority document validation, OCR → **API workers / procedures** via `expense_integration_intent`. Reducers must not block on HTTP. |
| **Project rebill** | Keep as explicit separate reducer after post (audit boundary). Add tax; surface from projects UI; feed project margin views. |
| **Advances** | Issuance should create cash/prepaid move (or payment) in one reducer; apply remains pre-post residual math; post clears advance account. |
| **CSV** | Sheet import Draft-only (keep). Line import must default Draft-only; privileged break-glass for Posted-without-JE. |
| **UI contract repair** | Expose paymentMode, real attachments, tax/product, advances/fraud/exceptions/rate admin, refuse reason, unmatched queue — backend already ahead of UI. |

---

## 7. Priority classification

**Waves F–H status (2026-07-18):** Pilot polish, competitive productization, and differentiating tracks in [expenses-gap-fixes-plan.md](./plans/expenses-gap-fixes-plan.md) are **Done**, except two explicit stretch deferrals below. Domain suite `run_all_expenses_tests` green on local after org-scoped test hardening.

### Pilot-critical — closed (F)

| Gap | Status |
|-----|--------|
| Real receipt / attachment store (kill stub `[1n]`) | **Done** — `hr_expense_receipt` + create; stubs rejected |
| Period lock + balanced-entry assert | **Done** |
| Exact `client_request_id` idempotency | **Done** |
| CSV expense lines Draft-only | **Done** |
| Gate-enabled SoD + workflow approve path | **Done** (domain + `execute_approved_action`); Playwright lifecycle still ops-checklist |
| tax/product/paymentMode/merchantKey on forms | **Done** |
| Isolation tests rebill/card/advance | **Done** (Wave F) |

### Competitive — closed (G)

| Gap | Status |
|-----|--------|
| Mileage/per-diem dates, kind-safe update, rate admin/selects | **Done** |
| Allocation tax split + >2 shares | **Done** |
| Rebill tax + projects UI | **Done** |
| Refuse reason + inboxes + partial reimburse + drill-down | **Done** |
| Pack overlays BR/LATAM/SEA + AU FBT soft hold | **Done** |

### Differentiating — closed (H) / deferred stretch

| Gap | Status |
|-----|--------|
| Advance issuance GL + advances UI | **Done** |
| Policy exception reject + fraud admin + hash rules | **Done** |
| Card unmatch + OCR/email real `storage_key` receipts | **Done** |
| Statutory mileage seeds (AU/NZ) | **Done** |
| SW / background delayed-sync | **Deferred** — localStorage outbox remains |
| Multi-line settlement fee schedule beyond FX fee | **Deferred** |

### Remaining open (post F–H)

| Gap | Why |
|-----|-----|
| Service Worker delayed-sync | True offline field capture |
| Settlement fee schedule (multi-line) | Global card fee fidelity |
| Durable immutable approval-history table | Richer audit UX (workflow timeline + audit suffice for pilot) |
| Full category/policy matrix UI | Policy depth beyond product/company caps |
| Playwright second-identity lifecycle green in CI | Ops checklist — auth/setup sensitive |

**Recommended next work:** ops validation (Playwright lifecycle + regenerate SDKs if needed) → stretch offline SW / fee schedules only if a pilot demands them.

---

## Validation

| Check | Result |
|-------|--------|
| Tables/reducers vs `spacetimedb/src/expenses/*` | Verified 2026-07-18 |
| Imports vs `data_ops/expenses_imports.rs` | Verified |
| `post_expense_sheet` creates `AccountMove` + sets `account_move_id` | Verified |
| Pack evidence vs `core/country_pack.rs` | AU/NZ/ZA/SG flags verified |
| BFF keys vs reducers | 28 keys, 0 phantoms |
| Workspace keys vs `ERP_ORG_SQL` | All 5 wired (incl. unmatched cards) |
| UI stub receipts / missing admin surfaces | Verified in create params + capture/ops panels |
| `cargo check` (`spacetimedb/`) | **Passed** 2026-07-18 |
| Domain suite executed post F–H | **Yes** — `run_all_expenses_tests` green on local 2026-07-18 (waves A–F under `spacetimedb/tests/expenses/`) |
| Playwright lifecycle executed | **Ops checklist** — spec exists; re-run via `make e2e-single E2E_SPEC=expenses-wave-lifecycle.spec.ts` |
| Acceptance scenarios | 22 listed (≥10 required) |
| Every gap has state + priority | Yes (§2 / §7) |

---

## Bottom line

After Waves F–H, Lumiere expenses meet a **pilot-ready quality bar**: real receipts, close integrity (period lock / balance / exact idempotency / Draft-only CSV), SoD+workflow approve, travel rates, allocations with tax split, rebills with tax, regional pack evidence, advances with issuance GL, fraud/exceptions admin, and card match/unmatch with real OCR/email storage keys. Remaining stretch vs NetSuite-class depth is mainly **offline SW sync**, **multi-line settlement fee schedules**, and richer policy/approval-history UX — not core spine gaps.

### Related docs

- [Projects & PSA investigation](./PROJECTS_PSA_INVESTIGATION.md) — expense rebill / project margin adjacency
- [Accounting NetSuite gap](./ACCOUNTING_NETSUITE_GAP.md) — JE/AP/payment adjacency
- [Purchasing & Procurement investigation](./PURCHASING_PROCUREMENT_INVESTIGATION.md) — approval gate / SoD patterns
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — no Expenses wedge claim at investigation time
- Wave tracker: [expenses-gap-fixes-plan.md](./plans/expenses-gap-fixes-plan.md)
- Sub-agent coordinator: [.cursor/skills/expenses-coordinator/SKILL.md](../.cursor/skills/expenses-coordinator/SKILL.md) · [expenses-coordinator-mission.md](../.cursor/plans/expenses-coordinator-mission.md)
- Expenses module: `spacetimedb/src/expenses/`
- Expenses workspace: `frontend/packages/stdb/src/subscriptions/expenses-workspace.ts`
- UI: `frontend/web/app/(modules)/expenses/expenses-client.tsx`
- E2E: `frontend/web/tests/e2e/expenses-wave-lifecycle.spec.ts`
