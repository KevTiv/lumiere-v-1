# HR & Payroll Investigation — Employee Lifecycle, Leave & Country-Pack Payroll

Current-state assessment of Lumiere HR / payroll against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-18  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this investigation unless noted under Validation.

**Verdict:** Lumiere has a **thin workforce shell** — departments / jobs / employees → contracts → leave request approve/refuse → payslip draft/confirm — with partial org-scoped subscriptions, BFF/hooks/UI CRUD (create + workflows; updates mostly unwired), CSV import, and sparse audit hooks. Against the quality bar it is **unsuitable for HR operations and payroll close**: leave balances are not consumed, dual-approval states are unused, `confirm_payslip` trusts client gross/net and **never posts GL**, salary rules are stored but **never executed**, and there is **no** attendance, schedule, performance, benefits, employee documents, or onboarding/offboarding checklist domain. **Payroll must be treated as a country-pack + integration framework** (export intents / partner engines), not a universal gross-to-net engine. PII surfaces are **Unsuitable**: org-wide employee subscriptions, no purpose-based filters, no field-level masking beyond coarse HTTP column projection, and **no read-access audit**.

**Quality benchmark (not a spec):** Oracle NetSuite SuitePeople patterns emphasize a single employee master with lifecycle workflows (onboard/offboard checklists), time-off plans with accruals, workforce scheduling/attendance, compensation visibility, and — where payroll applies — jurisdiction-specific processing with real-time GL posting ([SuitePeople HRMS](https://www.netsuite.com/portal/products/hcm.shtml); [SuitePeople Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1495573671.html)). SuitePeople U.S. Payroll is itself a **country-scoped** product, which reinforces Lumiere’s decision to ship payroll as packs/integrations rather than a global engine. Lumiere is judged on whether it can meet that *depth of control, privacy, and posting integrity*, not on SuiteApp parity.

**V1 roadmap reconciliation:** `docs/V1_ROADMAP.md` does **not** currently call out an HR/payroll wedge. Treat this investigation as the source of truth for HR depth until a roadmap claim is added.

**Compile check:** `cargo check` in `spacetimedb/` — **passed** (2026-07-18).

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/hr` + adjacent)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Org structure | `hr_department`, `hr_job_position` | `hr/employees.rs` | Hierarchy via `parent_id`; job `state` string `"recruit"` \| `"open"` |
| People | `hr_employee`, `hr_resource` | `hr/employees.rs` | Soft-delete via `deleted_at`; `is_active` as status proxy; **PII-heavy** |
| Contracts / wage | `hr_contract` | `hr/contracts.rs` | Monthly `wage` + `currency_id`; `ContractState` SM |
| Leave | `hr_leave_type`, `hr_leave` | `hr/leaves.rs` | `max_leaves` stored; **never consumed** on approve |
| Payroll shell | `hr_payroll_structure`, `hr_salary_rule`, `hr_payslip` | `hr/payroll.rs` | No payslip-line table; rules unused by confirm |
| Accounting (adjacent) | `account_move` / lines | accounting | **No** payslip→JE path |
| Projects (adjacent) | `project_timesheet` | `projects/timesheets.rs` | FK `employee_id`; billable→AR — **not** payroll attendance |
| Expenses (adjacent) | `hr_expense`, sheets | `expenses/` | FK `employee_id`; separate spend domain |
| Country packs (adjacent) | tax/WHT seeds | `core/country_pack.rs` | **No** payroll/statutory-ID/leave overlays |
| Documents | generic `document` / folders | DMS | Seed “Contracts” folder ≠ employee file store |
| Attendance / schedules / performance / benefits | — | — | **Absent** |

**Enums** (`spacetimedb/src/types.rs`):

| Enum | Variants | Reducer reality |
|------|----------|-----------------|
| `EmploymentType` | `FullTime`, `PartTime`, `Contract`, `Intern` | Used on create |
| `HrLeaveState` | `Draft`, `Confirm`, `Refused`, `Validated`, `ValidatedOne` | UI path: Draft → Validated / Refused; `Confirm` / `ValidatedOne` unused by reducers |
| `ContractState` | `New`, `Open`, `Expired`, `Cancelled` | Transition reducers; **no from-state guards** |
| `PayslipState` | `Draft`, `Verify`, `Done`, `Cancelled` | Confirm: Draft → Done; `Verify` unused |

**Absent enums:** employee lifecycle status, attendance punch state, benefit enrollment, payroll jurisdiction/run batch.

### 1.2 Backend reducers (callable SpacetimeDB surface)

**Employees (`hr/employees.rs`):**  
`create_department`, `update_department`, `create_job_position`, `update_job_position`, `create_employee`, `update_employee`, `archive_employee`

| Reducer | Behavior | Gap |
|---------|----------|-----|
| `create_employee` | Inserts employee + auto `HrResource` (`time_efficiency: 100.0`) | Accepts PII (gender, birthday, emergency, `pin`); no onboarding checklist; `user_id: None` |
| `update_employee` | Partial update; company guard | Many create fields not updatable; **no UI wiring** |
| `archive_employee` | Soft-archive: `is_active=false`, `date_terminated`, `deleted_at` | Not full offboarding (assets, access, final pay, docs) |
| `create_job_position` | Insert | **`no_of_employee: 0` hardcoded** |

**Contracts (`hr/contracts.rs`):**  
`create_contract`, `update_contract`, `open_contract`, `expire_contract`, `cancel_contract`

| Reducer | Behavior | Gap |
|---------|----------|-----|
| Transitions | Set state + audit | Org-only on open/expire/cancel (no flat `company_id`); no from-state check |

**Leaves (`hr/leaves.rs`):**  
`create_leave_type`, `update_leave_type`, `create_leave_request`, `approve_leave`, `refuse_leave`, `reset_leave_to_draft`

| Reducer | Behavior | Gap |
|---------|----------|-----|
| `create_leave_request` | → `Draft` | No balance check; approvers `None` |
| `approve_leave` | → `Validated`; sets `first_approver_id` | Skips `Confirm` / `ValidatedOne`; no allocation consume; org-only company scope |
| `refuse_leave` | → `Refused` | **No from-state guard** |

**Payroll (`hr/payroll.rs`):**  
`create_payroll_structure`, `create_salary_rule`, `create_payslip`, `confirm_payslip`, `cancel_payslip`

| Reducer | Behavior | Gap |
|---------|----------|-----|
| `create_payslip` | Draft; `gross`/`net` = `basic_wage` | Ignores salary rules |
| `confirm_payslip` | Client `gross_wage` / `net_wage` → `Done` | **No AccountMove**; no bank payment; no statutory calc |
| Structures/rules | Org-scoped store | Structures lack `company_id`; rules never applied |

**Imports (`data_ops/hr_imports.rs`):**  
`import_hr_resource_csv`, `import_hr_department_csv`, `import_hr_job_position_csv`, `import_hr_employee_csv`, `import_hr_contract_csv`, `import_hr_leave_type_csv`, `import_hr_leave_csv`, `import_hr_payroll_structure_csv`, `import_hr_salary_rule_csv`, `import_hr_payslip_csv` — permission `create`; **no `write_audit_log_v2`**; can force leave/payslip states that UI cannot reach.

**Absent (no reducers/tables):** attendance punches, work schedules/shifts, leave allocations/balances, performance reviews/goals, compensation history/bands, benefits enrollment, employee documents / tax forms, onboarding/offboarding checklists, payroll run batches, payslip lines, GL/AP from payroll, bank file export, country statutory adapters, purpose-scoped PII views, read-access audit.

### 1.3 Frontend contracts (BFF / hooks)

[`HR_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/hr-http.ts): **34** keys. **0 phantoms** at BFF↔reducer level — every key has a SpacetimeDB reducer.

| Surface | Status |
|---------|--------|
| Query hooks | Reads for 9 workspace entities + mutations in `hooks/hr.ts` |
| Update hooks | Exist for dept/job/employee/leave-type/contract — **`hr-client` never calls them** |
| Create params | `hr-create-params.ts` forces sensitive create fields (`pin`, `birthday`, emergency*, gender, marital) to `undefined` |
| Contract test | `hr.contract.ts` — compile-only BFF enumeration |
| Params merge test | `hr-params-merge.test.ts` — only `finalizeUpdateLeaveTypeParams` |

### 1.4 Subscriptions & queries

`HR_WORKSPACE_RESOURCE_KEYS` ([`hr-workspace.ts`](../frontend/packages/stdb/src/subscriptions/hr-workspace.ts)): 9 keys.

| Key | In `ERP_ORG_SQL` | Filter / notes |
|-----|------------------|----------------|
| `employees` | Yes | Org-scoped → `hr_employee` (**full PII columns available to subscribers**) |
| `departments` | Yes | Org-scoped |
| `leave-requests` | Yes | Org-scoped |
| `contracts` | Yes | Org-scoped (includes wage) |
| `payslips` | Yes | Org-scoped (includes wages) |
| `job-positions` | **No** | Workspace key → **silent null SQL** |
| `leave-types` | **No** | Same |
| `payroll-structures` | **No** | Same |
| `salary-rules` | **No** | Same |
| Manager / self / purpose queues | **No** | No `leaves-to-approve`, `my-employee-record`, etc. |
| `hr-resources` | **No** | Not in workspace keys |

HTTP query registry has entries for all HR resources with `defaultRestricted` column sets (e.g. employees: `name`, `work_email`, `department_id`, `company_id`). That is **coarse projection for HTTP**, not purpose-based access, not WS field masking, and not read auditing.

### 1.5 UI operations (`/hr`)

Tabs from `hrModuleConfig` + [`hr-client.tsx`](../frontend/web/app/(modules)/hr/hr-client.tsx) (org-chart injected first):

| Tab / surface | End-to-end operations | Gaps |
|---------------|----------------------|------|
| Org chart | Visual panel | Depends on employee/dept data |
| Dashboard | Live KPIs (headcount, open positions, pending leave, open contracts) | Pending leave filters `state === "Confirm"` — **UI-created leaves are Draft → KPI often 0** |
| Employees | Create; archive (+ termination date); CSV | No edit UI; no rehire; PII fields omitted on create |
| Departments | Create; CSV | No edit; parent/manager selects empty |
| Leaves | Create; Approve / Refuse / Reset; CSV | No submit-to-manager; no balance UI |
| Contracts | Create; Open / Expire / Cancel; CSV | No edit UI |
| Payslips | Create; Confirm (gross/net modal); Cancel; CSV | Confirm = client amounts; no GL; no pay run |
| Job positions / Recruitment | Create; recruitment = filter `state === "recruit"` | Candidates KPI hardcoded `0`; no ATS |
| Leave types / Structures / Salary rules | Create; CSV | No edit; rules not applied; structures not company-scoped |
| Attendance / performance / benefits / documents / onboarding | — | **Absent** |

Auth app onboarding (`/(auth)/onboarding`) creates an **organization** — unrelated to HR employee onboarding.

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain | `run_hr_leave_type_test` / `test_hr_leave_type_create` (platform smoke) | Employee lifecycle, leave SM, payslip/GL, isolation, PII |
| Contract | `hr.contract.ts` BFF keys | Runtime backend presence |
| Unit | `hr-params-merge.test.ts` | Create finalizers |
| Playwright | `phase-5-workforce-smoke.spec.ts` — module tabs + create leave type | Employee/leave/contract/payslip workflows; PII; GL |

### 1.7 Seed

`seed.rs` Tier 6.1–6.2: Sales/Engineering depts; employees Alex / Jordan / Casey.  
Tier 8: leave types (Annual 20, Sick 10, Unpaid 0); sample leaves; 3 open contracts; structure + BASIC/TAX/NET rules; 2 Done payslips (manual 85% net — not engine).  
Adjacent: expenses + project timesheets reference `employee_id`.

---

## 2. Gap matrix (quality bar vs inventory)

Definitions:

- **Present** — usable end to end with operational and/or financial consequences.
- **Partial** — implemented at limited depth, or missing an essential UI, policy, reporting, or integration layer.
- **Absent** — no meaningful implementation.
- **Unsuitable** — surface exists but cannot safely meet the workflow / accounting / privacy requirement.

| Capability | State | Evidence | Priority |
|------------|-------|----------|----------|
| Department / job position CRUD | **Partial** | Create + update reducers; UI create-only; job headcount hardcoded 0 | Competitive |
| Employee master create / archive | **Partial** | Create + soft archive; no status SM; no rehire; update unwired in UI | Pilot-critical |
| Employee lifecycle (hire → probation → transfer → terminate) | **Absent** | Only `is_active` + dates | Pilot-critical |
| Positions / org chart | **Partial** | Depts + org-chart panel; no FTE planning | Competitive |
| Contracts | **Partial** | Create + state flips; weak guards; update UI absent | Pilot-critical |
| Onboarding checklists | **Absent** | No checklist tables/reducers | Competitive |
| Offboarding checklists / access revoke | **Absent** | `archive_employee` only | Pilot-critical |
| Leave types | **Present** (MVP) | CRUD + seed + smoke test | — |
| Leave request / approve | **Partial** | Draft→Validated; unused Confirm/ValidatedOne; refuse ungarded | Pilot-critical |
| Leave balances / accruals | **Unsuitable** | `max_leaves` unused; no allocation table | Pilot-critical |
| Attendance / time clocks | **Absent** | — | Competitive |
| Work schedules / shifts | **Absent** | — | Competitive |
| Performance / goals | **Absent** | — | Differentiating |
| Compensation history / bands | **Absent** | Wage on contract only | Competitive |
| Benefits enrollment | **Absent** | — | Differentiating |
| Employee documents / tax forms | **Absent** | No HR doc store | Pilot-critical |
| Payslip create / confirm shell | **Unsuitable** | Client gross/net; no lines; Done without GL | Pilot-critical |
| Salary rule engine | **Unsuitable** | Rules stored, never executed | — (do **not** build universal engine) |
| Payroll country packs / integrations | **Absent** | No pack overlays; no export intents | Pilot-critical |
| Payroll → GL / bank payment | **Absent** | Zero `AccountMove` in `hr/` | Pilot-critical |
| Multi-entity isolation | **Partial** | Some company guards; leave/contract transitions often org-only | Pilot-critical |
| Drill-down reporting (employee → leave → pay → JE) | **Absent** | No JE link | Competitive |
| Workflow controls / SoD | **Partial** | Permission keys; no `gate_action_with_approval`; self-approve possible | Pilot-critical |
| PII subscription boundaries | **Unsuitable** | Org-wide `hr_employee` / contracts / payslips | Pilot-critical |
| Purpose-based access | **Absent** | No self/manager/HR-admin scopes | Pilot-critical |
| Field-level masking | **Partial** | HTTP `defaultRestricted` only; WS full rows; wages not masked | Pilot-critical |
| Access auditing (incl. reads of PII) | **Unsuitable** | Mutator audits sparse; **no read audit** | Pilot-critical |
| Internationalization | **Partial** | Packs for tax; English-only UI; no HR overlays | Competitive |
| Extensibility (metadata / intents) | **Partial** | `metadata` on employee; no integration intent table | Competitive |
| CSV bootstrap | **Present** (MVP) | 10 import reducers; bypasses workflow/audit | Competitive (harden) |
| Phantom UI contracts | **Partial** | BFF ⊆ reducers; update_* + 4 workspace keys overstated vs live UI/SQL | Pilot-critical |
| Timesheet adjacency | **Partial** | Projects use `employee_id`; not attendance/payroll | — (see PSA investigation) |
| Expense adjacency | **Partial** | Expenses FK employee; separate domain | — |

---

## 3. Required invariants

### Accounting

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Confirmed payslip posts balanced payroll JE (or pack-driven posting) | **No** | `confirm_payslip` state-only | Prefer: confirm = “approved for export”; posting via pack/integration reducer that creates `AccountMove` + sets link — or forbid `Done` without move |
| Gross/net from trusted calculation or external pack result | **No** | Client supplies wages on confirm | Never trust UI gross/net as sole source; snapshot pack result or external run artifact |
| Leave payout / termination accruals in final pay | **No** | Archive does not touch payslips | Offboarding final-pay checklist + pack rules |
| Period locks on payroll post | **No** | — | Block post when accounting period locked |
| Drill-down payslip → move → payment | **No** | No FK | Persist `account_move_id` / payment batch id |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Reducer permissions | Yes (pattern) | `hr_employee`, `hr_leave`, `hr_payroll`, … | Keep deny-by-default; add purpose actions (`view_pii`, `view_comp`, `approve_leave`) |
| Tenant / company ownership | Partial | Mixed flat/`Params` company; weak transition guards | Flat `company_id` + guard on every transition; isolation tests |
| Approval SoD | **No** | Approver may be requester | Workflow gate; non-self-approve; dual step when pack requires |
| Purpose-based row access | **No** | Org-wide lists | Self / direct-reports / HR-admin scopes in SQL + reducers |
| Field-level masking | Partial | HTTP defaults | Mask `pin`, emergency, DOB, gender, marital, wage, bank/tax IDs by purpose; never subscribe `pin` broadly |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Append-only mutation log | Partial | `write_audit_log_v2` often empty snapshots; imports unaudited | Rich old/new JSON; audit CSV imports |
| PII **read** access audit | **No** | No read logging for employee/comp | Log purpose + actor + field set for sensitive reads (BFF + subscription apply) |
| Immutable approval history | Partial | Overwritable approver ids + sparse audit | Append-only leave/payroll approval events |
| Comp change history | **No** | Wage overwritten on contract | Effective-dated compensation events |

### Concurrency / integrity

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Atomic leave approve + balance consume | **No** | No balance rows | One reducer: validate allocation, decrement, set state |
| Stale-state rejection | Partial | Some Draft checks; refuse/open unguarded | Harden all SMs |
| Idempotent payroll confirm / export | **No** | Retries can re-confirm conceptually | `client_request_id` / export intent uniqueness |
| No client multi-step financial commit | Violated in spirit | UI “Confirm” implies paid/posted | Separate Approve vs Post/Export; external payroll via intents |
| Live approval queues | **No** | Full-table org SQL | Bounded `leaves-to-approve`, `payslips-to-confirm` |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). External HTTP (STP, eSocial, CPF Board, SARS eFiling, bank ACH, ID verification) belongs in **procedures/workers**, not reducers.

---

## 4. Reference workflows

1. **Create employee master** — Present (MVP); PII/onboarding Partial/Absent.
2. **Assign department / job / manager** — Partial (fields exist; org chart).
3. **Open employment contract + wage** — Partial; weak SM.
4. **Onboarding checklist (IT, docs, tax IDs)** — Absent.
5. **Request leave → manager approve → balance update** — Partial request/approve; balances Unsuitable.
6. **Attendance / schedule adherence** — Absent.
7. **Performance cycle** — Absent.
8. **Compensation change with effective date** — Absent.
9. **Benefits enrollment** — Absent.
10. **Employee document vault (contracts, IDs, tax forms)** — Absent.
11. **Create payslip / run payroll** — Unsuitable shell.
12. **Confirm → GL + bank / statutory file** — Absent.
13. **Country-pack payroll export / partner engine** — Absent (target architecture).
14. **Offboarding checklist + archive + final pay** — Archive only.
15. **Self-service vs manager vs HR-admin views** — Absent.
16. **CSV bootstrap** — Present (audit/workflow risk).
17. **Cross-company isolation** — Partial; tests Absent.
18. **PII masked subscription + read audit** — Unsuitable / Absent.
19. **Timesheet adjacency (PSA)** — Present elsewhere; not payroll.
20. **Expense adjacency** — Present elsewhere.

### Acceptance scenarios (≥10)

1. HR admin creates employee in company A with required identity fields; audit CREATE with field snapshot; company B cannot read full PII via subscription or query.
2. Manager (purpose `manager`) sees only direct reports’ non-sensitive fields; cannot see `pin`, emergency contacts, or peer wages without `view_comp`.
3. Employee self-service sees own record (masked); attempts to read another employee fail closed; each sensitive read writes access audit (actor, purpose, fields).
4. Open contract New→Open only from valid prior state; expire/cancel guarded; wage change creates effective-dated compensation event + audit.
5. Leave request Draft → submit (`Confirm`) → manager approve (`Validated`); allocation decremented atomically; over-balance rejected.
6. Dual-approval when pack/policy requires (`ValidatedOne` → `Validated`); self-approve blocked (SoD).
7. Refuse only from pending states; cannot refuse already Validated leave without reverse workflow.
8. Offboarding: checklist (assets, access, docs) completes → `archive_employee` + final leave payout task for pack; cannot archive with open open-ended obligations without override audit.
9. Payroll run (or single payslip) **Approve** stores immutable calculation artifact (from pack/engine); UI cannot invent net pay.
10. Payroll **Post/Export** in one reducer txn: balanced `AccountMove` (or durable `hr_payroll_export_intent` for external engine) + link on payslip; re-post idempotent.
11. Country pack AU: store TFN under purpose-restricted vault; leave accrual NES-aligned categories available as pack defaults (not hardcoded engine).
12. Country pack ZA: store SARS tax ref under restricted vault; BCEA leave categories as pack defaults; POPIA purpose limitation enforced in access layer.
13. Country pack BR: CPF / eSocial event intents via **worker**; CLT leave defaults; no in-reducer HTTP to government.
14. Country pack SG/MY/ID/PH/TH: CPF/EPF/BPJS/SSS/SSO contribution intents via workers; local leave categories as pack metadata.
15. Attendance (when present): punch → timesheet/leave conflict check; cannot approve leave overlapping recorded work without policy exception.
16. Company A cannot approve leave or confirm payslip for company B (domain + e2e).
17. Subscription live queue `leaves-to-approve` updates without shipping full org employee PII to all HR viewers.
18. CSV import creates Draft-only leave/payslip in production policy; cannot silently create Done payslips without GL/export artifact.
19. Field mask: HTTP and WS never return `pin` to non-privileged purposes; wage columns require `view_comp`.
20. Drill-down: employee → contract → payslip → account move → payment (or export batch) for finance audit.

---

## 5. Localization matrix (employment / leave / payroll packs / PII)

Country packs today are **tax-seed + company-ID metadata** (`spacetimedb/src/core/country_pack.rs`). HR needs **employment overlays**: public-holiday calendars, leave category defaults, statutory identifier schemas, currency/language defaults, and **data-residency / purpose** metadata — not a universal payroll calculator. Pack metadata must not be mistaken for live statutory adapters (STP, eSocial, CPF Board, SARS eFiling).

**i18n:** UI ships **English only** in practice. HR strings live under module/dashboard configs. Country packs are not language packs.

**Payroll product stance:** ship **country-pack definitions + integration intents** (file formats, contribution codes, leave defaults). Run gross-to-net in certified local engines / partners; Lumiere owns employee master, approvals, export artifacts, and GL posting hooks.

Rates and rules below are **dated requirements as of 2026-07-18**, cited from official or widely used compliance sources — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA only in-tree) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|-----------------------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` only | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| Currencies | AUD / NZD | ZAR | BRL / ARS / CLP | SGD / MYR / IDR / PHP / THB |
| Languages (UI gap) | en-AU / en-NZ (+ Māori policy NZ) | en-ZA / af / zu (UI: en only) | pt-BR / es-AR / es-CL (UI: en only) | en + ms / id / th / fil (UI: en only) |
| Employment calendar | NES + modern awards; public holidays state/territory (AU); NZ Holidays Act | BCEA cycles; Public Holidays Act | CLT; municipal/state holidays; 13º salário | Local labour acts; public holidays by country |
| Leave categories (pack defaults) | Annual (4 wks FT), personal/carer’s, compassionate, parental, community service ([Fair Work — annual leave](https://www.fairwork.gov.au/leave/annual-leave)) | Annual ≥21 consecutive days/cycle; sick cycle 36 mo ([BCEA s20/s22](https://www.gov.za)) | ~30 days vacation + 13th; maternity/paternity per CLT | Annual + medical + maternity vary; pack tables required |
| Statutory identifiers (vault) | TFN (AU); IRD number (NZ) | SA ID + SARS tax ref | CPF / PIS-NIT; AR CUIL/CUIT; CL RUT | NRIC/FIN (SG); NRIC (MY); NIK (ID); SSS/TIN (PH); Thai ID |
| Payroll / filings (integrate, don’t rebuild) | ATO STP; super; NZ payday filing | SARS EMP201/PAYE; UIF | eSocial + FGTS Digital + INSS/IRRF | CPF Board; EPF/SOCSO; BPJS; SSS/PhilHealth/Pag-IBIG; SSO |
| Data residency / privacy | Privacy Act / APP; TFN Rule — purpose-limit TFN; employee records retention (AU ~7 yrs Fair Work records) | **POPIA** purpose limitation; responsible-party duties | LGPD (BR); local labour secrecy norms | PDPA (SG/MY/TH); PDP Law (ID); Data Privacy Act (PH) |
| Lumiere pack gap | Leave accrual rules + TFN vault + STP **export intent** | BCEA leave defaults + tax-ref vault + EMP201 intent | CLT leave + CPF vault + eSocial **worker** (not reducer HTTP) | Local leave + contribution intents; multi-currency payslips |

### Official sources (dated; verify)

| Region | Authority / reference |
|--------|----------------------|
| Australia leave / NES | [Fair Work Ombudsman — annual leave](https://www.fairwork.gov.au/leave/annual-leave) |
| Australia tax / TFN / STP | [ATO](https://www.ato.gov.au) |
| New Zealand holidays / IRD | [Employment NZ](https://www.employment.govt.nz); [IRD](https://www.ird.govt.nz) |
| South Africa BCEA / leave | [BCEA](https://www.gov.za); [SARS employer guides](https://www.sars.gov.za) |
| South Africa privacy | [POPIA / Information Regulator](https://inforegulator.org.za) |
| Brazil CLT / eSocial / FGTS | [gov.br / eSocial](https://www.gov.br); [Receita Federal](https://www.gov.br/receitafederal) |
| Singapore CPF | [CPF Board](https://www.cpf.gov.sg) |
| Malaysia EPF | [KWSP / EPF](https://www.kwsp.gov.my) |
| Indonesia BPJS | [BPJS Ketenagakerjaan](https://www.bpjsketenagakerjaan.go.id) |
| Philippines SSS | [SSS](https://www.sss.gov.ph) |
| Thailand SSO | [SSO](https://www.sso.go.th) |

Neighboring Southern African markets (e.g. Botswana, Namibia, Mozambique) have **no** in-tree packs.

---

## 6. SpacetimeDB architecture decision (HR / Payroll)

Quality benchmark for integrated HR → finance controls: SuitePeople employee lifecycle, time-off, and jurisdiction-scoped payroll with GL integrity ([SuitePeople Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1495573671.html); [SuitePeople HRMS](https://www.netsuite.com/portal/products/hcm.shtml)). Architecture constraints from SpacetimeDB: reducers are automatically transactional; procedures are the HTTP boundary ([SpacetimeDB Functions](https://spacetimedb.com/docs/functions/); [Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Subscription semantics](https://spacetimedb.com/docs/subscriptions/semantics)).

| Topic | Decision |
|-------|----------|
| **Payroll product shape** | **Do not** build a universal gross-to-net engine. Persist structures/rules as *configuration hints* or deprecate unused rule execution. Ship **country packs** (leave defaults, ID schemas, contribution codes) + **`hr_payroll_export_intent` / import-result** tables. Certified local engines or partners compute net; Lumiere stores immutable artifacts and posts GL. |
| **Atomic finance boundary** | Either (a) `post_payslip` / `post_payroll_run` creates `AccountMove` + links in **one reducer**, or (b) confirm only marks `ApprovedForExport` and a separate post reducer applies pack posting. **`Done` without move or export artifact is forbidden.** |
| **Leave integrity** | Introduce allocation/balance rows; `approve_leave` must consume balance in the same txn; add explicit submit-to-`Confirm` reducer; refuse only from pending states. |
| **Approvals** | Route leave (and future time) through `gate_action_with_approval` with SoD; append-only approval events. |
| **PII subscriptions** | Split tables or projected views: `hr_employee_public` (org chart) vs `hr_employee_sensitive` (purpose-gated). Prefer **bounded SQL**: `my-employee`, `direct-reports`, `leaves-to-approve` — never broadcast full org PII + wages to every HR session. Fix missing `ERP_ORG_SQL` keys for job-positions / leave-types / payroll-structures / salary-rules **without** widening PII. |
| **Field masking** | Enforce purpose → column allowlists in BFF query layer **and** subscription field access; strip `pin` always except break-glass; wages require `view_comp`. |
| **Access audit** | Mutators: rich `write_audit_log_v2`. Sensitive reads: append `hr_pii_access_log` (or audit_log action `READ`) with purpose, actor, resource, field set. |
| **Isolation / scale** | Index org, company, employee, manager, state, date. Domain tests: company A cannot approve/confirm company B. Unique index names module-wide. |
| **External I/O** | STP, eSocial, CPF, SARS, bank files, ID verification → **API workers / procedures** consuming durable intents. Reducers validate + enqueue only. |
| **Documents** | Employee file references in-reducer; blob storage/OCR outside WASM. Tax forms encrypted at rest via storage policy; metadata + purpose in DB. |
| **Attendance / schedules** | New tables when prioritized; punches feed timesheets (PSA) and leave conflict checks — not a second payroll clock unless pack requires. |
| **CSV** | Production policy: Draft-only for leave/payslip; privileged break-glass for historical Done; always audit. |
| **Extensibility** | Pack JSON overlays + intent rows; avoid embedding jurisdiction math in core reducers. |

---

## 7. Priority classification

### Pilot-critical

| Gap | Status | Notes |
|-----|--------|-------|
| PII subscription boundaries + purpose scopes | **Done** | Wave A — `my-employee` / `direct-reports` |
| Field-level masking + strip `pin` | **Done** | Wave A — field policy + `view_comp` |
| Read-access auditing for sensitive HR/comp | **Done** | Wave A — `hr_pii_access_log` |
| Leave submit + balance consume + refuse guards | **Done** | Wave A — `submit_leave` + allocations |
| Contract/leave transition company guards + SM | **Done** | Wave A |
| Update UI + pending-leave KPI | **Done** | Wave A |
| `ERP_ORG_SQL` for missing HR workspace keys | **Done** | Wave A |
| Payslip Done-without-artifact forbidden + export/GL | **Done** | Wave A — intents + `post_payslip` |
| Country-pack payroll framework (not universal engine) | **Done** | Wave A/B — overlays + export intents |
| Offboarding checklist | **Done** | Wave A |
| Isolation domain tests + Playwright lifecycle | **Done** | `run_all_hr_tests` + `hr-wave-lifecycle.spec.ts` |

### Competitive

| Gap | Status | Notes |
|-----|--------|-------|
| Onboarding checklists | **Done** | Wave B |
| Attendance + basic schedules | **Done** | Wave B |
| Compensation effective dating | **Done** | Wave B |
| Employee document vault | **Done** | Wave B |
| Durable approval timeline UI | **Done** | Wave B |
| Pack-driven leave defaults + holidays | **Done** | Wave B |
| Bounded queues (`leaves-to-approve` / `payslips-to-export`) | **Done** | Wave B |
| CSV audit + Draft-only policy | **Done** | Wave B |
| Recruitment beyond job-position filter | **Done** | Wave B close-out — `hr_applicant` stub |

### Differentiating

| Gap | Status | Notes |
|-----|--------|-------|
| Performance / goals cycles | **Done** | Wave C |
| Benefits enrollment | **Done** | Wave C |
| Advanced WFM (shift optimization, labor cost) | **Done** (MVP stub) | Wave C |
| Partner marketplace / payroll engine hooks | **Done** | Wave C — `hr_integration_intent` + worker |
| Cross-border assignee | **Done** (MVP stub) | Wave C |
| Predictive capacity (with PSA) | **Done** (MVP stub) | Wave C — `hr_capacity_forecast` |

**Explicitly deferred forever in-core:** universal `HrSalaryRule` gross-to-net engine; live government HTTP inside reducers (workers only).

**Execution plan:** [docs/plans/hr-payroll-gap-fixes-plan.md](./plans/hr-payroll-gap-fixes-plan.md) · coordinator [.cursor/plans/hr-payroll-coordinator-mission.md](../.cursor/plans/hr-payroll-coordinator-mission.md).

---

## Validation

| Check | Result |
|-------|--------|
| Tables/reducers vs `spacetimedb/src/hr/*` | Verified 2026-07-19 (Waves A–C + recruitment stub) |
| Workspace keys vs `ERP_ORG_SQL` | **All HR workspace keys wired** (Wave A) |
| Payslip → export intent / GL | **`hr_payroll_export_intent` + `post_payslip`** (Wave A) |
| `cargo check` / wasm publish | **Passed** 2026-07-19 (`lumiere-v1-j1uo0`) |
| Domain suite | **`run_all_hr_tests` passed** 2026-07-19 |
| Playwright | `hr-wave-lifecycle.spec.ts` + `phase-5-workforce-smoke.spec.ts` **passed** 2026-07-19 |
| Gap priorities | All §7 items marked Done or deferred (2026-07-19) |

---

## Bottom line

**As of 2026-07-19**, Waves A–C closed the investigation gaps: PII scopes/masking/read audit, leave submit/balances/SoD, payslip Approve→Verify + export/GL (Done forbidden without artifact), country-pack overlays, hire onboarding + documents, attendance/comp events, performance/benefits stubs, integration intents (api-server worker), WFM/global assignment/capacity stubs, and recruitment applicants. Payroll remains **country-pack + durable intents**, not a universal `HrSalaryRule` engine. In-core government HTTP and gross-to-net remain explicitly deferred.

### Related docs

- [Expenses investigation](./EXPENSES_INVESTIGATION.md) — employee-linked spend; posting patterns to reuse
- [Projects / PSA investigation](./PROJECTS_PSA_INVESTIGATION.md) — timesheets ↔ `employee_id`; capacity/leave adjacency
- [Accounting NetSuite gap](./ACCOUNTING_NETSUITE_GAP.md) — JE/AP/payment adjacency
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — no HR wedge claim at investigation time
- HR module: `spacetimedb/src/hr/`
- HR workspace: `frontend/packages/stdb/src/subscriptions/hr-workspace.ts`
- UI: `frontend/web/app/(modules)/hr/hr-client.tsx`
- E2E smoke: `frontend/web/tests/e2e/phase-5-workforce-smoke.spec.ts`
