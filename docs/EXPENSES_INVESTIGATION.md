# Expenses Investigation — Employee Spend, Approvals & Reimbursement

Current-state assessment of Lumiere expenses against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-17  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this investigation unless noted under Validation.

**Verdict:** Lumiere has a **thin expense-report shell** — draft lines → attach to sheet → submit → approve/refuse → “post” state flip — with live org-scoped subscriptions, BFF/hooks/UI CRUD, CSV import, and audit hooks. Against the quality bar it is **unsuitable** for financial close: `post_expense_sheet` does **not** create or link an `AccountMove`, does not reimburse, and does not recover tax. Policy, mileage, per diem, advances, corporate cards, duplicate/fraud controls, split allocations, multicurrency settlement, project rebilling, mobile delayed-sync, and durable approval routing are **Absent** or stub-only. Product flags `can_be_expensed` / `expense_policy` exist but are **not enforced**.

**Quality benchmark (not a spec):** Oracle NetSuite Expense Management patterns emphasize report lifecycle with auditable approvals, policy-aware categories (incl. mileage/per diem items), corporate-card import and GL credit to card liability, project accounting / client rebilling, and seamless reimbursement posting ([NetSuite Expense Management](https://www.netsuite.com/portal/products/professional-services-automation/expense-management.shtml); [Corporate Card Expenses](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1531259544.html); [Expense automation overview](https://www.netsuite.com/portal/resource/articles/financial-management/expense-management-automation.shtml)). Lumiere is judged on whether it can meet that *depth of control and posting integrity*, not on SuiteApp parity.

**V1 roadmap reconciliation:** `docs/V1_ROADMAP.md` does **not** currently call out an Expenses wedge. Treat this investigation as the source of truth for expenses depth until a roadmap claim is added.

**Compile check:** `cargo check` in `spacetimedb/` — **passed** (2026-07-17).

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/expenses` + adjacent)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Expense lines | `hr_expense` | `expenses/expenses.rs` | Employee line; optional product/tax/account/analytic; `attachment_ids`; `sheet_id`; `ExpenseState` |
| Expense reports | `expense_sheet` | `expenses/expenses.rs` | Report header; `account_move_id` **never set by post reducer**; `approver_id`; `ExpenseSheetState` |
| Product (adjacent) | `product_product` | `inventory/product.rs` | `can_be_expensed`, `expense_policy`, `property_account_expense_id` — **unused by expense reducers** |
| HR (adjacent) | `hr_employee` | `hr/employees.rs` | FK target for `employee_id` |
| Accounting (adjacent) | `account_move` / lines, taxes, analytics, payments | accounting | **No** expense→JE/AP/payment reducer path |
| Projects (adjacent) | `project_project` (+ analytic) | `projects/` | Project `analytic_account_id` exists; **no** expense→project rebill link |
| Workflow (adjacent) | approval gate | `workflow/` | Used by PO/sales/payments — **not** expense sheets |
| Country packs (adjacent) | tax rule seeds | `core/country_pack.rs` | Sale/WHT seeds; **no** expense VAT-evidence overlays |
| Documents | attachment IDs only | — | No receipt object / OCR / evidence-required flag |

**Enums** (`spacetimedb/src/types.rs`):  
`ExpenseState` / `ExpenseSheetState`: `Draft | Submitted | Approved | Posted | Done | Refused`. Line reducers only set `Draft`/`Submitted`; sheet approve/post do **not** sync line states. `Done` is seed/CSV-only.

### 1.2 Backend reducers (callable SpacetimeDB surface)

**Core (`expenses/expenses.rs`):**  
`create_expense`, `update_expense`, `submit_expense`, `create_expense_sheet`, `submit_expense_sheet`, `approve_expense_sheet`, `refuse_expense_sheet`, `post_expense_sheet`

| Reducer | Behavior | Gap |
|---------|----------|-----|
| `create_expense` | Draft line; `total = unit × qty` | No policy / product / receipt checks |
| `update_expense` | Draft-only; company/org guard | Cannot update attachments/tax/product |
| `submit_expense` | Line → `Submitted` + `sheet_id` | No sheet ownership / same-employee / same-company / currency checks |
| `create_expense_sheet` | Draft sheet; `account_move_id: None` | |
| `submit_expense_sheet` | Draft → `Submitted`; **client-supplied** `total_amount` | Totals not recomputed from lines |
| `approve_expense_sheet` | Submitted → `Approved`; `approver_id = sender` | Permission-only; no workflow gate; no SoD vs submitter; lines not updated |
| `refuse_expense_sheet` | → `Refused` | **No prior-state guard** (can refuse Posted) |
| `post_expense_sheet` | Approved → `Posted` + `accounting_date` | **Does not** insert `AccountMove` or set `account_move_id`; no tax/AP/reimbursement |

**Imports (`data_ops/expenses_imports.rs`):**  
`import_expense_csv`, `import_expense_sheet_csv` — bulk insert with import-job tracking; can force Approved/Posted/Done and optional `account_move_id` without workflow.

**Absent (no reducers/tables):** mileage, per diem, advances, corporate-card feed/match, policy exceptions, split allocation lines, duplicate detection, reimbursement payment, project rebill, tax reclaim JE, idempotency keys, approval-history rows, FX settlement.

### 1.3 Frontend contracts (BFF / hooks)

[`EXPENSES_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/expenses-http.ts): **10** keys. **0 phantoms** — every key has a SpacetimeDB reducer.

| Surface | Status |
|---------|--------|
| Query hooks | All 10 BFF keys + `useExpenses` / `useExpenseSheets` + CSV bundle (`hooks/expenses.ts`) |
| Create params | `toCreateExpenseParams` hardcodes empty `productId` / `taxIds` / `accountId` / `analyticAccountId` / `attachmentIds: []` |
| Post UI | Calls `post_expense_sheet` only — **no** account-move create |
| Contract test | `expenses.contract.ts` — compile-only BFF enumeration |

### 1.4 Subscriptions & queries

`EXPENSES_WORKSPACE_RESOURCE_KEYS` ([`expenses-workspace.ts`](../frontend/packages/stdb/src/subscriptions/expenses-workspace.ts)): `expenses`, `expense-sheets`.

| Key | In `ERP_ORG_SQL` | Filter / notes |
|-----|------------------|----------------|
| `expenses` | Yes | Org-scoped → `hr_expense` |
| `expense-sheets` | Yes | Org-scoped → `expense_sheet` |
| Pending-approval / missing-receipt / FX-exception queues | **No** | Client must filter full lists |
| Account moves linked to sheets | **No** | `account_move_id` unused in practice |

### 1.5 UI operations (`/expenses`)

Tabs from `expensesModuleConfig` + [`expenses-client.tsx`](../frontend/web/app/(modules)/expenses/expenses-client.tsx):

| Tab / surface | End-to-end operations | Gaps |
|---------------|----------------------|------|
| Dashboard | KPIs (static zeros in config), quick actions | **“New Report” dead** — config id `new_expense_report` vs client `new_expense_sheet` |
| Expenses | Create / edit draft / add-to-report (`submit_expense`); CSV | No receipt upload; category/tax/analytic not captured; no mileage/per diem |
| Expense sheets | Create / submit / approve / refuse / post (date); CSV | Post is state-only; no reimbursement; no SoD inbox; no approval timeline |
| Legacy form registry | `forms/config/modules/expenses.config.ts` has `receipt` File field | **Not** wired to ModuleView client |

Mobile-first / delayed-sync / OCR / camera: **Absent**.

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain | **None** for `HrExpense` / `HrExpenseSheet` | Full lifecycle, isolation, posting, refuse guards |
| Contract | `expenses.contract.ts` BFF keys | Does not prove backend presence at runtime |
| Playwright | `phase-5-workforce-smoke.spec.ts` — module renders + CSV toolbar buttons | Create → submit → approve → post → GL |
| Adjacent | Purchasing/commission tests use GL “expense accounts” | Not HR expenses |

### 1.7 Seed

`seed.rs` Tier 9: one Approved sheet (“Q1 Business Trips”) + two Approved lines (flight/hotel); `account_move_id: None`; empty attachments/taxes.

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
| Expense report (sheet) create | **Present** (MVP) | Reducers + UI | — |
| Attach line to report | **Partial** | `submit_expense`; weak sheet/company/employee guards | Pilot-critical |
| Submit report | **Partial** | State flip; **client** `total_amount` trusted | Pilot-critical |
| Approval routing | **Partial** | Permission `approve` + single `approver_id`; no `gate_action_with_approval`, no multi-step, no SoD | Pilot-critical |
| Refuse / reject | **Unsuitable** | No state precondition — can refuse non-Submitted (incl. Posted) | Pilot-critical |
| Durable approval history | **Partial** | `write_audit_log_v2` + overwriteable `approver_id`; no immutable history table / timeline UI | Competitive |
| Policy engine (limits, categories, exceptions) | **Absent** | Product `expense_policy` unused | Competitive |
| Receipt capture / evidence | **Partial** | `attachment_ids` schema; UI always `[]`; no require-receipt rules | Pilot-critical |
| Mileage | **Absent** | No rate × distance model | Competitive |
| Per diem | **Absent** | No schedule / location rates | Competitive |
| Advances | **Absent** | No advance tables / apply-to-report | Differentiating |
| Corporate cards | **Absent** | No card feed, liability account, personal-vs-corp split | Differentiating |
| Reimbursements (employee payable / payment) | **Absent** | No payment/AP from sheet | Pilot-critical |
| Project rebilling | **Absent** | Optional analytic only; projects not wired | Competitive |
| Tax recovery / VAT reclaim | **Partial** | `tax_ids` stored; never applied on post | Competitive |
| Duplicate / fraud detection | **Absent** | No hash/merchant/date/amount checks | Differentiating |
| Policy exceptions | **Absent** | No exception request / override audit | Differentiating |
| Split allocations | **Absent** | Single `analytic_account_id` | Competitive |
| Multicurrency settlement | **Partial** | `currency_id` only; no FX snapshot / company-currency post | Competitive |
| Accounting post / reconciliation | **Unsuitable** | `post_expense_sheet` state-only; `account_move_id` unset; no GL drill-down | Pilot-critical |
| Atomic AP / project accounting post | **Absent** | No JE/AP in-txn with post | Pilot-critical |
| Idempotent submissions | **Absent** | No client request / offline key | Pilot-critical |
| Mobile-first / delayed-sync | **Absent** | No offline outbox / conflict model | Competitive |
| Region tax-evidence requirements | **Absent** | No pack-driven receipt/tax-invoice rules | Competitive |
| Live exception queues | **Absent** | Only full-table org SQL | Competitive |
| Multi-entity isolation | **Partial** | Org + company guards on update; no isolation domain tests; submit_expense weak | Pilot-critical |
| Audit coverage | **Present** (MVP) | Mutators call `write_audit_log_v2` (sparse old/new snapshots) | — |
| Phantom UI contracts | **Present** (cleared) | BFF ⊆ reducers (10/10) | — |
| Dashboard / KPI fidelity | **Unsuitable** | Static “0” KPIs; dead New Report quick action | Competitive |
| CSV bootstrap | **Present** (MVP) | Import reducers + UI toolbar; bypasses workflow | — |

---

## 3. Required invariants

### Accounting

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Post creates balanced JE / AP exposure | **No** | `post_expense_sheet` state-only | Single reducer: create `AccountMove` (+ lines from expenses), set `account_move_id`, mark lines Posted |
| Out-of-pocket → employee payable / reimbursement | **No** | No payment path | Atomic create payable or payment batch; corporate-card path credits card liability instead |
| Tax recoverable amount recorded | **No** | `tax_ids` unused | Snapshot tax bases on post; reclaim account lines; evidence gate by pack |
| Sheet total = sum(lines) | **No** | Client `SubmitExpenseSheetParams.total_amount` | Server recompute; reject mismatch |
| FX snapshot at submit/approve/post | **No** | Currency id only | Immutable rate for settlement currency |
| Analytic / project cost capture | **Partial** | Optional `analytic_account_id` | Enforce billable project link; optional rebill to AR |
| Period locks | **No** (expenses) | Accounting close elsewhere | Block post when period locked |
| Reimbursement ↔ bank reconcile drill-down | **No** | No move link | Sheet → move → payment → bank statement |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Reducer permissions | Yes (pattern) | `check_permission` on `hr_expense` / `hr_expense_sheet` | Keep deny-by-default for new mutators |
| Tenant / company ownership | Partial | Org/company on update/create; submit_expense lacks sheet company check | Guard every cross-entity attach; domain isolation tests |
| Approval SoD | **No** | Approver may be submitter; refuse lacks state guard | Workflow gate + non-self-approve; refuse only Submitted |
| Field-level policy | **No** | Product policy unused | Enforce category/amount/receipt rules server-side |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Append-only mutation log | Yes (MVP) | `write_audit_log_v2` on mutators | Richer old/new JSON; cover imports edge cases |
| Immutable approval history | Partial | Single `approver_id` + audit | Append-only approval events (actor, decision, reason, timestamp); UI timeline |
| Source-document links | **No** | `account_move_id` unused | Sheet → move → payment; receipt attachment references |

### Concurrency / integrity

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Atomic post + GL | **No** | State flip only | One reducer txn for post+JE(+payable) |
| Stale-state rejection | Partial | Draft/Submitted/Approved preconditions on some paths; refuse open | Harden refuse; sync line states; reject double-post via `account_move_id.is_some()` |
| Idempotent submit/post | **No** | Retries can double-submit conceptually | Idempotency keys for offline/mobile; post no-op if already Posted with same key |
| No client multi-step financial commit | Intent violated in spirit | UI “post” implies accounting without server JE | Never claim Posted without move; never orchestrate JE create as a second client call without server guards |
| Live exception queues | **No** | Full-table subscriptions only | Bounded SQL: Submitted pending approve; missing attachments; FX mismatch |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). External HTTP (card feeds, OCR, FX providers, tax authority) belongs in procedures/workers, not reducers.

---

## 4. Reference workflows

1. **Capture expense line (draft)** — Present (MVP UI); category/tax/receipt Partial/Absent.
2. **Attach receipt evidence** — Schema Partial; live capture Absent; legacy form unwired.
3. **Create report → add lines → submit** — Present path; totals Unsuitable (client-trusted).
4. **Approval routing / SoD** — Partial permission approve; workflow gate Absent.
5. **Refuse with reason** — Partial state flip; Unsuitable guards; reason Absent.
6. **Post to GL / AP** — Unsuitable (state-only).
7. **Reimburse employee** — Absent.
8. **Corporate card import → match → credit liability** — Absent.
9. **Mileage / per diem calculate** — Absent.
10. **Advance issue → apply → settle** — Absent.
11. **Project analytic + client rebill** — Absent (analytic optional stub).
12. **VAT/GST reclaim with evidence** — Partial store / Absent reclaim.
13. **Duplicate / fraud hold** — Absent.
14. **Split cost across analytics/projects** — Absent.
15. **Multicurrency settlement** — Partial currency id.
16. **Mobile offline capture → delayed sync** — Absent.
17. **Cross-company isolation** — Partial guards; tests Absent.
18. **CSV bootstrap** — Present (bypasses workflow — operational risk).
19. **Live pending-approval queue** — Absent subscription; list filter only.
20. **Drill-down report → JE → payment** — Absent.

### Acceptance scenarios (≥12)

1. Employee creates Draft expense with category (product), amount, currency, tax, and required receipt attachment per company policy; audit CREATE.
2. Employee creates Draft sheet, attaches ≥1 Draft line (`submit_expense`); server rejects cross-company / wrong-employee / missing sheet.
3. Submit sheet recomputes `total_amount` from lines; client-supplied mismatch fails closed; lines + sheet → `Submitted`.
4. Approver (≠ submitter) approves via workflow gate → `Approved`, immutable approval history row, line states sync to Approved.
5. Self-approve blocked (SoD); second approval step when amount > policy threshold.
6. Refuse only from `Submitted`, with reason; lines return to editable Draft or sheet `Refused` per policy; cannot refuse `Posted`.
7. `post_expense_sheet` in one transaction: balanced `AccountMove` (Dr expense / tax recoverable, Cr employee payable or card liability), sets `account_move_id`, sheet+lines → `Posted`; re-post is idempotent no-op or hard fail.
8. Reimbursement payment clears employee payable; bank reconcile drills sheet → move → payment.
9. Corporate-card line posts Cr card liability (not employee payable); statement match closes card GL.
10. Mileage: distance × rate (policy currency) creates line; per diem: location/date schedule amount; both honor caps.
11. Split allocation: one receipt → N analytic/project shares totaling 100%; billable share available for project rebill invoice.
12. Duplicate detection: same employee + merchant/date/amount (±tol) or same attachment hash blocks or holds for review.
13. Multicurrency: foreign receipt stores FX snapshot at submit/approve; company-currency post uses snapshot; variance account explicit.
14. Tax reclaim: GST/VAT input tax line posted only when evidence requirements satisfied (tax invoice fields / attachment).
15. Offline mobile: capture with idempotency key; delayed sync submits once; conflict on stale sheet state surfaces for resolve.
16. Company B cannot approve/post company A’s sheet (domain + e2e).
17. Period lock blocks post; open period allows post and appears on P&amp;L / AP aging drill-down.
18. CSV import into Draft only (or privileged path); cannot silently create Posted sheets without JE in production policy mode.
19. Exception subscriptions update live: Submitted-to-approve, missing-receipt, over-policy holds — without full-table client scans.
20. Policy exception: manager grants one-time override; immutable exception record; still posts with exception flag in audit metadata.

---

## 5. Localization matrix (expenses / tax-evidence / settlement)

Country packs today are **tax-seed + company-ID metadata** (`spacetimedb/src/core/country_pack.rs`). Expenses need **evidence and reclaim overlays** (tax invoice fields, FBT/entertainment limits, mileage rate tables, currency defaults) — not only sale-tax seeds. Pack metadata must not be mistaken for live statutory adapters.

**i18n:** UI ships **English only** (`SupportedLanguage = "en"`). Expense strings live under module/dashboard configs and `en.json` where present. Country packs are not language packs.

Rates and rules below are **dated requirements as of 2026-07-17**, cited from official sources where linked — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA only in-tree) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|-----------------------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` only | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| VAT/GST seed | GST-AU 10%; GST-NZ 15% | VAT-ZA 15% | ICMS/IVA seeds | GST/SST/PPN/VAT seeds |
| Input-tax reclaim evidence | Tax invoice / valid GST tax invoice rules (ATO / IRD) — **not** expense-wired | Tax invoice for VAT vendors — **not** expense-wired | NF-e / recibos rules for reclaim — outside reducers | IRAS / SST / e-Faktur / BIR / RD evidence — **not** expense-wired |
| Mileage | ATO cents/km methods; IRD mileage rates — need rate tables | SARS travel allowances — need rates | Local km tables / CL / AR practices | Common corporate rate tables; not statutory-unified |
| Per diem / travel | Common corporate policies; FBT risk on entertainment/cars (AU) | Subsistence allowances common | Per diem + FX (ARS) volatility | Per diem + multi-currency travel |
| Corporate cards | Common; settlement AUD/NZD | Common ZAR | High FX / card FX fees | Multi-currency cards common (SGD/MYR/…) |
| Employee reimbursement FX | Snapshot AUD/NZD functional | ZAR functional | BRL/ARS/CLP; ARS volatility → FX snapshot critical | SGD + regional currencies; MY e-Invoice adjacency for suppliers not employees |
| Advances | Policy + payroll interaction | Same | Same | Same |
| Expenses pack gap | Require tax-invoice attachment for GST reclaim; FBT flags on entertainment | VAT tax-invoice fields on receipt | NF-e / local receipt types as **procedures** for validation | Configurable evidence by pack; MY/ID e-invoice **workers** for merchant docs — not in-reducer HTTP |

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
| **Atomic post** | `post_expense_sheet` must create the `AccountMove` (and employee payable or card liability lines), set `account_move_id`, sync line states, and write audit **in one reducer**. A “Posted” sheet without a move is **forbidden** (treat current behavior as Unsuitable transitional debt). |
| **Submit integrity** | Recompute sheet totals from lines inside `submit_expense_sheet`. Reject empty sheets, currency mismatches, and cross-company attaches inside `submit_expense`. |
| **Approvals** | Route sheet submit/approve through `gate_action_with_approval` (or equivalent durable workflow) with SoD; keep append-only approval events (do not rely solely on mutable `approver_id`). |
| **Idempotency / mobile** | Add optional `client_request_id` (or outbox intent row) on create/submit/post for delayed-sync. Reducers must be safe under retry. |
| **Policy** | Enforce `can_be_expensed` / `expense_policy` (and future limit tables) **server-side** on create/submit — never UI-only. |
| **Receipts** | Store attachment references in-reducer; require evidence by category/pack before submit/post. OCR/camera capture and blob upload stay in **clients + workers**; reducers validate IDs/metadata only. |
| **Subscriptions** | Keep org-scoped `expenses` / `expense-sheets`. Add **bounded** queues: `expense-sheets-to-approve`, missing-receipt, over-policy holds. Avoid deriving finance truth from client-only KPI zeros. |
| **Isolation / scale** | Index org, company, employee, sheet, state. Domain tests: company A cannot approve/post company B. Index names unique module-wide. |
| **External I/O** | Corporate-card feeds, FX rate providers, tax-authority document validation, OCR → behind **API workers / procedures** with durable `expense_integration_intent` (or reuse a generic integration intent). Reducers must not block on HTTP. |
| **Project rebill** | Prefer posting analytic lines in the same post transaction; client invoice/rebill as a separate explicit reducer linked by sheet/move id — not a silent side effect without audit. |
| **CSV** | Restrict production imports to Draft (or privileged break-glass); never allow Posted-without-JE via CSV in default policy. |

---

## 7. Priority classification

### Pilot-critical

| Gap | Status | Notes |
|-----|--------|-------|
| Atomic GL/AP post on `post_expense_sheet` | **Open** | Unsuitable today — state flip only |
| Server-computed sheet totals | **Open** | Client `total_amount` trusted |
| Refuse state guards + line state sync | **Open** | Can refuse Posted; lines stuck Submitted |
| Approval SoD / workflow gate | **Open** | Permission-only approve |
| Receipt evidence on create/submit (minimal) | **Open** | UI `attachmentIds: []` |
| Company isolation domain tests | **Open** | No expense domain suite |
| Idempotency keys for submit/post | **Open** | Required for delayed-sync foundation |
| Reimbursement path (employee payable + payment) | **Open** | Without this, “reimbursement” UI copy is false |
| Fix dead “New Report” quick action | **Open** | Config/client id mismatch |
| Domain + Playwright lifecycle after posting exists | **Open** | Smoke only today |

### Competitive

| Gap | Status | Notes |
|-----|--------|-------|
| Policy engine (limits, category, require-receipt) | **Open** | Product flags unused |
| Mileage + per diem rate tables | **Open** | |
| Tax recovery on post | **Open** | `tax_ids` unused |
| Multicurrency FX snapshot / settlement | **Open** | |
| Project analytic enforce + rebill | **Open** | Projects module adjacent |
| Split allocations | **Open** | |
| Bounded exception subscriptions + live KPIs | **Open** | Dashboard stats static |
| Durable approval timeline UI | **Open** | |
| Pack-driven tax-evidence rules | **Open** | |
| Mobile capture UX (online-first) | **Open** | Full offline = differentiating |

### Differentiating

| Gap | Status | Notes |
|-----|--------|-------|
| Corporate card feed + statement match | **Open** | Intent/worker pattern |
| Duplicate / fraud detection | **Open** | |
| Advances lifecycle | **Open** | |
| Policy exceptions with immutable override records | **Open** | |
| OCR / email inbox receipt ingestion | **Open** | External workers |
| Cross-border card FX fee handling | **Open** | |
| Delayed-sync outbox with conflict UI | **Open** | Builds on idempotency |

**Recommended first wave (pilot):** make post financially real (JE + `account_move_id` + line sync) → server totals + refuse guards → SoD approve → minimal receipt required → isolation + lifecycle tests → reimbursement payment. Then policy/mileage/FX/queues; then cards/fraud/advances/offline.

---

## Validation

| Check | Result |
|-------|--------|
| Tables/reducers vs `spacetimedb/src/expenses/*` | Verified 2026-07-17 |
| Imports vs `data_ops/expenses_imports.rs` | Verified |
| BFF keys vs reducers | 10 keys, 0 phantoms |
| Workspace keys vs `ERP_ORG_SQL` | `expenses`, `expense-sheets` wired |
| `cargo check` (`spacetimedb/`) | **Passed** 2026-07-17 |
| Domain/E2E suites executed in this investigation | **No** — existence only (smoke render/CSV) |
| Acceptance scenarios | 20 listed (≥10 required) |
| Every gap has state + priority | Yes (§2 / §7) |

---

## Bottom line

Lumiere expenses are a **report-state machine with UI**, not an integrated spend-to-ledger product. The single highest-severity defect against the quality bar is **`post_expense_sheet` claiming Posted without accounting**: until post atomically writes GL/AP (or card liability), sets `account_move_id`, and supports reimbursement, Expenses cannot support close, audit drill-down, or NetSuite-class operational finance. Everything else (policy, cards, mileage, fraud, mobile sync, localization evidence) builds on that spine.

### Related docs

- [Accounting NetSuite gap](./ACCOUNTING_NETSUITE_GAP.md) — JE/AP/payment adjacency
- [Purchasing & Procurement investigation](./PURCHASING_PROCUREMENT_INVESTIGATION.md) — approval gate / SoD / three-way patterns to reuse
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — no Expenses wedge claim at investigation time
- Expenses module: `spacetimedb/src/expenses/`
- Expenses workspace: `frontend/packages/stdb/src/subscriptions/expenses-workspace.ts`
- UI: `frontend/web/app/(modules)/expenses/expenses-client.tsx`
- E2E smoke: `frontend/web/tests/e2e/phase-5-workforce-smoke.spec.ts`
