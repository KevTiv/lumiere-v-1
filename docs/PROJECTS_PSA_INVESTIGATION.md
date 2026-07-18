# Projects & Professional Services Automation — Investigation

Current-state assessment of Lumiere projects / PSA against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-18  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this investigation unless noted under Validation.

**Verdict:** Lumiere has a **thin project operations shell** — project header → hierarchical tasks → draft timesheets → manager validate → `bill_timesheets` draft AR invoice — with org-scoped live SQL, BFF/hooks/UI, CSV import, and audit hooks. Against the quality bar it is **unsuitable for professional services close**: UI create-project hardcodes an **invalid** `bill_type` (`non_billable`), timesheet log/start mappers omit required server params, validated time is **not** an immutable approved snapshot, billing uses `employee_cost` as price (no rate card), and there is **no** WBS entity, milestone object, resource skills/allocation engine, project budget/forecast, utilisation/profitability/EVM, change orders, subcontractor management, project revenue recognition, or working-calendar capacity model. Expense→project rebill exists in the expenses domain (adjacent Present); project-margin and resource-capacity **live views are Absent**.

**Quality benchmark (not a spec):** Oracle NetSuite PSA / Project Management patterns emphasize project setup with WBS and billing rules, resource planning with skills and calendars, timesheets/expenses with approval, project accounting (cost, revenue, profitability), milestone/time-and-materials billing, and integrated financial drill-down ([NetSuite PSA](https://www.netsuite.com/portal/products/professional-services-automation.shtml); [Project Management](https://www.netsuite.com/portal/products/erp/project-management.shtml); [Advanced Revenue Management](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2788750.html)). Lumiere is judged on whether it can meet that *depth of control and posting integrity*, not on SuiteApp parity.

**V1 roadmap reconciliation:** `docs/V1_ROADMAP.md` does **not** currently call out a Projects / PSA wedge. Treat this investigation as the source of truth for PSA depth until a roadmap claim is added.

**Compile check:** `cargo check` in `spacetimedb/` — **passed** (2026-07-18; unrelated warnings in subscriptions).

**Trackers:** [Gap-fixes plan](./plans/projects-psa-gap-fixes-plan.md) · [Coordinator mission](../.cursor/plans/projects-psa-coordinator-mission.md) · [Coordinator skill](../.cursor/skills/projects-psa-coordinator/SKILL.md)

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/projects` + adjacent)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Project header | `project_project` | `projects/projects.rs` | Partner, dates, bill/pricing strings, SO/line FKs, analytic, task counters, allow_* flags (incl. `allow_forecast` with **no forecast tables**) |
| Tasks / light WBS | `project_task` | `projects/tasks.rs` | `parent_id` / `child_ids`, deps, hours/progress, unused `milestone_id`, SO/line FKs |
| Timesheets | `project_timesheet` | `projects/timesheets.rs` | Hours, timer, `employee_cost`, `timesheet_invoice_type`, `validation_status`, `timesheet_invoice_id` |
| Milestone entity | — | — | **No table**; `milestone_id` Option only |
| Rate card / pricing | — | — | **No table**; pricing via free-form `employee_cost` + project `pricing_type` string |
| Resource allocation | — | — | **No allocation / booking table** |
| Project budget / forecast / change order | — | — | `allow_forecast` flag only |
| HR capacity (adjacent) | `hr_resource` | `hr/employees.rs` | `time_efficiency`; **not** subscribed or used by projects UI |
| HR people (adjacent) | `hr_employee` | `hr/employees.rs` | Roster on Resources tab; `resource_id` optional |
| Leave (adjacent) | `hr_leave_type`, `hr_leave` | `hr/leaves.rs` | **Not** linked to project allocation |
| Skills (PSA) | — | — | AI skill registry only — **not** employee competency for staffing |
| Working calendar / holidays | — | — | Manufacturing `resource_calendar_id` stub on workcenters; **no** PSA calendar tables |
| Budgets (adjacent) | `crossovered_budget`, `crossovered_budget_lines` | `accounting/budgeting.rs` | Analytic optional; **no** `project_id` |
| Analytic lines (adjacent) | `account_analytic_line` | accounting | Optional `project_id` in schema; project UI does not drive it |
| Expense rebill (adjacent) | `hr_expense`, allocations, sheet `rebill_move_id` | `expenses/` | `create_expense_project_rebill` posts client AR from billable project/alloc shares |
| Rev-rec (adjacent) | `revenue_recognition_rule`, deferred schedules | `subscriptions/` | Product/category subscription path — **not** project/milestone POC |
| Country packs (adjacent) | tax/WHT seeds | `core/country_pack.rs` | Sale/WHT; **no** timesheet/tax-on-services / calendar overlays |

**Enums / string lifecycles (`spacetimedb/src/types.rs` + free strings):**

| Concept | Values | Notes |
|---------|--------|-------|
| `BillType` | `customer_project`, `customer_task`, `no` | UI mapper sends **`non_billable`** → reducer rejects |
| `PricingType` | `task_rate`, `fixed_rate`, `employee_rate` | Stored; **not** applied in billing math |
| `TimesheetInvoiceType` | `billable`, `non_billable`, `timesheet_revenues` | Derived from project bill_type when omitted |
| `TaskState` | InProgress, ChangesRequested, Approved, Cancelled, Done | Typed enum |
| `validation_status` | free string (`draft` / `validated` in code) | No enum; no reject/reopen path |
| Project stages | `stage_id: Option<u64>` | **No** stage table |

### 1.2 Backend reducers (callable SpacetimeDB surface)

**Projects (`projects/projects.rs`):**  
`create_project`, `update_project`, `set_project_active`, `toggle_project_favorite`

**Tasks (`projects/tasks.rs`):**  
`create_task`, `update_task`, `update_task_state`, `set_task_parent`, `assign_task_users`

**Timesheets (`projects/timesheets.rs`):**  
`log_timesheet`, `start_timesheet_timer`, `stop_timesheet_timer`, `validate_timesheets`

**Imports (`data_ops/project_imports.rs`):**  
`import_project_csv`, `import_task_csv`, `import_timesheet_csv`

**Billing (`accounting/journal_entries.rs`):**  
`bill_timesheets` — creates Draft `OutInvoice` + lines; sets `timesheet_invoice_id`

**Adjacent expense rebill (`expenses/expense_depth.rs`):**  
`create_expense_project_rebill`

| Reducer | Behavior | Gap |
|---------|----------|-----|
| `create_project` | Validates name unique, `BillType`/`PricingType`; inserts header | No WBS seed, no rate schedule, no team roster, no analytic auto-create |
| `update_project` | Partial field update + company guard | Task counters client-trustable via params history; no delete |
| `set_project_active` / `toggle_project_favorite` | Soft lifecycle / UX | No formal close / archive accounting freeze |
| `create_task` / `update_task` | Task CRUD; parent/child maintained on `set_task_parent` | `milestone_id` unused; no stage catalog; planned hours free-form |
| `update_task_state` | State transition | No dependency-gate enforcement beyond stored deps |
| `assign_task_users` | Identity list on task | Not capacity booking; no skill match |
| `log_timesheet` | Draft hours; updates task spent hours; `amount = hours × employee_cost` | Does **not** check `allow_timesheets`; cost≠bill rate; no calendar/holiday; no leave overlap |
| `start/stop_timesheet_timer` | Running timer → hours | Same pricing issues; no overlap/double-timer guard across entries |
| `validate_timesheets` | Sets `validated` + actor/time | **No SoD** vs logger; no immutability lock; no reject; no hours snapshot freeze |
| `bill_timesheets` | Atomic draft invoice + link | Tax 0; price = `employee_cost`; no rate card; invoice stays Draft; no project margin post; no FX snapshot |
| CSV imports | Bulk insert + import job | Can seed validated/billable without workflow |
| `create_expense_project_rebill` | Posted sheet → client invoice | Lives in expenses; project module does not surface |

**Absent (no reducers/tables):** WBS dictionary, milestone CRUD, rate cards, resource allocation / booking, skills matrix, capacity forecast, utilisation rollups, project budget/forecast versions, change orders, subcontractor POs linked to project, earned-value metrics, project POC/milestone rev-rec, working calendars / public holidays, immutable approved-time snapshot table, billing snapshot table (beyond `timesheet_invoice_id`), delete_* project/task/timesheet.

### 1.3 Frontend contracts (BFF / hooks)

[`PROJECTS_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/projects-http.ts): **17** keys. **0 phantoms** — every key has a SpacetimeDB reducer.

| Surface | Status |
|---------|--------|
| Query hooks | All 17 BFF keys + `useProjects` / `useTasks` / `useTimesheets` + CSV (`hooks/projects.ts`) |
| Create project params | `toCreateProjectParams` hardcodes `billType: 'non_billable'` (**invalid** vs `BillType`) and `pricingType: 'task_rate'`; analytic/SO unset; `allocatedHours` → metadata JSON only |
| Log timesheet params | `toLogTimesheetParams` emits UI-shaped fields (`billable`, `validated`, `encoding`) — **missing** `employeeId`, `currencyId`, `employeeCost`, `encodingUomId`, `timesheetInvoiceType` |
| Bill UI | Calls `bill_timesheets` with journal / partner / income account | Draft AR only |
| Contract test | `projects.contract.ts` — compile-only BFF enumeration |

### 1.4 Subscriptions & queries

`PROJECTS_WORKSPACE_RESOURCE_KEYS` ([`projects-workspace.ts`](../frontend/packages/stdb/src/subscriptions/projects-workspace.ts)): `projects`, `tasks`, `timesheets`.

| Key | In `ERP_ORG_SQL` | Filter / notes |
|-----|------------------|----------------|
| `projects` | Yes | Org-scoped → `project_project` |
| `tasks` | Yes | Org-scoped → `project_task` |
| `timesheets` | Yes | Org-scoped → `project_timesheet` |
| Live resource-capacity view | **No** | Resources tab rolls up employees + timesheet hours client-side |
| Live project-margin view | **No** | Budget health widget has no data override |
| Pending-validate / unbilled queues | **No** | Client must filter full lists |
| `hr-resources` / leave | **No** | Not in projects workspace |

### 1.5 UI operations (`/projects`)

Tabs from `projectsModuleConfig` + [`projects-client.tsx`](../frontend/web/app/(modules)/projects/projects-client.tsx) / [`projects-panels.tsx`](../frontend/web/app/(modules)/projects/projects-panels.tsx):

| Tab / surface | End-to-end operations | Gaps |
|---------------|----------------------|------|
| Dashboard | KPIs / quick actions / “milestones” / budget widgets | Milestone widget = deadline tasks; budget empty; quick-action IDs `log_time` / `view_timesheets` **mismatch** handlers |
| Projects | Create / edit / activate-archive / favorite / CSV | Create likely **fails closed** on invalid `bill_type`; billing/pricing flags not in form |
| Tasks | Create / edit / state / parent / assign / CSV | No milestone picker; WBS = parent only; no Gantt engine |
| Timesheets | Log / timer start-stop / validate / bill / CSV | Log/start params **structurally incomplete** |
| Resources | Employees table | Not allocation planning |
| Gantt (injected) | Progress/hours summary table | **Not** a scheduling Gantt |
| Resource allocation (injected) | Hours rollup table | **Not** booking / capacity |

Mobile-first / offline timesheet: **Absent**.

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain (Rust) | **None** under `spacetimedb/tests` for projects/timesheets | Lifecycle, isolation, validate immutability, bill atomicity |
| Contract | `projects.contract.ts` BFF keys | Does not prove runtime reducer presence |
| Playwright | `phase-5-workforce-smoke.spec.ts` — Projects tab renders Gantt/Resources | Create → log → validate → bill → AR |
| Adjacent | `spacetimedb/tests/expenses/wave_c_test.rs` — `create_expense_project_rebill` | Expense↔project only |

### 1.7 Seed

`seed.rs`: sample projects/tasks/timesheets (mixed `validation_status` draft/validated); `timesheet_invoice_type` billable; `hr_resource` capacity seeds exist for HR but are not project-linked; manufacturing `resource_calendar_id: None`.

---

## 2. Gap matrix (quality bar vs inventory)

Definitions:

- **Present** — usable end to end with operational and/or financial consequences.
- **Partial** — implemented at limited depth, or missing an essential UI, policy, reporting, or integration layer.
- **Absent** — no meaningful implementation.
- **Unsuitable** — surface exists but cannot safely meet the workflow / accounting requirement.

| Capability | State | Evidence | Priority |
|------------|-------|----------|----------|
| Project setup (header) | **Unsuitable** (UI) / **Partial** (API) | Reducer OK; UI `bill_type: non_billable` invalid | Pilot-critical |
| WBS | **Partial** | `parent_id`/`child_ids` + `set_task_parent`; no WBS codes/levels/dictionary | Competitive |
| Task lifecycle | **Present** (MVP) | Create/update/state/assign + audit | — |
| Milestones | **Absent** | `milestone_id` stub; dashboard fake | Competitive |
| Resource planning / allocation | **Absent** | Rollup tables only; no booking rows | Pilot-critical |
| Skills / competency matching | **Absent** | AI skills ≠ HR skills | Competitive |
| Rate cards (employee/task/project) | **Absent** | `employee_cost` free-form; `PricingType` unused in bill | Pilot-critical |
| Timesheet capture | **Unsuitable** (UI) / **Partial** (API) | Reducers exist; mapper missing required fields | Pilot-critical |
| Timer | **Partial** | Start/stop; no overlap rules | Competitive |
| Timesheet approval | **Partial** | `validate_timesheets`; no SoD, reject, workflow gate | Pilot-critical |
| Immutable approved-time snapshot | **Unsuitable** | Status flip only; no freeze / snapshot table; no edit reducer but no lock either | Pilot-critical |
| Expenses on project | **Partial** (adjacent) | Expense `project_id` + allocations + rebill | Competitive |
| Project budgets | **Absent** | Budget module analytic-only; dashboard empty | Competitive |
| Forecasts / capacity forecasting | **Absent** | `allow_forecast` flag only | Differentiating |
| Change orders | **Absent** | No tables/reducers | Differentiating |
| Billing (T&M) | **Partial** | `bill_timesheets` draft invoice; cost-as-price; no tax | Pilot-critical |
| Billing (fixed / milestone) | **Absent** | `BillType` strings unused in bill path | Competitive |
| Project accounting / WIP | **Absent** | No WIP/costing JE from time | Competitive |
| Utilisation reporting | **Absent** | No available-hours vs booked/actual | Competitive |
| Profitability / project margin | **Absent** | No live margin subscription; revenue≈cost | Pilot-critical |
| Earned value (EV/PV/AC) | **Absent** | No EV metrics | Differentiating |
| Revenue recognition (project) | **Absent** | Subscription rev-rec only | Competitive |
| Subcontractor management | **Absent** | No vendor PO→project cost link in PSA | Differentiating |
| Working calendars / public holidays | **Absent** | No PSA calendar; leave not capacity-aware | Competitive |
| Multicurrency project / FX | **Partial** | `currency_id` on project/timesheet; bill copies first sheet currency; no FX snapshot | Competitive |
| Tax on professional services | **Absent** on bill path | `amount_tax: 0.0` in `bill_timesheets` | Pilot-critical |
| Multi-entity isolation | **Partial** | Org/company guards on most mutators; no isolation domain tests | Pilot-critical |
| Audit coverage | **Present** (MVP) | Mutators call `write_audit_log_v2` | — |
| Live capacity / margin subscriptions | **Absent** | Full-table org SQL only | Competitive |
| Drill-down time → invoice → GL | **Partial** | `timesheet_invoice_id` → Draft move; post/tax/payment outside path | Pilot-critical |
| Extensibility / CSV bootstrap | **Present** (MVP) | Imports + metadata; bypasses approval | — |
| Lifecycle (close project) | **Partial** | `active` flag only; no financial freeze | Competitive |
| Integrations (calendar, payroll, PSA tools) | **Absent** | No intent/worker boundary for PSA | Differentiating |
| Phantom UI contracts | **Present** (cleared) | BFF ⊆ reducers (17/17) | — |
| Dashboard fidelity | **Unsuitable** | Dead quick actions; cosmetic milestones/budget | Competitive |

---

## 3. Required invariants

### Accounting

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Billable time → AR uses contractual rate | **No** | `price_unit = employee_cost` | Rate card / SO line / task rate snapshot at validate or bill |
| Tax on services invoice | **No** | `amount_tax: 0` | Apply fiscal position / pack tax on `bill_timesheets` or post step |
| Validated time immutable for billing | **No** | Status only | Reject mutations when `validated` or `timesheet_invoice_id.is_some()`; optional immutable snapshot row |
| Billing snapshot durable | **Partial** | `timesheet_invoice_id` set in same txn as Draft move | Also snapshot hours, rate, currency, FX, tax base; post invoice in controlled step |
| Project cost ≠ billable revenue | **No** | `amount` and `timesheet_revenue` both `hours × employee_cost` | Separate cost rate vs sell rate; margin = billed − cost − expenses |
| Analytic / WIP capture | **Partial** | Optional analytic on project/timesheet → line | Enforce analytic on billable projects; optional WIP JE on validate |
| Expense rebill consistency | **Partial** (expenses) | Rebill from posted sheet + billable allocs | Surface in project margin; prevent double-bill vs timesheet |
| Period locks | **No** (PSA) | Accounting close elsewhere | Block validate/bill/post when period locked |
| Project budget vs actual | **No** | No project budget link | Budget lines by project/analytic; variance in live view |
| Project rev-rec (POC/milestone) | **No** | Subscription rules only | Project schedule / milestone percent or deliverable recognition |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Reducer permissions | Yes (pattern) | `check_permission` on project/task/timesheet/account_move | Keep deny-by-default |
| Tenant / company ownership | Partial | Guards on create/update/validate/bill | Domain isolation tests; log path employee belongs to company |
| Approval SoD | **No** | Validator may be logger | Workflow gate + non-self-validate; manager hierarchy optional |
| Field-level rate visibility | **No** | Cost/rate on same row | Separate cost (internal) vs sell rate permissions |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Append-only mutation log | Yes (MVP) | `write_audit_log_v2` | Richer old/new for validate/bill rate snapshots |
| Immutable approval history | Partial | `validated_by` / `validated_at` overwriteable conceptually | Append-only validation events (actor, decision, reason) |
| Source-document links | Partial | `timesheet_invoice_id`; expense `rebill_move_id` | UI drill-down time → invoice → payment; project cost ledger |

### Concurrency / integrity

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Atomic bill + link | **Yes** (draft) | One reducer creates move + marks sheets | Extend to tax compute; post optionally separate with period lock |
| Stale-state rejection | Partial | Already-invoiced rejected; validated not frozen | Lock validated; reject re-validate without reopen |
| Idempotent bill | Partial | Second bill fails if `timesheet_invoice_id` set | Explicit `client_request_id` for retries |
| No client multi-step financial commit | Intent OK for bill | Single `bill_timesheets` | Never invent margin/KPI from client-only zeros |
| Live capacity / margin | **No** | Full-table subscriptions | Bounded SQL: unbilled validated hours; resource remaining capacity; project margin |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). External HTTP (payroll export, calendar sync, FX, tax authority) belongs in procedures/workers, not reducers.

---

## 4. Reference workflows

1. **Create billable project** (partner, currency, bill/pricing type, analytic) — API Partial; UI Unsuitable (`bill_type`).
2. **Define WBS / task tree** — Partial parent/child; no WBS codes.
3. **Define milestones & billing events** — Absent.
4. **Configure rate card / SO linkage** — Schema Partial (SO FKs); rates Absent.
5. **Plan resources (skills, allocation, calendar)** — Absent; Resources tab Partial roster.
6. **Log time (manual / timer)** — API Partial; UI Unsuitable (params).
7. **Submit → validate timesheets (SoD)** — Partial validate; SoD Absent.
8. **Immutable approved-time snapshot** — Unsuitable.
9. **Bill T&M → tax → post AR** — Partial draft invoice; tax/post Absent in path.
10. **Bill fixed-price / milestone** — Absent.
11. **Expense capture → project cost → client rebill** — Adjacent Partial/Present (expenses).
12. **Project budget vs actual / forecast** — Absent.
13. **Utilisation & capacity forecast** — Absent.
14. **Project profitability / margin live view** — Absent.
15. **Earned value / POC revenue recognition** — Absent.
16. **Change order → rebaseline** — Absent.
17. **Subcontractor cost → project** — Absent.
18. **Multi-entity / multi-currency distributed team** — Partial guards; calendars/FX Absent.
19. **CSV bootstrap** — Present (workflow bypass risk).
20. **Drill-down project → time → invoice → GL/payment** — Partial link only.

### Acceptance scenarios (≥12)

1. PM creates project with valid `bill_type` (`customer_task` / `customer_project` / `no`), currency, partner, analytic; audit CREATE; UI rejects invalid types.
2. PM builds WBS: parent/child tasks with codes/planned hours; dependency blocks close of predecessor when configured.
3. Rate card (employee or task) resolves sell rate and cost rate; timesheet stores both at log or validate time.
4. Consultant logs hours on task; server rejects if `allow_timesheets=false`, wrong company, or task∉project; task spent hours update.
5. Timer start/stop computes hours; overlapping running timers for same employee rejected.
6. Manager (≠ logger) validates draft timesheets → immutable approved snapshot (hours, rates, currency, FX); self-validate blocked.
7. Reject/reopen path: validated unbilled can reopen with audit; billed (`timesheet_invoice_id`) cannot.
8. `bill_timesheets` in one transaction: Draft or Posted OutInvoice with tax per pack/fiscal position, line qty=hours, price=sell rate, links all sheets; re-bill same ids is idempotent fail/no-op.
9. Fixed-fee / milestone bill creates AR from milestone completion % or amount independently of hours.
10. Project margin live view: billed revenue − labor cost − rebillable/non-rebillable expenses updates via subscription without full-table client scan.
11. Resource capacity live view: calendar working hours − leave − allocations − logged time; over-allocation flagged.
12. Utilisation report: available vs billable/non-billable hours by employee/period; company isolation enforced.
13. Expense posted with billable project allocation → `create_expense_project_rebill` → client invoice; amount appears in project margin once.
14. Budget vs actual: planned labor/expense vs actual; variance % on project dashboard from live data.
15. Change order increases scope/budget/rates; baseline retained; audit trail of rebaseline.
16. EVM: PV/EV/AC and SPI/CPI computable from baseline + validated progress + actual cost (differentiating path).
17. Project POC/milestone rev-rec posts deferred→income per rule; drill-down to moves.
18. Distributed team: AU consultant + SG delivery — working calendars/holidays per locale; timesheet date validity; FX snapshot to company currency on bill.
19. Company B cannot validate/bill company A’s timesheets (domain + e2e).
20. Period lock blocks bill/post; open period invoice appears on AR aging with origin “Timesheets” and project analytic.

---

## 5. Localization matrix (calendars / currencies / tax / distributed teams)

Country packs today are **tax-seed + company-ID metadata** (`spacetimedb/src/core/country_pack.rs`). PSA needs **working-calendar, public-holiday, services-tax, and FX overlays** — not only sale-tax seeds. Pack metadata must not be mistaken for live statutory adapters.

**i18n:** UI ships **English only** (`SupportedLanguage = "en"`). Project strings live under module/dashboard configs. Country packs are not language packs.

Rates and rules below are **dated requirements as of 2026-07-18**, cited from official sources where linked — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA only in-tree) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|-----------------------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` only | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| VAT/GST on services | GST-AU 10%; GST-NZ 15% seeds — **not** applied in `bill_timesheets` | VAT-ZA 15% — **not** applied | ISS/ICMS/IVA complexity — outside reducers | GST/SST/PPN/VAT seeds — **not** applied on T&M bill |
| Working week / OT norms | Common Mon–Fri; public holidays AU states / NZ | Mon–Fri; RSA public holidays | BR CLT calendars; AR/CL local holidays | SG 5-day; MY/ID/PH/TH local; some Fri–Sat patterns for Muslim regions |
| Public holidays | Need state/national calendars for capacity | Need RSA holiday calendar | Need national + municipal overlays (BR) | Need national calendars per pack |
| Currency / FX | AUD/NZD functional | ZAR functional | BRL/ARS/CLP; ARS volatility → FX snapshot critical | SGD + MYR/IDR/PHP/THB; multi-currency teams common |
| Timesheet tax evidence | Tax invoice for GST on client bill — AR path | Tax invoice VAT | NFS-e / local service invoice often **procedure**/worker | IRAS / SST / e-Faktur adjacency for B2B services |
| Leave ↔ capacity | HR leave exists; **not** capacity-wired | Same | Same | Same |
| Subcontractor / withholding | WHT seeds exist (e.g. ZA/BR) — **not** PSA-wired | WHT-ZA seed | IRRF-BR seed | Pack-dependent WHT on vendor services |
| PSA pack gap | Services GST on bill; AU/NZ holiday tables; OT flags | VAT + holiday table | Service invoice type as **procedure**; holiday tables | Configurable services tax + holiday tables; e-invoice **workers** for AR — not in-reducer HTTP |

### Official sources (dated; verify)

| Region | Authority / reference |
|--------|----------------------|
| Australia GST / holidays | [ATO — GST](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst); [Fair Work / public holidays](https://www.fairwork.gov.au) |
| New Zealand GST / holidays | [IRD — GST](https://www.ird.govt.nz/gst); [Employment NZ — holidays](https://www.employment.govt.nz) |
| South Africa VAT | [SARS — VAT](https://www.sars.gov.za/tax-rates/value-added-tax-vat/) |
| Singapore GST | [IRAS — GST](https://www.iras.gov.sg/taxes/goods-services-tax-gst) |
| Malaysia e-Invoice / SST | [LHDN MyInvois](https://www.hasil.gov.my) |
| Indonesia | [DJP / Coretax](https://www.pajak.go.id) |
| Brazil service invoices | [Receita Federal](https://www.gov.br/receitafederal) / municipal NFS-e rules |
| Thailand VAT | [Revenue Department](https://www.rd.go.th) |
| Philippines VAT | [BIR](https://www.bir.gov.ph) |
| Chile IVA | [SII](https://www.sii.cl) |
| Argentina IVA | [AFIP / ARCA](https://www.afip.gob.ar) |

Neighboring Southern African markets (e.g. Botswana, Namibia, Mozambique) have **no** in-tree packs.

---

## 6. SpacetimeDB architecture decision (Projects / PSA)

Quality benchmark for integrated project → time → bill → finance controls: NetSuite PSA / project accounting patterns ([NetSuite PSA](https://www.netsuite.com/portal/products/professional-services-automation.shtml); [Project Management](https://www.netsuite.com/portal/products/erp/project-management.shtml)). Architecture constraints from SpacetimeDB: reducers are automatically transactional; procedures are the HTTP boundary ([SpacetimeDB Functions](https://spacetimedb.com/docs/functions/); [Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Subscription semantics](https://spacetimedb.com/docs/subscriptions/semantics)).

| Topic | Decision |
|-------|----------|
| **Atomic bill** | Keep `bill_timesheets` as the single txn that creates the AR document, lines, tax snapshot, and sets `timesheet_invoice_id`. Do **not** mark sheets billed from a second client call. Posting to GL may be `action_post` on the move, but period lock must apply before financial recognition. |
| **Immutable approved time** | On `validate_timesheets`, write an append-only `project_timesheet_approval` (or freeze fields + reject updates). Store hours, cost rate, sell rate, currency, FX. Billed rows are permanently immutable. |
| **Rate resolution** | Resolve sell/cost rates **server-side** from rate card / SO line / task / employee defaults inside log or validate — never trust UI `employee_cost` alone for billable revenue. |
| **Approvals** | Route validate through permission + SoD (and optionally `gate_action_with_approval`). Reject path required. |
| **Subscriptions** | Keep org-scoped `projects` / `tasks` / `timesheets`. Add **bounded** live queries: `timesheets-to-validate`, `timesheets-unbilled`, `project-margin-by-project`, `resource-capacity-by-employee` (calendar − leave − allocations − actuals). Avoid KPI zeros in config as finance truth. |
| **Capacity model** | New tables: working calendar, public holiday (pack-keyed), resource allocation booking. Reducers update bookings; subscriptions project remaining capacity. Leave reducers should invalidate capacity projections (same DB txn when leave approved). |
| **Project margin** | Derive from validated/billed timesheet snapshots + project expenses (± rebill) + project AR — preferably a reducer-maintained `project_margin_snapshot` or narrow SQL over indexed FKs; do not require clients to scan all timesheets/expenses. |
| **Isolation / scale** | Index org, company, project, employee, validation_status, invoice_id, date. Domain tests: company A cannot validate/bill company B. Index names unique module-wide. |
| **External I/O** | Payroll export, external calendar sync, FX providers, e-invoice (MY/ID/BR service docs) → **API workers / procedures** with durable integration intent. Reducers must not block on HTTP. |
| **Rev-rec boundary** | Subscription deferred revenue stays in subscriptions module. Project POC/milestone recognition is a **separate** schedule keyed by `project_id` / milestone — share posting helpers, not tables blindly. |
| **Expense boundary** | Keep `create_expense_project_rebill` in expenses; project margin reads `rebill_move_id` / analytic. Optional thin project UI action that calls the same reducer. |
| **CSV** | Restrict production imports to Draft timesheets (or privileged break-glass); never silently create validated+billed rows without invoice in default policy. |
| **UI contract repair** | Fix `billType` enum values and `toLogTimesheetParams` / timer params before any pilot demo; treat current create/log paths as broken. |

---

## 7. Priority classification

### Pilot-critical

| Gap | Why |
|-----|-----|
| Fix create-project `bill_type` / expose billing flags in form | UI cannot create projects today against `BillType::from_str` |
| Fix timesheet log/start param mappers (employee, currency, cost/rate, UOM, invoice type) | Buttons exist but payload ≠ `LogTimesheetParams` |
| SoD + reject/reopen on validate; freeze validated/billed rows | Approval integrity |
| Rate card (or SO-line rate) separate from cost; use sell rate on bill | Billing correctness |
| Tax on `bill_timesheets` + period-lock awareness | Financial close |
| Company isolation domain tests + lifecycle e2e (create→log→validate→bill) | Pilot safety |
| Minimal live unbilled / to-validate queues | Ops inbox |
| Dashboard quick-action ID alignment | Demo hygiene |

### Competitive

| Gap | Why |
|-----|-----|
| WBS codes/levels + real milestone entity | Delivery structure |
| Resource allocation bookings + `hr_resource` / leave-aware capacity | Staffing |
| Working calendars + public holidays by country pack | Distributed teams |
| Project budget vs actual (link analytic/project) | Control |
| Utilisation reporting | PSA staple |
| Live project-margin subscription | NetSuite-class ops view |
| Fixed-fee / milestone billing path | Beyond pure T&M |
| Project WIP / cost JE optional on validate | Project accounting |
| Expense rebill surfaced in project UI | Integrated PSA |
| Multicurrency FX snapshot on validate/bill | Regional delivery |
| Durable validation timeline UI | Audit UX |
| Skills matrix for staffing | Soft booking quality |

### Differentiating

| Gap | Why | Status |
|-----|-----|--------|
| Capacity forecasting (forward allocations vs pipeline) | Planning edge | **Done** (Wave E — `capacity_forecast_snapshot`) |
| Earned-value management (PV/EV/AC, SPI/CPI) | Program controls | **Done** (Wave E — `project_earned_value_snapshot`) |
| Change-order rebaseline with dual baselines | Commercial rigor | **Done** (Wave E — `project_change_order` + `project_baseline`) |
| Subcontractor management (vendor PO → project cost → margin) | Services supply chain | **Done** (Wave E — `project_subcontractor_cost` → margin) |
| Project POC/milestone revenue recognition schedules | Advanced accounting | **Done** (Wave E — `project_revenue_schedule` / lines; not subscription deferred) |
| Calendar/payroll/PSA tool integrations via workers | Ecosystem | **Done** (Wave E — `project_integration_intent` + api-server worker stub) |
| Mobile offline timesheet outbox + conflict UI | Field services | **Done** (Wave E — `timesheet-capture-outbox` + Advanced PSA tab) |

**Recommended first wave (pilot):** repair UI contracts (`bill_type`, timesheet params) → validate SoD + immutability → rate/sell vs cost + tax on bill → isolation + e2e lifecycle → unbilled/to-validate subscriptions. Then capacity calendars + allocation + margin live views; then forecasts/EVM/change orders/subcontractors/rev-rec.

---

## Validation

| Check | Result |
|-------|--------|
| Tables/reducers vs `spacetimedb/src/projects/*` | Verified 2026-07-18 |
| Imports vs `data_ops/project_imports.rs` | Verified |
| `bill_timesheets` vs `accounting/journal_entries.rs` | Verified (Draft OutInvoice, tax 0, price=`employee_cost`) |
| Expense rebill vs `expenses/expense_depth.rs` | Verified adjacent Present |
| BFF keys vs reducers | 17 keys, 0 phantoms |
| Workspace keys vs `ERP_ORG_SQL` | `projects`, `tasks`, `timesheets` wired |
| UI param defects | `billType: 'non_billable'`; `toLogTimesheetParams` missing required fields — verified |
| `cargo check` (`spacetimedb/`) | **Passed** 2026-07-18 |
| Domain/E2E suites executed in this investigation | **No** — existence only (`projects.contract.ts`, workforce smoke, expenses rebill test) |
| Acceptance scenarios | 20 listed (≥10 required) |
| Every gap has state + priority | Yes (§2 / §7) |

---

## Bottom line

Lumiere Projects is a **task-and-timesheet state machine with a draft billing hook**, not an integrated PSA product. The highest-severity defects against the quality bar are **(1)** UI contracts that cannot successfully create projects or log time, **(2)** validation that does not produce an immutable approved-time/billing snapshot, and **(3)** billing that invoices **cost** without tax or rate cards — so utilisation, profitability, and live capacity/margin views have nothing trustworthy to project. Expense rebill and subscription rev-rec are adjacent building blocks; they do not replace project accounting.

### Related docs

- [Gap-fixes tracker](./plans/projects-psa-gap-fixes-plan.md) — Wave A–E checkbox backlog
- [PSA coordinator](../.cursor/plans/projects-psa-coordinator-mission.md) — sub-agent spawn order + wave gates
- [Expenses investigation](./EXPENSES_INVESTIGATION.md) — project rebill / allocations adjacency
- [Subscriptions & Billing investigation](./SUBSCRIPTIONS_BILLING_INVESTIGATION.md) — rev-rec patterns to reuse carefully
- [Accounting NetSuite gap](./ACCOUNTING_NETSUITE_GAP.md) — JE/AR/payment adjacency
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — no Projects/PSA wedge claim at investigation time
- Projects module: `spacetimedb/src/projects/`
- Projects workspace: `frontend/packages/stdb/src/subscriptions/projects-workspace.ts`
- UI: `frontend/web/app/(modules)/projects/projects-client.tsx`
- E2E smoke: `frontend/web/tests/e2e/phase-5-workforce-smoke.spec.ts`
