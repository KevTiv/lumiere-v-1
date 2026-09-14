# ERP Workflow Integration Program

**Status:** Proposed — stack root / execution plan  
**Created:** 2026-09-13  
**Tracks:** `workflow-integration`, `frontend`, `generated-contracts`, `production-readiness`, `pre-tenant-certification`, `ai-harness`, `offline-first`  
**Base:** `main`  
**Stack role:** This document is the first PR in the ERP workflow-integration stack. Follow-up implementation PRs should stack from this plan unless a later integration PR explicitly rebases the stack.

Related plans and evidence:

- `docs/reducer-coverage-matrix.md`
- `docs/plans/pre-tenant-adversarial-certification.md`
- `docs/plans/offline-changeset-sync.md`
- `docs/plans/sliding-window-cold-tier.md`
- `docs/plans/agent-harness-capability-ir-foundation.md`
- `frontend/web/ERP_FRONTEND_PLAN.md`

---

## 1. Decision

Lumiere has reached the point where adding more ERP backend breadth has lower value than integrating the existing domain model into complete, user-operable business workflows.

The unit of product completion is therefore no longer an individual reducer, command hook, table, tab, or CRUD page. The unit of completion is a **certified end-to-end business workflow**.

The integration program will:

1. establish one reusable workflow/action integration seam;
2. complete **Order-to-Cash** as the golden reference workflow;
3. complete **Procure-to-Pay** as the second reference workflow;
4. converge Inventory and Accounting around those two flows;
5. complete Project-to-Cash, Employee-to-Pay, and Subscription-to-Revenue using the same shared seams;
6. converge approvals, documents, messaging, imports, reporting, and workflow automation horizontally across modules;
7. expose only certified workflow capabilities to the AI harness and offline ChangeSet pipeline.

The target is not to make all ~1,000 user-facing reducers individually visible in the UI. The target is to make the existing business engine usable through coherent workflows while preserving SpacetimeDB as the sole business-state authority.

---

## 2. Why this program exists

The backend and command layers are substantially broader than the tracked frontend reachability surface. The reducer coverage matrix currently classifies:

- 972 reducers as user-facing;
- 945 as command-only;
- 23 as reachable from a tracked UI caller;
- 89 as backend-only;
- 25 as requiring classification/route triage.

That report is intentionally conservative and does not fully reflect the current module clients: Sales, Inventory, Accounting, CRM, and Purchasing already import and invoke many more domain hooks than the raw `reachable-ui` count suggests.

The remaining problem is primarily one of **workflow convergence**:

- actions exist but are not always surfaced from the business record that owns the user's intent;
- cross-module resulting records often require manual navigation;
- state-dependent actions are implemented inconsistently across modules;
- post-command invalidation and result discovery are not uniformly expressed;
- approval, retry, stale-state, permission, and idempotency behavior is not presented through one shared contract;
- individual domain screens can expose deep functionality without forming one complete business journey.

The pre-tenant adversarial certification work also demonstrates why backend existence is not enough. It identified real tenancy, replay/idempotency, communication-consent, recipient-identity, money, import, and reconstruction defects in complete business sequences. This program therefore requires vertical E2E and adversarial certification as part of workflow completion.

---

## 3. Non-negotiable architecture rules

1. **SpacetimeDB remains the only business-state authority.** Frontend workflow code never becomes a second business-rule engine.
2. **Generated application contracts remain the frontend command/query boundary.** Do not introduce raw reducer-name calls, positional argument construction, arbitrary STDB SQL, or local duplicate schemas.
3. **Frontend state determines presentation, not permission.** The UI may hide or disable an action based on current record state/capabilities, but the server must re-authorize every command.
4. **Business workflows reuse domain reducers; they do not create parallel workflow-specific mutation implementations.**
5. **Cross-module transitions produce explicit record references.** A user should be able to move directly from opportunity → order → picking → invoice → payment, and from requisition → PO → receipt → bill → payment.
6. **A command is not considered integrated merely because a hook exists.** It must be reachable from the owning workflow context with pending/error/success behavior and resulting-state visibility.
7. **Retries require explicit idempotency semantics.** UI retry behavior must never amplify ambiguous writes across browser, API, and reducer layers.
8. **Approval is a first-class workflow state.** Do not simulate approval by hiding buttons or trusting client state.
9. **Documents, chatter, audit, and activity are horizontal record capabilities.** They should attach to business records rather than remain isolated module features.
10. **AI and offline execution come after workflow certification.** Both reuse the same stable operation semantics and authorization boundaries.
11. **No integration slice may weaken tenant/company scoping.** Organization and actor context remain server-derived.
12. **Every vertical milestone must leave `main` in a usable state.** Avoid giant cross-domain PRs.

---

## 4. Definition of a complete workflow

A workflow is complete only when all applicable requirements below are satisfied.

### 4.1 Reachability

- [ ] Starting records can be created from a discoverable UI entry point.
- [ ] Existing records can be found through the relevant module/list/search surface.
- [ ] Related upstream/downstream records are linked directly.
- [ ] Cross-module continuation does not require the user to manually re-find generated records.

### 4.2 State and actions

- [ ] Current business state is visibly represented.
- [ ] Valid next actions are discoverable.
- [ ] Invalid or nonsensical actions are not presented as normal actions.
- [ ] Backend validation remains final authority.
- [ ] Terminal, cancelled, failed, and waiting states have explicit UX.

### 4.3 Mutations

- [ ] Inputs use generated types or narrowly typed adapters from form values.
- [ ] Pending state prevents accidental duplicate user submission where appropriate.
- [ ] Retry behavior is defined.
- [ ] Committed-but-response-lost behavior is tested.
- [ ] Idempotent replay is either supported or explicitly rejected with safe UX.
- [ ] Stale-state/revision conflicts have an actionable path.

### 4.4 Authorization

- [ ] Actor/organization/company context is derived from trusted server state.
- [ ] Permission denial is represented cleanly.
- [ ] Approval-required transitions stop before canonical execution.
- [ ] Separation-of-duties rules are enforced where required.
- [ ] Revoked permission during a long-lived workflow is re-evaluated at execution.

### 4.5 Result convergence

- [ ] A successful command invalidates the correct resources.
- [ ] The UI waits for or observes canonical state rather than inventing local state.
- [ ] Created records are discoverable deterministically.
- [ ] Resulting records can be opened directly.
- [ ] Parent/child modules converge after cross-domain transitions.

### 4.6 Operational context

- [ ] Audit/history is available where the workflow warrants it.
- [ ] Chatter/activity is available on collaborative records.
- [ ] Documents/attachments are available on document-bearing records.
- [ ] Domain-specific diagnostics are visible for failed or blocked transitions.

### 4.7 Testing

- [ ] Pure adapter/unit coverage exists.
- [ ] Domain state-machine tests exist.
- [ ] API/STDB integration tests cover the transition.
- [ ] One Playwright happy path proves the complete workflow.
- [ ] Adversarial coverage tests retry, stale state, permission change, duplicate submission, and tenant isolation where relevant.

---

## 5. Shared integration foundation — INT-00

Before completing individual business flows, create one reusable integration seam.

### 5.1 Workflow/action package

Prefer a framework-light package rather than embedding orchestration in individual route clients.

Suggested target:

```text
frontend/packages/erp-workflows/
  src/
    core/
      action.ts
      workflow.ts
      transition.ts
      record-ref.ts
      result.ts
      errors.ts
    sales/
      order-to-cash.ts
    purchasing/
      procure-to-pay.ts
    inventory/
      fulfillment.ts
    accounting/
      invoice-to-payment.ts
```

Do not move business logic out of STDB. This package expresses application workflow composition over generated operations.

Suggested concepts:

```ts
export interface ErpRecordRef {
  resource: string
  id: string
  module: string
}

export interface WorkflowResult {
  affectedResources: string[]
  createdRecords?: ErpRecordRef[]
  next?: ErpRecordRef
}

export interface WorkflowAction<TRecord, TInput> {
  id: string
  label: string
  canPresent(record: TRecord): boolean
  execute(input: TInput): Promise<WorkflowResult>
}
```

`canPresent` is a UI concern only; it does not grant permission.

### 5.2 Common action surface

Introduce one reusable record action surface capable of rendering actions in:

- entity tables;
- record sheets;
- detail workspaces;
- approval inboxes;
- contextual AI surfaces later.

Conceptually:

```tsx
<RecordWorkflowActions
  workflow="sales.order"
  record={order}
/>
```

It must support:

- immediate actions;
- confirmation actions;
- form-backed actions;
- approval-wait actions;
- navigation-only actions;
- destructive actions;
- permission-denied/disabled states where showing the reason improves UX.

### 5.3 Mutation completion contract

Create one post-command path:

```text
execute generated command
        ↓
normalize domain error / response
        ↓
invalidate declared resources
        ↓
observe canonical result state
        ↓
resolve created/affected record refs
        ↓
notify + optionally navigate
```

Do not let every client invent its own timeout, toast, invalidation, and result-discovery behavior.

### 5.4 Canonical ERP record links

Add one helper for resource → module/route resolution.

Requirements:

- stable record refs, not labels;
- route generation remains UI-owned;
- no business logic in the router mapping;
- supports direct cross-module navigation;
- can later be consumed by notifications, approvals, AI results, and audit views.

### 5.5 Error taxonomy

The integration layer should distinguish at least:

```text
validation
permission_denied
approval_required
stale_revision
conflict
already_applied
retryable_transport
outcome_unknown
not_found
server_failure
```

Do not collapse all failures into generic toast strings.

### 5.6 Shared workflow test harness

Provide helpers for vertical E2E fixtures:

- organization/company creation or seeded selection;
- actor provisioning;
- canonical record lookup;
- record-state assertion;
- retry/lost-response injection;
- second-session stale-state tests;
- limited-role permission tests.

Reuse the pre-tenant fixture patterns rather than creating a parallel harness.

### INT-00 acceptance

- [ ] No existing business behavior changes merely by adding the framework.
- [ ] At least one current Sales action is migrated to the common seam as a proving fixture.
- [ ] No raw reducer invocation is introduced.
- [ ] Query invalidation is explicit and testable.
- [ ] Created-record navigation is demonstrated.
- [ ] Existing module clients remain incrementally migratable.

---

## 6. Milestone 1 — Order-to-Cash

**Priority:** P0  
**Role:** Golden reference workflow

Target journey:

```text
Lead
  ↓
Opportunity
  ↓
Quotation
  ↓
Sales Order
  ↓
Stock Reservation / Picking
  ↓
Delivery
  ↓
Invoice
  ↓
Payment
  ↓
Reconciliation
```

This workflow should establish the conventions followed by all later integration work.

### INT-01 — CRM → Sales conversion

Complete:

```text
create lead
→ qualify/update lead
→ create/convert opportunity
→ progress opportunity stage
→ convert opportunity to sales order
→ open resulting order
```

Relevant existing capabilities include:

- `create_lead`
- `create_opportunity`
- `update_opportunity`
- `update_opportunity_stage`
- `convert_lead_to_customer`
- `convert_opportunity_to_sale_order`

Requirements:

- resulting contact/customer identity is visible;
- resulting order is linked from CRM;
- sales order links back to CRM origin where available;
- duplicate submit cannot silently create duplicate orders;
- current permissions are checked at conversion;
- conversion failure does not leave the UI pretending an order exists.

### INT-02 — Quotation / sales-order lifecycle

Canonical visible flow:

```text
Draft
  ├─ edit
  ├─ add/remove/update lines
  ├─ compute totals
  ├─ send quotation
  └─ cancel

Sent
  ├─ accept
  ├─ confirm where policy permits
  ├─ edit if domain rules permit
  └─ cancel

Sale
  ├─ open fulfillment
  ├─ create invoice
  ├─ view resulting records
  └─ terminal/cancel paths as permitted
```

Integrate:

- `create_sale_order`
- `create_sale_order_line`
- `update_sale_order`
- `update_sale_order_line`
- `delete_sale_order_line`
- `compute_so_totals`
- `send_sale_order_quotation`
- `accept_sale_order_quotation`
- `confirm_sales_order`
- `cancel_sale_order`
- lock/unlock where the domain uses them.

Requirements:

- actions are record-contextual;
- totals refresh deterministically;
- quote/order PDF generation and document archival use shared document infrastructure where already available;
- chatter/document attachments remain accessible from the record.

### INT-03 — Sales → fulfillment

Target:

```text
confirmed order
→ stock picking
→ reservation
→ assignment
→ picking
→ packing
→ validation
→ delivery complete / partial
```

Integrate the existing Inventory capabilities rather than adding Sales-owned stock logic:

- `assign_stock_picking`
- `confirm_stock_picking`
- `reserve_stock_quant`
- `unreserve_stock_quant`
- `assign_stock_move`
- `confirm_stock_move`
- `done_stock_move`
- `pack_stock_picking`
- `validate_stock_picking`
- `validate_stock_picking_backorder`

Sales order detail should show linked fulfillment records and states.

### INT-04 — Partial fulfillment / backorder

Explicitly certify:

```text
ordered 10
available 6
→ deliver 6
→ preserve/create remaining obligation for 4
```

Test:

- partial reservation;
- multiple deliveries;
- backorder validation;
- cancellation of remainder where supported;
- duplicate validation;
- stale inventory between preview and commit.

### INT-05 — Sales → invoice

Target:

```text
deliverable/invoiceable order
→ create invoice
→ compute invoice totals
→ post invoice
→ open Accounting record
```

Use:

- `create_invoice_from_sale_order`
- `compute_invoice_totals`
- `post_invoice`
- `create_credit_note_from_invoice` where relevant.

The resulting `account_move` reference must be resolved and linked without the user manually searching Accounting.

### INT-06 — Invoice → payment → reconciliation

Target:

```text
posted invoice
→ create/register payment
→ post payment
→ reconcile
→ invoice paid
```

Reuse one payment infrastructure for AR and AP:

- `create_payment`
- `post_payment`
- `register_payment_on_invoice`
- `reconcile_payment_with_invoice`

The Sales order summary should converge on:

```text
Delivery: complete / partial
Invoice: draft / posted / credited
Payment: unpaid / partial / paid
Outstanding: amount
```

These values must come from canonical records, not local workflow flags.

### INT-07 — Returns / credit / exchange

Complete:

```text
sale
→ return order
→ return fulfillment
→ credit note
```

and where supported:

```text
return
→ exchange order
```

Relevant operations include:

- `create_return_order`
- `confirm_return_order`
- `cancel_return_order`
- `create_credit_note_from_return_order`
- `create_exchange_order_from_return`

### INT-08 — O2C vertical certification

Playwright happy path:

```text
create lead
→ opportunity
→ convert to order
→ quotation/confirm
→ fulfill
→ invoice
→ post
→ pay
→ reconcile
```

Adversarial cases:

- duplicate order conversion;
- lost response during confirmation;
- permission revocation before confirmation;
- stock changed between view and fulfillment;
- partial delivery;
- duplicate invoice creation attempt;
- duplicate payment/post attempt;
- cross-tenant record identifiers;
- stale browser session;
- refresh/reopen at every major state.

Milestone 1 closes only when the entire vertical flow passes.

---

## 7. Milestone 2 — Procure-to-Pay

**Priority:** P0

Target journey:

```text
Supplier Intake
  ↓
Requisition
  ↓
RFQ / Sourcing
  ↓
Purchase Order
  ↓
Receipt
  ↓
Vendor Bill
  ↓
Three-way Match
  ↓
Payment
```

### INT-10 — Supplier onboarding

Target:

```text
intake
→ submit
→ review
→ approve / hold / reject
→ vendor available for purchasing
```

Use:

- `submit_supplier_intake`
- `review_supplier_intake`
- `approve_supplier_intake`
- `reject_supplier_intake`
- `hold_supplier_intake`

Requirements:

- review and approval actors are explicit;
- separation-of-duties policy is honored where configured;
- approved supplier becomes selectable without manual refresh/search workarounds;
- risk/scorecard information is visible where applicable.

### INT-11 — Purchase requisition

Target:

```text
draft requisition
→ add lines
→ submit
→ approve
→ convert to PO / sourcing path
```

Use:

- `create_purchase_requisition`
- `add_purchase_requisition_line`
- `submit_purchase_requisition`
- `approve_purchase_requisition`
- `convert_purchase_requisition_to_po`
- `cancel_purchase_requisition`
- `close_purchase_requisition`

### INT-12 — RFQ sourcing

Target:

```text
RFQ
→ lines
→ supplier bids
→ evaluation
→ award
→ PO
```

Use:

- `create_purchase_rfq`
- `add_purchase_rfq_line`
- `add_purchase_rfq_bid`
- `award_purchase_rfq_bid`

### INT-13 — Purchase order lifecycle

Visible states should coherently represent:

```text
Draft
→ Sent
→ Confirmed
→ Partially Received
→ Received
→ Partially Billed
→ Billed
→ Closed / Cancelled
```

Use existing operations including:

- `create_purchase_order`
- `add_purchase_order_line`
- `update_purchase_order`
- `update_purchase_order_line`
- `send_purchase_order`
- `confirm_purchase_order`
- `cancel_purchase_order`
- lock/unlock
- total computation.

### INT-14 — PO → Inventory receipt

Target:

```text
confirmed PO
→ receive line / receipt
→ canonical stock update
→ PO receipt state
→ open Inventory receipt
```

Use `receive_po_line` and existing stock-picking infrastructure. Do not implement purchasing-owned inventory state.

### INT-15 — Receipt → vendor bill / three-way match

Target:

```text
ordered qty
vs received qty
vs billed qty
```

The current Purchasing client already models match states. Promote that into a certified workflow:

- matched;
- pending;
- under-received;
- over-received;
- under-billed;
- over-billed.

Use:

- `create_bill_from_purchase_order`
- `invoice_po_line`
- `update_po_invoice_status`
- `update_po_receipt_status`

Resulting bill links directly to Accounting.

### INT-16 — Vendor bill → payment

Reuse the same Accounting payment infrastructure created for O2C. Do not build a separate P2P payment stack.

### INT-17 — Purchasing extensions

After the core path is certified, integrate:

- landed costs;
- purchase returns;
- vendor credit notes;
- blanket orders/releases;
- purchase contracts;
- consignment;
- supplier scorecards/risk;
- approval delegation.

### INT-18 — P2P vertical certification

Happy path:

```text
supplier intake
→ approval
→ requisition
→ approval
→ PO
→ receipt
→ bill
→ match
→ payment
```

Adversarial coverage:

- duplicate submit/approval;
- stale receipt state;
- over-receipt;
- over-billing;
- lost response after PO confirmation;
- permission change mid-approval;
- foreign-org supplier/PO/receipt/bill IDs;
- partial receipt + partial bill;
- retry payment.

---

## 8. Milestone 3 — Inventory Operations

**Priority:** P0

Once O2C and P2P exercise Inventory through real business flows, complete the warehouse as an independent operational product.

### 8.1 Product master

```text
category
→ UOM
→ product
→ variants
→ supplier info
→ packaging
→ pricing/inventory attributes
```

### 8.2 Warehouse model

```text
warehouse
→ locations
→ routes
→ stock rules
→ geo/3D metadata where useful
```

### 8.3 Receiving

```text
incoming picking
→ assign
→ confirm
→ lot/serial capture
→ receipt
→ putaway
```

### 8.4 Internal transfer

```text
source location
→ reserve
→ move
→ destination
→ completion
```

### 8.5 Outbound fulfillment

```text
reservation
→ picking wave
→ warehouse task
→ pick
→ pack
→ ship
```

### 8.6 Replenishment

```text
stock exception / low stock
→ replenishment rule
→ execution
→ purchase/manufacture result
```

### 8.7 Cycle counting

```text
count plan
→ session
→ count lines
→ variance
→ validation
→ adjustment posting
```

### 8.8 Quality

```text
quality point
→ quality check
→ pass/fail
→ alert
→ assignment
→ resolution
```

### 8.9 Traceability

```text
lot / serial
→ stock movements
→ upstream/downstream trace
→ traceability report
```

### 8.10 Barcode/device operations

Browser/UI initiates user intent; trusted worker/device endpoints retain machine lifecycle authority. Do not make provider/device callbacks forgeable through ordinary session UI.

### Milestone acceptance

At minimum certify:

- inbound receipt;
- internal transfer;
- outbound fulfillment;
- partial/backorder;
- cycle count;
- replenishment;
- quality failure/resolution;
- lot/serial traceability.

---

## 9. Milestone 4 — Record-to-Report

**Priority:** P0

Accounting already has deep backend/client support. The goal is to turn it into an understandable accounting lifecycle rather than a set of independent tables.

### 9.1 Guided accounting initialization

```text
company
→ currency
→ fiscal year
→ periods
→ chart of accounts
→ journals
→ taxes
→ payment terms
```

Do not require a new tenant to discover setup dependency order manually.

### 9.2 Journal lifecycle

```text
draft entry
→ lines
→ validation/balance
→ post
→ correction/reversal/cancel path
```

### 9.3 Accounts receivable

```text
invoice
→ post
→ due
→ payment
→ reconciliation
→ credit note if needed
```

### 9.4 Accounts payable

Reuse the same accounting primitives for vendor bills.

### 9.5 Bank statement / reconciliation

```text
import/stage statement
→ candidate matches
→ reconcile
→ post statement
```

Before promotion, close the known adversarial issues around statement-import replay and locale-sensitive parsing.

### 9.6 Fixed assets

```text
asset
→ confirm
→ depreciation board
→ depreciation posting
→ close/dispose
```

### 9.7 Budgets / analytic accounting

Provide coherent workspaces for:

- analytic accounts/lines/distributions;
- budget setup;
- validation/confirmation;
- actual updates;
- close/cancel.

### 9.8 Period close

Create a checklist-driven close surface. Example prerequisites:

```text
bank reconciled
AR reviewed
AP reviewed
inventory posted
fixed asset depreciation posted
FX revaluation run
 tax/status checks reviewed
↓
close period
```

Server rules remain authoritative; the checklist explains readiness and links to blockers.

### 9.9 Fiscal-year close / consolidation / intercompany

Integrate after the basic period-close path is stable.

### 9.10 Financial reports

Provide:

- trial balance;
- P&L;
- balance sheet;
- cash flow;
- tax/VAT reports where supported.

Reports should drill down into originating transactions.

---

## 10. Milestone 5 — Project-to-Cash

**Priority:** P1

Target:

```text
Project
→ Tasks
→ Resource allocation
→ Timesheets / Expenses
→ Milestones
→ Billing
→ Invoice
→ Payment
```

Complete:

- project create/update/activate;
- task create/update/state/parent/assignment;
- timesheet timer/logging;
- timesheet validation/rejection/reopen;
- milestones;
- rate cards;
- resource capacity/allocation;
- milestone billing;
- timesheet billing;
- project expenses/rebilling;
- change orders;
- margin/earned value;
- project revenue schedules/recognition.

Reuse Accounting for invoices/payment and Expenses for reimbursable/project expenses.

---

## 11. Milestone 6 — Employee-to-Pay

**Priority:** P1

Split UX by persona rather than presenting all HR capability in one workspace.

### Employee

- profile;
- attendance;
- leave;
- expenses;
- documents.

### Manager

- leave approval;
- performance;
- team/resource visibility;
- timesheet approval where applicable.

### HR

- employee master;
- departments/job positions;
- contracts;
- recruitment;
- onboarding/offboarding;
- benefits;
- skills;
- global assignments.

### Payroll

```text
salary rules
→ payroll structure
→ payslip
→ confirm
→ post
→ export
→ accounting effect
```

Core certified path:

```text
employee
→ contract
→ attendance/leave
→ payslip
→ accounting
```

Country-pack/localization requirements should be treated as explicit certification scope, not assumed complete from generic payroll support.

---

## 12. Milestone 7 — Subscription-to-Revenue

**Priority:** P1/P2

Target:

```text
Plan
→ Sale
→ Subscription
→ Invoice
→ Payment
→ Revenue recognition
```

Complete the basic path first, then:

- pause/resume;
- amendment;
- renewal;
- cancellation/close;
- bundles;
- price tiers;
- commitments;
- usage ingestion/rating;
- dunning;
- payment failures;
- index-linked renewal;
- deferred revenue;
- revenue recognition.

Reuse Sales and Accounting rather than introducing independent customer/order/invoice semantics.

---

## 13. Milestone 8 — shared approval and workflow platform

**Priority:** P1/P2

Once multiple vertical workflows have real approval points, converge them onto the common approval UX.

Target:

```text
ERP transition requiring approval
        ↓
workflow / domain approval fact
        ↓
shared human-task inbox
        ↓
approve / reject / delegate / comment
        ↓
domain reducer performs canonical transition
```

Candidate consumers:

- purchase requisitions/orders;
- supplier onboarding;
- expenses;
- leave;
- timesheets;
- communication batches;
- AI action drafts;
- future custom workflows.

The workflow engine orchestrates; it must not become the implementation of domain business rules.

Integrate:

- workflow draft/version lifecycle;
- node/edge editing;
- simulation;
- publishing;
- runtime start/signal/cancel;
- human-task claim/decision/comment;
- delegation;
- timers/outbox;
- workflow migration only after core runtime UX is stable.

---

## 14. Horizontal capability — Documents, chatter, activity, audit

Do not treat Documents as an isolated destination only.

Attach record-document/chatter capabilities to high-value records including:

- contact/opportunity;
- sales order;
- purchase order;
- invoice/vendor bill;
- inventory receipt/picking where useful;
- project;
- expense;
- employee;
- proposal;
- helpdesk ticket.

Target record-level affordances:

```text
Overview
Activity
Chatter
Documents
Audit / history
```

Not every resource needs every tab, but the integration contract should be consistent.

Document workflows to integrate after attachment basics:

- versioning;
- lock/unlock;
- restore;
- templates/PDF generation;
- email templates;
- e-sign;
- legal hold;
- retention;
- external Drive sync;
- AI document processing.

---

## 15. Horizontal capability — Imports and tenant onboarding

Imports are required for real ERP adoption and must be integrated alongside module milestones rather than deferred indefinitely.

Canonical user journey:

```text
choose resource
→ upload CSV
→ map columns
→ preview
→ validate
→ execute import
→ inspect errors
→ retry / rollback where supported
→ save mapping template
```

Priority import bundles:

1. organization/company/reference setup;
2. contacts/vendors;
3. products/categories/UOM/warehouses/stock;
4. chart of accounts/opening data;
5. sales orders if migration requires them;
6. purchase orders;
7. employees/contracts;
8. projects/tasks/timesheets.

Import certification must include locale-sensitive numbers/dates and conflicting idempotency replay.

---

## 16. Horizontal capability — Reports and executive views

Reporting should consume the same canonical resources and stable application contracts as operational modules.

Integrate:

- dashboard creation/layout;
- KPI/metric definitions;
- saved reports;
- report templates;
- scheduled reports;
- exports;
- source-record drilldown;
- owner/executive summaries.

Avoid adding handwritten report-specific query paths when existing generated resource/query contracts can express the need.

---

## 17. Messaging/communications promotion gate

Operational messaging is valuable but currently has known adversarial blockers. Do not promote it to a production-critical workflow until those defects are closed.

Target workflow after correction:

```text
communication preference / consent
→ template
→ audience/batch
→ preview
→ independent review/approval
→ dispatch
→ provider callbacks
→ monotonic delivery status
→ audit
```

Block promotion until at minimum:

- cross-organization contact reference is impossible;
- approval rechecks consent;
- approval rechecks recipient identity;
- approved content is fixed/immutable enough for audit;
- separation of duties is enforced where required;
- provider callback replay is monotonic/idempotent;
- number/identity change cannot silently redirect approved intent.

---

## 18. AI harness integration gate

AI must consume certified ERP workflows and reviewed read capabilities rather than broad raw reducer access.

Read path:

```text
user question
→ reviewed generated capability
→ server-derived tenant scope
→ deterministic data shaping/analysis
→ bounded result
→ model answer
```

Mutation path:

```text
user request
→ model proposes reviewed operation intent
→ policy
→ durable action draft
→ human approval if required
→ normal ERP command path
→ canonical result
→ answer gate/evidence
```

Never:

```text
AI → privileged parallel ERP mutation API
```

The current harness work should remain fail-closed until the governed loop has a production caller, answer gate, role-effective result limits, and certified tool execution.

### AI workflow exposure rule

An operation should not become a model-advertised mutation merely because codegen knows it exists. Prefer exposure only after the corresponding human workflow is certified and the capability review records:

- stable operation identity;
- input contract;
- risk classification;
- confirmation/approval policy;
- scope behavior;
- idempotency/retry semantics;
- bounded result/evidence policy.

---

## 19. Offline integration gate

Offline support should begin with the same certified workflows rather than attempting to replicate the entire reducer surface.

Initial candidates after online certification:

- create/update CRM lead/contact activity where safe;
- sales-order drafting;
- inventory counts/warehouse user intent;
- expense capture;
- project timesheet capture.

Disconnected writes remain immutable ChangeSet actions. Reconnection must:

```text
re-resolve actor/org/company
→ re-authorize operation
→ compare base revision/state
→ classify conflict
→ require review where policy says so
→ execute canonical STDB reducer
→ return applied/rejected result
```

Do not run business reducers locally and do not allow SQLite canonical mirrors to become a second authority.

---

## 20. Testing model for every workflow

Every integration slice uses four test levels.

### 20.1 Pure/unit

Cover:

- form → generated command params;
- record → presentation action set;
- record refs → routes;
- state/result mapping;
- domain error → UX classification.

### 20.2 Domain

Reducer/state-machine tests remain the authority for invariants.

### 20.3 API/STDB integration

Prove:

```text
trusted request
→ command
→ reducer transition
→ canonical query/read result
```

Include tenant/company/permission boundaries.

### 20.4 Playwright vertical-flow

One happy-path spec per certified workflow, plus adversarial variants.

Mandatory adversarial patterns where applicable:

- double submit;
- committed-but-response-lost;
- retry;
- simultaneous actors;
- stale revision;
- permission change mid-flow;
- cross-tenant record id;
- network latency/offline window;
- partial completion;
- browser refresh/reopen;
- approval actor separation.

Extend the existing pre-tenant suite and known-defect discipline rather than inventing a second adversarial framework.

---

## 21. Observability requirements

Integration work must make production failures diagnosable.

For each critical workflow transition, preserve or add:

- request/operation correlation id;
- actor/org/company context in trusted logs where appropriate;
- stable operation id;
- reducer/domain failure reason;
- created/result record ids;
- retry/idempotency key when relevant;
- projection/durability context for durable workflows;
- approval/run identifiers where relevant.

Do not leak sensitive payload content into logs merely for convenience.

---

## 22. Suggested stack / PR sequence

The implementation should remain incremental.

### Stack root

```text
INT-PLAN  docs: ERP workflow integration program
```

This document is INT-PLAN.

### Foundation

```text
INT-00 workflow primitives + common action/result seam
```

### Order-to-Cash

```text
INT-01 CRM → Sales conversion
INT-02 quotation / sales-order lifecycle
INT-03 Sales → fulfillment
INT-04 partial fulfillment / backorder
INT-05 Sales → invoice
INT-06 invoice → payment → reconciliation
INT-07 returns / credit / exchange
INT-08 O2C vertical certification
```

### Procure-to-Pay

```text
INT-10 supplier onboarding
INT-11 requisition
INT-12 RFQ sourcing
INT-13 purchase-order lifecycle
INT-14 PO → receipt
INT-15 receipt → bill / 3-way match
INT-16 vendor bill → payment
INT-17 purchasing extensions
INT-18 P2P vertical certification
```

### Remaining verticals

```text
INT-20 inventory operations
INT-30 record-to-report
INT-40 project-to-cash
INT-50 employee-to-pay
INT-60 subscription-to-revenue
INT-70 shared approvals/workflow convergence
INT-80 horizontal documents/imports/reporting convergence
INT-90 certified AI workflow exposure
INT-100 certified offline workflow exposure
```

The exact number of PRs within INT-20+ may expand, but every PR should close one understandable workflow seam and remain independently reviewable.

---

## 23. Branching strategy

This plan is the root of the integration stack and is based directly on `main`.

Recommended sequence:

```text
main
  └─ docs/workflow-integration-program        # INT-PLAN
       └─ feat/workflow-integration-core      # INT-00
            └─ feat/o2c-crm-sales             # INT-01
                 └─ feat/o2c-sales-lifecycle  # INT-02
                    ...
```

Once a lower PR merges, rebase the remaining stack onto updated `main` and preserve the logical order.

Do not stack this program on the AI harness stack. AI should later consume the workflow results, not become a prerequisite for ordinary ERP use.

---

## 24. Scope discipline

During INT-00 through INT-18, avoid unrelated feature expansion.

Allowed when necessary to close the workflow:

- missing query/hook wiring;
- missing state/action UI;
- missing cross-module navigation;
- missing idempotency/replay correctness;
- missing tenant/company checks;
- narrowly required form config;
- narrowly required read model;
- test fixtures and observability;
- correctness defects exposed by vertical certification.

Normally defer:

- unrelated new ERP entities;
- speculative analytics;
- new AI tools unrelated to the certified flow;
- broad UI redesigns;
- unrelated migration/codegen refactors;
- offline implementation before online workflow certification.

---

## 25. Promotion gates

### Gate A — Order-to-Cash pilot-ready

Required:

- INT-00 through INT-08 complete;
- no open tenant-isolation defects in the path;
- payment/post/retry semantics certified;
- one real seeded production-like environment passes O2C E2E;
- operational diagnostics sufficient to inspect a failed order/payment flow.

### Gate B — Procure-to-Pay pilot-ready

Required:

- INT-10 through INT-18 complete;
- receipt/bill matching certified;
- approval/separation rules certified;
- supplier/PO/receipt/bill/payment tenant boundaries certified.

### Gate C — Core ERP pilot-ready

Required:

- O2C + P2P;
- core Inventory operations;
- Record-to-Report minimum close path;
- import/onboarding minimum bundle;
- backup/reconstruction/operability gates remain green;
- pre-tenant blockers for promoted workflows are closed.

### Gate D — AI-enabled pilot

Required:

- human workflow already certified;
- reviewed generated capability;
- governed runtime caller;
- durable run/policy/spend/audit path;
- action-draft approval for mutations;
- answer/evidence gate;
- adversarial harness certification.

### Gate E — Offline-enabled pilot

Required:

- online workflow already certified;
- generated local projection and command metadata;
- durable ChangeSet capture;
- reconnect re-authorization;
- conflict/review path;
- idempotent push;
- recovery/rebuild tests.

---

## 26. Success metrics

Track workflow completion, not only reducer counts.

Recommended metrics:

### Integration

- number of certified business workflows;
- percentage of critical workflow transitions reachable from owning record UI;
- cross-module transitions with direct record links;
- command-only operations intentionally covered by generic workflow actions versus still orphaned.

### Reliability

- duplicate-submit defects;
- stale-state defects;
- cross-tenant defects;
- ambiguous outcome defects;
- E2E pass rate;
- pre-tenant known-defect count in promoted flows.

### Product usability

- clicks/context switches per core workflow;
- dead-end states;
- manual record-search steps after cross-module transitions;
- onboarding/import completion rate once real tenants exist.

Do not optimize for raw reducer-to-button coverage. Many reducers are internal, administrative, import-oriented, or should remain hidden behind higher-level workflows.

---

## 27. Immediate next work after this plan

After review/merge of INT-PLAN:

1. create **INT-00** from this stack root;
2. inventory the current duplicated mutation-completion/action patterns in Sales, CRM, Inventory, Accounting, and Purchasing;
3. introduce the smallest shared workflow primitives required by the first O2C transition;
4. migrate one Sales action end-to-end as the reference fixture;
5. proceed through INT-01 → INT-08 without adding unrelated domain breadth;
6. keep the reducer coverage matrix, vertical E2E coverage, and pre-tenant findings synchronized with each milestone.

The intended outcome is that Lumiere begins behaving like one integrated ERP rather than a large set of individually capable domain modules.
