# ERP module usability parity execution ledger

**Status:** INITIAL EXECUTION LEDGER — 2026-09-14  
**Semantic authority:** [`../plans/erp-module-usability-parity-program.md`](../plans/erp-module-usability-parity-program.md)  
**Parent coordination:** [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md)

This ledger owns the bounded implementation path to **T0 — first-test-organization ERP readiness**.

T0 is independent of AI P0/P1. A module visible to the first test organization must reach U5; otherwise it stays hidden/disabled.

Status values follow the coordination program: `TODO`, `ACTIVE`, `REVIEW`, `BLOCKED`, `ACCEPTED`, `DEFERRED`.

## 1. Assignment rules

1. `COV-00` re-audits the current tree. Historical frontend/reducer matrices are evidence, not current truth.
2. Do not mark a module complete because routes, reducers, hooks, or CRUD forms exist. The primary lifecycle must work end-to-end.
3. A module package may be implemented by multiple Luna sessions when marked `2x`/`3x`; each session still owns one bounded workflow slice.
4. Cross-module business logic stays in canonical STDB domain operations. Frontend workflow composition does not become a business-rule engine.
5. Use COH error/outcome semantics as they land. Do not create module-local alternatives.
6. Reuse INT-00 workflow/action/result infrastructure and pre-tenant fixtures rather than creating a second module framework.
7. Any feature deliberately deferred from T0 must be removed from the test-org visible surface and recorded in the matrix.
8. AI/admin/internal pages are not automatically T0 modules simply because a route exists.

## 2. Shared T0 foundation

| ID | Est. | Depends | Ownership | Bounded objective | Acceptance gate |
| --- | ---: | --- | --- | --- | --- |
| `COV-00` | 2x | BASE-00 | audit/matrix only | Reconcile current STDB modules, application IR/operation inventory, named frontend command contracts, query surfaces, routes/navigation and test-org configuration. Classify every product surface and every user-facing operation. Score each intended T0 module U0–U5 and identify exact gaps. | One current module matrix exists; every route/command/user-facing operation has an owner/classification; every T0 module has primary lifecycle, missing slices, tests and dependencies recorded. No implementation assumptions copied from historical plans. |
| `COV-01` | 1.5 | COV-00, COH-02 | shared ERP workflow/UI boundary | Align the common module workflow result/error/record-ref/navigation surface with INT-00 and COH typed outcomes. Migrate one representative action without inventing new business semantics. | A command executes through generated contract → typed outcome → invalidation/readback → stable record ref/navigation; stale/denied/replay/outcome-unknown have shared UX semantics. |
| `COV-02` | 2x | COV-00 | seed/test fixtures | Build/reconcile a reproducible first-test-org seed pack and role/persona fixture set spanning every intended T0 module. Prefer canonical reducers/import/onboarding paths where those are product behavior. | Disposable full stack can create the seed deterministically; all U5 specs share the same org/company/personas/reference data; no module needs hand-edited DB setup. |

> **COV-00 status: ACCEPTED.** Coordinator acceptance is recorded in [`erp-cov00-coordinator-acceptance.md`](./erp-cov00-coordinator-acceptance.md) against evidence revision `4f797db650ae82318ab0f477670d14aee9d5d0cd`. This accepts the current census and ownership denominators only; downstream runtime defects, U4/U5 promotion, and first-org admission remain governed by their named packages and gates.

## 3. Core commercial and supply-chain modules

| ID | Est. | Depends | Module | T0 primary scope | Acceptance gate |
| --- | ---: | --- | --- | --- | --- |
| `COV-03` | 2x | COV-01, COV-02, ERP-00 | CRM | lead/contact/opportunity lifecycle, stages, activities, customer conversion and Sales handoff | U5 CRM matrix; golden path creates/qualifies/converts and opens resulting customer/order context; duplicate/stale/permission/tenant cases pass. |
| `COV-04` | 3x | COV-03, ERP-01 | Sales | quotation/order lines/totals/send/accept/confirm/cancel; fulfillment/invoice/return links | U5 Sales matrix and O2C Sales portions; direct links to canonical picking/invoice/return records; retry and duplicate conversion/confirmation safe. |
| `COV-05` | 3x | COV-01, COV-02, ERP-03 | Purchasing | supplier/requisition/RFQ/PO/approval/receipt/bill/payment handoff | U5 Purchasing matrix; P2P primary lifecycle passes persisted E2E including approval/stale/retry/reference attacks. |
| `COV-06` | 3x | COV-01, COV-02, ERP-00 | Inventory / WMS | products/locations/quants, transfer/picking/reservation/backorder, counts, lots/serials, quality, replenishment | U5 Inventory matrix; receiving/fulfillment/count/traceability flows work with concurrency, stale stock and tenant tests. |
| `COV-07` | 3x | COV-06 | Manufacturing / Quality | BOM, MO, work centers/orders, material issue/consume, production, quality, scrap/byproduct/cost/close as supported | U5 Manufacturing matrix; one seeded production order completes from BOM to finished stock with state/cost/quality visibility and adversarial quantity/state checks. |

## 4. Finance, people, service and recurring-business modules

| ID | Est. | Depends | Module | T0 primary scope | Acceptance gate |
| --- | ---: | --- | --- | --- | --- |
| `COV-08` | 3x | COV-01, COV-02, BASE-04, ERP-05 | Accounting / Finance / Assets | journals/invoices/posting/payments/reconciliation, bank rec, close, financial statements, asset lifecycle | U5 Finance matrix; invoice/payment/statement/period/asset golden paths pass balance, idempotency, closed-period, money and tenant invariants. |
| `COV-09` | 3x | COV-01, COV-02 | HR / Payroll | employee/dept/contract, leave/attendance/time, payroll structures/payslip approval/posting as supported | U5 HR matrix; employee-to-pay representative lifecycle works with sensitive-data scope, approval, stale/retry and separation-of-duties coverage. |
| `COV-10` | 2x | COV-01, COV-02 | Projects / Tasks | project/task assignment/state, timesheets/milestones, resource/budget visibility, billing/cost handoff | U5 Projects matrix; project-to-cash representative flow links timesheet/milestone to canonical commercial/accounting outcome. |
| `COV-11` | 2x | COV-01, COV-02, COV-08 | Expenses | create/attach/submit → approve/reject → post/reimburse, employee/finance views | U5 Expenses matrix; receipt/document linkage, self-approval denial where required, duplicate reimbursement/post protection. |
| `COV-12` | 2x | COV-01, COV-02, COV-08 | Subscriptions | plan/subscription/lines → recurring billing/payment → amend/renew/cancel/dunning as supported | U5 Subscription matrix; repeated scheduler/retry cannot double-bill; billing/accounting records linked directly. |
| `COV-13` | 2x | COV-01, COV-02, COV-06, COV-08 | POS | configuration/session → order/lines → payment → close/reconcile/stock effects | U5 POS matrix; duplicate payment/order submission, offline/reconnect if currently supported, stock and accounting convergence tested. |
| `COV-14` | 2x | COV-01, COV-02 | Helpdesk | ticket creation/intake → assignment/SLA/state → resolution/close/reopen, contact/activity/document links | U5 Helpdesk matrix; role visibility, stale assignment/state changes, notifications/activity and tenant isolation pass. |
| `COV-15` | 2x | COV-01, COV-02, COV-08 | Fleet | vehicle/driver assignment → service/fuel/inspection/cost history and lifecycle | U5 Fleet matrix; finance/employee links are canonical, cost/service history survives refresh, cross-company vehicle refs deny. |
| `COV-16` | 2x | COV-01, COV-02 | IoT | device provisioning/association → telemetry/health → alert → acknowledge/action/history | U5 IoT matrix for the currently supported device model; unowned/cross-company devices and stale alerts deny; degraded telemetry dependency is explicit. |
| `COV-17` | 2x | COV-01, COV-02 | Proposals | draft/content/lines/source docs → review/clarification → approval → canonical handoff/conversion where supported | U5 Proposals matrix; version/review state explicit, source documents linked, stale review and authorization tests pass. |

## 5. Horizontal business capabilities

| ID | Est. | Depends | Surface | T0 primary scope | Acceptance gate |
| --- | ---: | --- | --- | --- | --- |
| `COV-18` | 2x | COV-02, COH-09 | Documents / Knowledge | folders/upload/version/access/review/archive/delete/retention; attach to business records | U5-equivalent document surface; company scope, version identity, blob lifecycle and linked-record navigation pass. |
| `COV-19` | 2x | COV-01, COV-02, BASE-03 | Calendar / Activities + Messages / Communications | events/tasks/activities and consent-aware thread/template/batch communication lifecycle | U5-equivalent calendar/comms surfaces; consent/recipient identity/approval/provider-status defects closed; record activities/messages link back correctly. |
| `COV-20` | 2x | COV-01, COV-02 | Reports / Analytics | choose/configure report → execute → inspect/drill → export/schedule where admitted | U5-equivalent reporting surface; empty/large/error cases, current scope, deterministic totals and export provenance pass. |
| `COV-21` | 2x | COV-01, COV-02 | Approvals / Workflow automation | approval inbox/evidence/decision/audit; workflow definition/version/activation/run/human/timer/failure states | U5-equivalent horizontal control plane; current authorization/SOD/stale approval/retry/timer replay tests pass. |
| `COV-22` | 2x | COV-01, COV-02, BASE-04 | Imports / Data Ops + Forms / Templates | upload/map/validate/preview/commit/replay; define/version/preview/apply forms/templates | U5-equivalent surfaces; locale/date/hash/idempotency failures fixed, malformed input bounded, generated contracts retained. |
| `COV-23` | 2x | COV-01, COV-02 | Organization / Company / Settings / Auth | org/company bootstrap, users/memberships/roles/policy/settings, invitations/recovery/profile | U5 admin foundation for the test org; privilege escalation, revoked membership, company switching and session recovery tests pass. |
| `COV-24` | 2x | COV-04, COV-06, COV-08, COV-19 | Distributor workspace | distributor-specific daily workspace over CRM/Sales/Inventory/Accounting/communications without duplicate state | U5 workspace; order/credit/delivery/collection/stock-exception workflow uses canonical domain records and survives underlying module navigation/readback. |

## 6. System-wide parity and certification

| ID | Est. | Depends | Ownership | Bounded objective | Acceptance gate |
| --- | ---: | --- | --- | --- | --- |
| `COV-25` | 2x | COV-03..24 | cross-module integration | Close record-link, document/activity/message/audit/approval consistency across all U5 candidates. Remove manual “go search the other module” steps for generated downstream records. | Cross-module relation graph has direct navigation for all primary handoffs; horizontal context follows the record; no duplicate local shadow state. |
| `COV-26` | 2x | COV-03..25 | UX/responsive/accessibility | Run common UI-quality pass across every candidate T0 module: loading/empty/error/denied states, forms/reset, keyboard/focus basics, responsive viewports and reconnect/readback. | Module parity matrix contains the same UX evidence class for every exposed module; no visible stub/dead action/hidden dependency failure. |
| `COV-27` | 3x | COV-02..26, BASE-05 | full-stack certification | Execute all-module seeded Playwright golden paths plus relevant adversarial suite; add no-stub/exposure/operation-classification ratchets and produce launch manifest. | T0: every exposed module U5, no unclassified enabled user-facing operation, no visible stub route/tab/action, all required E2E/adversarial specs pass, launch manifest hides everything else. |

## 7. Expected module-specific session splitting

Large package estimates are envelopes. The coordinator should split them into one-session cards such as:

```text
COV-08a accounting journal/invoice/payment
COV-08b bank reconciliation
COV-08c close/statements
COV-08d fixed assets
COV-08e finance module certification
```

or:

```text
COV-06a stock/location/product surfaces
COV-06b picking/backorder
COV-06c cycle count
COV-06d lot/serial/traceability
COV-06e quality/replenishment + certification
```

Use suffixes in the execution log while preserving the parent `COV-*` responsibility. Do not put all sub-workflows in one agent diff.

## 8. Parallelization

After `COV-00`, likely parallel lanes are:

```text
Lane A  commercial: CRM → Sales
Lane B  supply: Purchasing → Inventory → Manufacturing
Lane C  finance: Accounting/Assets → Expenses/Subscriptions/POS
Lane D  people/service: HR → Projects → Helpdesk/Fleet/IoT
Lane E  horizontal: Documents/Calendar/Messages/Reports/Approvals/Imports/Settings
```

Shared INT/COH changes remain coordinator-owned or explicitly serialized. Module agents must not create module-local substitutes for record refs, mutation outcomes, forms, authorization, activity, documents, or API errors merely to avoid a shared dependency.

## 9. T0 evidence record

Every module row closes with:

```text
module + version/revision
U0..U5 evidence
primary lifecycle covered
secondary/deferred capability classification
commands/operations used
contracts release if changed
unit/integration/STDB tests
Playwright spec + result
adversarial cases + result
roles/personas exercised
viewports exercised
known hidden deferrals
open blocker = none
reviewer
```

`COV-27` aggregates these into the first-test-org launch manifest and evidence bundle.

## 10. Estimate policy

Do not publish a firm remaining-session estimate before `COV-00` re-audits the current implementation. Many routes/commands already exist and historical plans are stale in both directions.

As a planning envelope, exhaustive module parity is likely a **major parallel track (roughly 30–45 focused Luna sessions)**, but accepted current functionality may reduce that materially. `COV-00` must replace this range with evidence-based sizing and avoid reimplementing already-complete workflows.
