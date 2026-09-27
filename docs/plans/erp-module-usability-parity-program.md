# ERP module usability parity and first-test-organization readiness

**Status:** PROPOSED — mandatory first-test-organization product gate  
**Created:** 2026-09-14  
**Execution ledger:** [`../plan/erp-module-usability-parity-ledger.md`](../plan/erp-module-usability-parity-ledger.md)  
**Related:** [`erp-workflow-integration-program.md`](./erp-workflow-integration-program.md) · [`adversarial-business-invariant-certification.md`](./adversarial-business-invariant-certification.md) · [`../plan/repository-cohesion-outcome-ownership-plan.md`](../plan/repository-cohesion-outcome-ownership-plan.md) · [`../plan/module-by-module-maintainability-plan.md`](../plan/module-by-module-maintainability-plan.md)

## 1. Decision

The first test organization must receive a coherent ERP product, not a collection of uneven module demos.

Lumière therefore adds a product gate separate from AI-harness promotion:

```text
T0 — ERP first-test-organization readiness
```

T0 requires **usability parity across every module exposed to the test organization**. Parity does not mean equal reducer count or identical feature count. It means every visible module reaches the same minimum completeness class: discoverable, operable, workflow-complete for its primary business purpose, resilient to expected failures, integrated with related records, and proven through persisted end-to-end tests.

A small Helpdesk module may have fewer workflows than Accounting. It may not have a lower quality bar.

A module that has not reached the required class must be hidden/disabled for the test organization rather than exposed as a stub, dead tab, non-functional quick action, or partially wired CRUD surface.

AI is independent:

```text
BASE + COH
   ├── ERP-COV → T0 first-test-org ERP readiness
   └── GOV     → P0 governed read-only AI pilot
```

The ERP can reach T0 without waiting for the AI harness. Consequential AI/offline capabilities still depend on the certified human workflows they reuse.

## 2. Relationship to existing plans

`erp-workflow-integration-program.md` remains the authority for cross-module business flows such as Order-to-Cash, Procure-to-Pay, Project-to-Cash, Employee-to-Pay, and Subscription-to-Revenue.

This plan closes a different gap: **module-wide product coverage**. A few excellent verticals are not sufficient if the same organization can open Fleet, Helpdesk, POS, Manufacturing, Expenses, Documents, or Settings and encounter materially shallower behavior.

`module-by-module-maintainability-plan.md` remains the authority for code readability and ownership cleanup. Maintainability acceptance is useful but does not certify product usability.

The repository's historical frontend expansion plan and reducer coverage matrix are discovery inputs only. Re-audit the current tree before implementation; do not copy historical missing-route claims after those routes have been added.

## 3. Scope census

The current module census must be derived from all of:

```text
STDB domain/module declarations
canonical application/reducer IR
frontend named command contracts
frontend module routes/navigation
query/read surfaces
current test-org feature flags/configuration
```

The named command layer currently demonstrates product surfaces including CRM, Accounting, Sales, Proposals, Inventory, Manufacturing, Expenses, Fleet, Calendar, Messages, Purchasing, Reports, HR, IoT, Projects, Subscriptions, Workflows, Documents, POS, Helpdesk, Approvals, Templates, organization/company, imports, settings, and AI/admin surfaces. That list is evidence for the initial census, not a frozen product taxonomy.

At `COV-00`, every discovered surface is classified as one of:

```text
T0 business module        must reach U5 before exposure
T0 horizontal capability must reach equivalent U5 integration
administrative            certify for intended test-org administrator or hide
AI                         governed by P0/P1; never required for T0
internal/developer        hidden from the test organization
retired/duplicate         remove or redirect to canonical owner
```

No discovered user-facing operation or route remains unclassified at T0.

## 4. Module completeness classes

Use one maturity scale across all business modules.

### U0 — inventoried

Ownership, routes, reads, writes, lifecycle states, major relationships, tests, known defects, and intended test-org exposure are known.

### U1 — discoverable and readable

- module appears in navigation only if enabled;
- core records have real list/search/filter/read surfaces;
- loading, empty, denied, and dependency-failure states are meaningful;
- company/organization scope is correct;
- record state and important relationships are visible.

### U2 — core record operations

- domain-appropriate create/edit/archive/delete or equivalent operations are reachable;
- forms use canonical/generated inputs and shared form infrastructure where applicable;
- successful writes converge on canonical state;
- validation and permission errors are actionable;
- no fake local success or hard-wired placeholder payload is used.

### U3 — primary lifecycle complete

The module's principal business journey is executable from beginning to terminal/wait/cancel states using canonical operations. Resulting records are discoverable deterministically and linked directly.

### U4 — integrated and resilient

- cross-module links and handoffs work;
- approvals/separation of duties apply where required;
- retry, duplicate submission, stale state, committed-response-lost and outcome-unknown behavior is explicit;
- audit/history/activity/documents/messages are attached where applicable;
- authorization is rechecked at protected operations;
- relevant tenant/invariant adversarial cases pass.

### U5 — first-test-org certified

- one realistic seeded golden path passes in the full stack;
- applicable negative/adversarial paths pass;
- refresh/reconnect does not lose canonical state;
- responsive/mobile usability has been checked;
- no visible stub/dead action/empty promised feature remains;
- operations needed by the primary workflow are classified and reachable;
- any deliberately deferred secondary capability is hidden/disabled and documented rather than half-presented.

**T0 requires U5 for every exposed T0 module/horizontal surface.**

## 5. Common module parity contract

Every T0 business module satisfies the applicable items below. `N/A` requires a reason in the module evidence; it is not a shortcut.

### 5.1 Entry and discovery

- discoverable navigation/command-palette entry;
- useful landing state/dashboard or direct primary-work surface;
- core records searchable/filterable/sortable as appropriate;
- canonical record deep links;
- meaningful empty/onboarding state.

### 5.2 Record interaction

- readable detail/current state;
- domain-appropriate create/edit/archive/delete/cancel operations;
- generated types/contracts at the mutation boundary;
- no local duplicate business-rule engine;
- canonical state readback after mutation.

### 5.3 Lifecycle

- primary lifecycle has explicit transitions;
- valid next actions are understandable;
- waiting/approval/blocked/failure/terminal/cancelled states are represented;
- state-dependent actions do not rely on the client as authority;
- downstream/upstream records are linked.

### 5.4 Outcome ownership

Use the COH semantics for effects and failures:

```text
Applied
AlreadyApplied / NoOpReplay
Rejected
Waiting
OutcomeUnknown(reconciliation reference)
```

Expected validation, permission, conflict, stale-state, dependency and retry semantics remain typed through the frontend boundary.

### 5.5 Authorization and tenancy

- actor/org context server-derived;
- company selection validated;
- row/resource visibility enforced server-side;
- approval and separation-of-duties enforced where relevant;
- permission changes are rechecked at execution;
- cross-tenant/reference attacks leave zero unauthorized delta.

### 5.6 Operational context

As applicable:

- audit/history;
- comments/chatter/activity;
- documents/attachments;
- notifications/messages;
- imports/exports;
- reporting/print/PDF;
- approvals/tasks;
- diagnostics/reconciliation/operator path.

Horizontal capabilities should be reused rather than reimplemented per module.

### 5.7 UX quality

- pending controls prevent accidental duplicate submission;
- focus/keyboard/accessibility basics preserved;
- mobile/responsive layouts usable at the pre-tenant viewport matrix;
- loading/error/empty/success states are not silent;
- refresh/reopen/reconnect reflects durable canonical state;
- no button/tab exists purely because the backend has a reducer.

### 5.8 Tests

At minimum per exposed module:

- focused unit/adapter coverage for non-trivial transforms;
- relevant domain state-machine/invariant coverage;
- API/STDB integration proof for the primary transitions;
- one Playwright golden path using persisted state;
- applicable adversarial tests for authorization, tenant scope, duplicate submission, stale state, retry/lost response and concurrency.

## 6. Reducer/operation coverage policy

T0 does **not** require exposing every user-facing reducer directly.

Every current user-facing operation must instead be classified:

```text
primary-workflow        reachable through the module's main lifecycle
secondary-advanced      reachable from an appropriate advanced/admin surface
horizontal              owned by a shared module/capability
internal-support        intentionally not user-invoked
future-disabled         not exposed to the test org; explicit reason
obsolete/duplicate      removed or redirected
```

A reducer being present in generated bindings or a hook does not count as workflow coverage.

`COV-00` establishes the current operation→workflow mapping and `COV-27` verifies that no enabled test-org operation remains accidentally orphaned.

## 7. Initial module groups and primary workflows

`COV-00` may rename/split these groups after the current tree is inspected, but it must preserve full coverage.

| Module/surface | Minimum primary workflow for T0 |
| --- | --- |
| CRM | lead → opportunity → customer / Sales handoff, activities and follow-up |
| Sales | quotation → order → fulfillment/invoice linkage → return/credit continuation |
| Purchasing | supplier → requisition/RFQ → PO → receipt → bill/payment linkage |
| Inventory / WMS | product/location stock → transfer/picking → count/lot/quality/replenishment |
| Manufacturing / Quality | BOM → manufacturing order → work orders → consume/produce → quality → close/cost |
| Accounting / Finance / Assets | journal/invoice → post → payment/reconcile; bank reconciliation/period close/statements; asset lifecycle |
| HR / Payroll | employee → contract → leave/attendance → payroll lifecycle |
| Projects / Tasks | project → task → assignment/timesheet/milestone → cost/billing linkage |
| Expenses | expense → submit → approval → posting/reimbursement |
| Subscriptions | plan → subscription → recurring billing/payment → amend/renew/cancel/dunning where supported |
| POS | configuration/session → order → payment → close/reconcile |
| Helpdesk | ticket → assignment/SLA/state → resolution/close/reopen where supported |
| Fleet | vehicle → assignment → service/fuel/inspection/cost lifecycle |
| IoT | device → telemetry/health → alert → acknowledge/action/history |
| Proposals | draft → content/lines/source docs → review/approval → conversion/handoff where supported |
| Distributor workspace | customer/order/credit/delivery/collection/stock exception using canonical CRM/Sales/Inventory/Accounting records |
| Documents / Knowledge | folder/upload → version/review/access → archive/delete/retention behavior |
| Calendar / Activities | event/activity → assign/invite → update/complete/recurrence where supported |
| Messages / Communications | consent/template/thread/batch → approval → dispatch/status/history with identity correctness |
| Reports / Analytics | select/configure → run → inspect → export/schedule where supported |
| Approvals | pending work → inspect evidence → approve/reject/escalate → canonical outcome/audit |
| Workflows | definition/version → activation → run → human/timer/external step → completion/failure |
| Imports / Data Ops | upload → mapping → validate → preview → commit → error/replay handling |
| Forms / Templates | define/version → preview → apply/render → retire |
| Organization / Company / Settings / Auth | company setup → users/membership/roles/policy/configuration and safe access changes |

## 8. Core verticals remain deeper certification gates

Module parity complements rather than replaces vertical workflow certification.

Order-to-Cash and Procure-to-Pay remain the reference flows. Inventory, Accounting, Projects, HR/Payroll, and Subscriptions must also satisfy their relevant vertical invariants. A module cannot claim U5 because an isolated CRUD happy path passed while its cross-module business journey remains broken.

Conversely, a vertical does not make every participating module U5 if important module-local work remains unusable.

## 9. Test-organization seed and personas

T0 uses one reproducible seed pack representing realistic operations rather than empty-table demos.

Minimum seed categories:

```text
organization + at least one operating company
admin/operator plus limited-role personas
customers, suppliers, products, warehouses/locations
chart of accounts/taxes/currency/payment setup
employees/departments/contracts
projects/tasks
documents/templates
representative open and completed transactions
module-specific configuration needed for POS/MRP/Helpdesk/Fleet/IoT/etc.
```

Seed data must be deterministic enough for E2E assertions while still exercising real reducers/import paths where those are the product onboarding path.

Permission personas should include at least:

```text
organization administrator
finance/accounting actor
sales/CRM actor
warehouse/manufacturing actor
purchasing actor
HR/project actor
limited/read-only actor
```

A smaller role set may be composed where Casbin roles overlap, but tests must still prove denied and separation-of-duties behavior.

## 10. No-stub exposure policy

Before T0:

- no exposed route is a placeholder page;
- no visible tab promises an unimplemented feature;
- no quick action is dead or backed by hard-coded fake success;
- no empty table is presented when the real read path is missing;
- no hidden dependency failure is swallowed into an empty state;
- no internal/developer surface is accidentally included in the test-org navigation;
- a partially built feature may remain in code behind an explicit disabled flag, but its disabled state must be testable.

Add an automated route/navigation/feature-manifest check in `COV-27` so new exposed modules cannot bypass the parity gate.

## 11. Module work-package rule

Do not assign an agent “finish Accounting” without a bounded slice.

Each module package begins with a current gap map and is split when necessary into coherent workflow slices such as:

```text
Accounting: bank reconciliation
Accounting: period close + statements
Accounting: asset lifecycle
Inventory: picking/backorder
Inventory: cycle count + lot/serial
Manufacturing: MO/work-order completion
```

The companion ledger groups responsibilities for coordination; a `2x` entry authorizes multiple bounded follow-up sessions inside the same module responsibility, not one giant diff.

Use the existing module-maintainability ledger when the implementation slice also changes ownership/readability. Do not duplicate that cleanup plan inside this program.

## 12. T0 certification matrix

For every exposed module, record evidence for:

```text
U0 inventory complete
U1 discovery/read proof
U2 core operations proof
U3 primary lifecycle proof
U4 integration/resilience proof
U5 full-stack test-org proof
module Playwright golden-path spec
applicable adversarial specs
responsive viewport proof
permissions/personas exercised
known deferrals hidden from user
open blockers = none
```

System-wide T0 additionally requires:

- Order-to-Cash and Procure-to-Pay certification;
- executed pre-tenant browser suite for the enabled surface;
- cross-module deep-link/navigation proof;
- no unclassified user-facing operation for enabled modules;
- all visible module routes load under the seeded org without developer intervention;
- refresh/reconnect across representative workflows;
- backup/reconstruction requirements from the relevant deployability plans for durable pilot data;
- first-org support/operator procedures for reconciliation and diagnostics.

## 13. First-test-org launch rule

The organization launch configuration is generated from the accepted T0 matrix:

```text
if module.status == U5:
    expose according to role/policy
else:
    hide/disable for the test organization
```

Do not lower U5 to expose a broader-looking product. The purpose of the first test organization is to learn from real workflow behavior, not to rediscover known incomplete wiring.

## 14. Relationship to AI/offline

T0 is human-first.

After a workflow/module capability is U5 and its business invariants pass, the generated capability IR may classify it for:

- AI read/draft exposure;
- offline ChangeSet eligibility;
- WorkProgram composition.

Those consumers reuse the canonical operation/result semantics. They do not add alternative business implementations.

## 15. Completion criterion

This program is complete when the coordinator can produce one current matrix where every surface intended for the first test organization is U5, every non-U5 surface is absent from that organization's product navigation/capabilities, and the seeded organization can perform representative daily work across all enabled modules without database surgery, developer-only APIs, fake local state, or manual record hunting between modules.
