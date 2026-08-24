# STDB access-path investigation — Wave 2

**Status:** Investigation complete — 2026-08-24  
**Tracks:** `spacetimedb`, `performance`, `indexes`, `reducers`, `projections`, `application-contract-ir`  
**Related:** [stdb-index-access-path-optimization-plan.md](./stdb-index-access-path-optimization-plan.md) · [subscription-query-ir-codegen-plan.md](./subscription-query-ir-codegen-plan.md)

---

## 1. Objective

Extend the first access-path investigation beyond Queue/Sales/Accounting and identify concrete reshapes in:

- Workflow / approvals;
- Projects / PSA;
- Inventory;
- Purchasing;
- CRM activities;
- Subscription usage/billing;
- AI action-draft operations.

The purpose is not to mass-add indexes. The purpose is to identify where existing reducers compose multiple predicates after an index lookup or perform table iteration, then fold those access requirements into application IR so future codegen/CI can keep the hot path bounded.

---

## 2. Executive findings

### 2.1 Repeated pattern: good single-column indexes, weak compound operational paths

Across the inspected modules, most tables already expose useful primitive indexes. The recurring issue is that reducers then apply additional tenant/company/status/time/resource predicates in Rust.

Common missing shapes:

```text
(org, company, status)
(org, company, resource_id)
(org, resource_id, status)
(org, actor, status)
(org, state, time)
(org, company, state, time)
```

These should become declared access-path contracts when they correspond to interactive reducers/subscriptions.

### 2.2 Existing materialized projections prove the pattern is already valid

`ProjectMarginSnapshot` and `ResourceUtilisationSnapshot` already materialize live operational summaries in STDB. The next optimization step is not to invent a new concept, but to make projection ownership/rebuild/access-path dependencies explicit in IR.

### 2.3 Some broad scans are legitimate; the IR needs an explicit `scan` classification

Inventory preflight auditing is intentionally broad. Interactive workflow discovery, queue claims, billing, approval queues, AI draft expiry, CRM agenda reads, etc. should not silently fall into the same category.

---

## 3. Workflow / approval gate

### Current behavior

`discover_gate_plan` scans all `workflow` rows and filters by:

```text
organization_id
model
company_id = null OR company_id = target company
```

It then follows indexed `workflow_version_by_workflow`, filters published versions, loads nodes/edges by version, and tests whether an action node matches the requested guarded action.

`started_instance` scans `workflow_command_receipt` and filters by:

```text
organization_id
company_id
command_kind = Start
idempotency_key
```

`active_token` uses `workflow_token_by_instance` and then filters `state = Active`.

### Candidate access paths

```text
Workflow
(org, model, company_scope)

WorkflowVersion
(workflow_id, status)

WorkflowCommandReceipt
(org, company, command_kind, idempotency_key)   UNIQUE/equality candidate

WorkflowToken
(instance_id, state)

WorkflowHumanTask
(instance_id, guarded_action_key/schema_version)
```

Because nullable company scope is semantically meaningful, prefer an explicit normalized scope key if STDB index/filter limitations make `Option` awkward:

```text
company_scope_key = company_id.unwrap_or(0)
```

### Projection candidate

For high-frequency approval discovery, consider a rebuildable `PublishedGuardedWorkflowBinding` projection keyed by:

```text
organization
company_scope
subject_model
action_key
action_schema_version
```

It should point to a published workflow/version and eliminate repeated graph discovery for every guarded action. Workflow graph validation remains authoritative in the workflow domain.

### IR implication

Guarded-action IR already knows `action_key` and schema version. Extend it with a generated lookup dependency on `PublishedGuardedWorkflowBinding` or the direct workflow composite path.

**Priority: P0/P1** — approval gates sit on many write paths, so repeated discovery cost compounds across domains.

---

## 4. Projects / PSA

### Existing projections

`ProjectMarginSnapshot` materializes live margin per project and `ResourceUtilisationSnapshot` materializes employee utilisation.

### Current recomputation hot spots

Margin refresh uses indexed project-based timesheet/milestone/subcontractor lookups but still scans/filter-composes:

```text
hr_expense:
(org, company, project_id, state)

crossovered_budget_lines:
(org, company, project_id)
```

Utilisation refresh reads:

```text
resource_capacity_snapshot by company
  then filters org + employee

project_timesheet by employee
  then filters org + company + date range
```

Projection replacement currently deletes any matching snapshot rows then inserts a new one, using a single-column project/employee index plus tenant/company filters.

### Candidate access paths

```text
HrExpense
(org, company, project_id, state)

CrossoveredBudgetLine
(org, company, project_id)

ProjectTimesheet
(org, company, project_id)
(org, company, employee_id, date)

ResourceCapacitySnapshot
(org, company, employee_id)

ProjectMarginSnapshot
(org, company, project_id)   UNIQUE candidate

ResourceUtilisationSnapshot
(org, company, employee_id, period_start, period_end)
```

### Projection reshape

The existing snapshots should become first-class `ProjectionDescriptor`s in IR with explicit:

```text
source resources
maintainer operations
rebuild function
projection key
access path
```

This gives a concrete first proof that IR can model already-existing STDB projection behavior before new projections are introduced.

**Priority: P0** — this is the best projection-IR proof because the projection tables already exist.

---

## 5. Inventory

### Current table shapes

`StockQuant` indexes organization/product/location/lot separately. `StockMove` indexes org/product/picking/state/date separately. `StockPicking` indexes org/state/partner/date separately.

These are foundational inventory tables and will grow quickly relative to many ERP domains.

### Candidate hot paths

```text
StockQuant
(org, company, product_id, location_id)
(org, product_id, location_id, lot_id)
(org, company, location_id, product_id)

StockMove
(org, company, state, date_expected)
(org, picking_key, state)
(org, product_id, state, date_expected)
(org, warehouse_id, state, date_expected)

StockPicking
(org, company, state, scheduled_date)
(org, partner_id, state)
(org, sale_id)
(org, purchase_id)
```

### Strong projection candidate

Evaluate a maintained operational `WarehouseProductAvailability` projection keyed by:

```text
organization
company
warehouse/location
product
```

with current:

```text
on_hand
reserved
available
incoming
outgoing
late/exception flags
```

Do **not** add this if `StockQuant` can itself remain the canonical hot availability representation with bounded composite access. The investigation gate should explicitly compare:

```text
composite StockQuant access
vs
additional projection table
```

### Reliability reshape

Inventory preflight audits should remain explicit `scan` operations, but large-tenant execution should be background/bounded by partition or checkpoint rather than one interactive reducer traversing an entire organization.

**Priority: P0** — inventory is likely one of the first domains where index shape materially affects RAM/CPU at scale.

---

## 6. Purchasing

### Current table shapes

`PurchaseOrder` currently indexes organization and partner. `PurchaseOrderLine` indexes organization and order. `PurchaseRequisition` indexes organization and user.

The records themselves contain operational state, company, invoice/receipt state, planned dates, user/vendor, and workflow fields that are natural filter dimensions.

### Candidate access paths

```text
PurchaseOrder
(org, company, state)
(org, partner_id, state)
(org, company, receipt_status)
(org, company, invoice_status)
(org, company, state, date_planned)
(org, user_id, state)

PurchaseOrderLine
(org, order_id)
(org, company, product_id, state)
(org, company, match_state)
(org, sale_order_id)

PurchaseRequisition
(org, company, state)
(org, user_id, state)
(org, department_id, state)
(org, vendor_id, state)
```

### Projection candidate

A small `ProcurementOperationalSummary` may be justified for owner/operations views:

```text
open requisitions
RFQs awaiting vendor response
POs awaiting receipt
POs with match exceptions
POs awaiting invoice
```

Prefer per-company/org summary counters only after the generated query paths are optimized; do not materialize what a bounded index query can answer cheaply.

**Priority: P1**.

---

## 7. CRM activities / calendar

### Current table shapes

`Activity` indexes organization, user and deadline separately. `CalendarEvent` indexes organization and user.

Likely high-frequency UI shapes are more specific:

```text
my open activities
activities for record
activities due soon/overdue
calendar events for user in time range
```

### Candidate access paths

```text
Activity
(org, assigned_to, is_done, date_deadline)
(org, user_id, is_done, date_deadline)
(org, res_model, res_id, is_done)
(org, state, date_deadline)

CalendarEvent
(org, user_id, start)
(org, start)
```

If polymorphic `res_model + res_id` lookups are a common chatter/record-page path, they should be treated as a first-class typed access shape rather than generic scanning.

### Projection candidate

No new projection is immediately required. Start with composite indexes and generated subscription descriptors for:

```text
my-agenda
record-activities
overdue-activities
```

**Priority: P1**.

---

## 8. Subscription usage / billing

### Current behavior

Usage events/charges have separate indexes for organization, subscription and status. The reducers repeatedly use `by_sub` then filter status and organization.

Tier lookup uses `by_plan` and then filters:

```text
organization
active
product_id
```

Billing paths gather all unbilled charges for a subscription and append them into the invoice.

### Candidate access paths

```text
SubscriptionUsageEvent
(org, subscription_id, status, occurred_at)
(org, status, occurred_at)

SubscriptionUsageCharge
(org, subscription_id, status)
(org, company, status)
(org, billing_run_key)

SubscriptionPriceTier
(org, plan_id, product_id, active, sequence)

SubscriptionCommitment
(org, subscription_id, active)
```

The existing globally unique `idempotency_key` is already a strong direct ingest path and should remain the canonical replay check.

### Projection candidate

A `SubscriptionBillingOperationalState` projection may be justified if the UI/harness repeatedly needs:

```text
pending_usage_event_count
unbilled_charge_count
unbilled_amount
next_billing_at
billing_exception_state
```

However, counts alone may be cheap enough from a bounded `(org, subscription, status)` path. Benchmark before materializing.

**Priority: P0/P1** — usage ingest/rating is potentially high-volume and background-heavy.

---

## 9. AI action drafts

### Current table shape

`AiActionDraft` indexes organization, company and status separately.

Operational usage naturally asks for:

```text
pending drafts for company
pending elevated drafts
expired pending drafts
pending drafts proposed by actor
```

The expiry reducer starts from company and then filters organization/status/expiry.

### Candidate access paths

```text
AiActionDraft
(org, company, status)
(org, company, status, expires_at)
(org, proposed_by, status)
(org, company, elevated, status)
```

### Projection candidate

No separate row projection is necessary initially. A tiny company/org AI governance summary could later maintain counts for command-center/admission UI, but only after the direct draft paths are bounded.

### IR implication

Because AI draft operations are already generated/allowlisted through harness capability metadata, their expected read/write set should be one of the first agent-control-plane operations to consume `AccessPathDescriptor` metadata.

**Priority: P1**.

---

## 10. Cross-domain projection candidates to fold into IR

After Wave 2, the strongest candidates are:

| Projection | Status | Why |
|---|---|---|
| `ProjectMarginSnapshot` | existing | Best first proof for `ProjectionDescriptor` adoption |
| `ResourceUtilisationSnapshot` | existing | Existing time-window projection with clear maintainers |
| `PublishedGuardedWorkflowBinding` | new candidate | Removes repeated workflow graph discovery from guarded writes |
| `WarehouseProductAvailability` | investigate | Potentially large win, but only if StockQuant composites are insufficient |
| `Organization/CompanyOperationalSummary` | new candidate | High-value owner/dashboard counters across domains |
| `PartnerBalanceSummary` | new candidate | Avoid repeated receivable/payable aggregation for record drilldowns |
| `SubscriptionBillingOperationalState` | benchmark first | Useful if usage volume makes repeated counts expensive |

IR should distinguish:

```text
existing projection → adopt/describe
new projection → benchmark/approve
```

Do not generate projection formulas automatically in this phase.

---

## 11. Concrete IR reshape from Wave 2

Extend the planned access-path metadata with a source classification:

```ts
interface OperationReadSet {
  resource: ResourceKey
  equality: readonly FieldKey[]
  range?: FieldKey
  expectedCardinality: "one" | "few" | "bounded-page" | "scan"
  accessPath?: AccessPathKey
  sourceClass: "canonical-table" | "hot-projection" | "postgres-history"
}
```

Add projection lifecycle metadata:

```ts
interface ProjectionDescriptor {
  key: ProjectionKey
  resource: ResourceKey
  keyFields: readonly FieldKey[]
  sourceResources: readonly ResourceKey[]
  maintainedBy: readonly OperationKey[]
  rebuildOperation: OperationKey
  consistency: "transactional" | "async-rebuildable"
  historyAuthority: "postgres"
}
```

Add validation rules:

```text
interactive one/few read + no compatible access path         => error
hot projection + no maintainer/rebuild operation             => error
subscription predicates incompatible with access-path prefix => error
scan on interactive operation                                => error unless explicit waiver
historical multi-period aggregate routed to STDB             => warning/error depending contract
```

---

## 12. Recommended implementation order

### Wave 2A — lowest-risk/highest-signal

1. Adopt existing project projections into IR.
2. Fix workflow receipt/token compound lookups.
3. Add AI draft `(org, company, status, expires_at)` path.
4. Add subscription usage/charge compound paths.

### Wave 2B — core ERP throughput

5. Inventory StockQuant/StockMove/StockPicking access-path redesign.
6. Purchasing state/company/product access paths.
7. CRM agenda/record-activity paths.

### Wave 2C — projections after benchmarks

8. Evaluate `PublishedGuardedWorkflowBinding`.
9. Evaluate `WarehouseProductAvailability`.
10. Evaluate company/owner operational summary and partner balance summary.

---

## 13. Acceptance criteria for the next implementation pass

- every Wave 2 candidate is mapped to at least one concrete reducer/query/subscription consumer before adding an index;
- existing project projections are represented in IR without moving their business formulas into codegen;
- guarded workflow receipt/token discovery no longer requires broad iteration;
- high-volume usage billing paths use compound access paths;
- AI draft expiry/pending queues are bounded by organization/company/status/time;
- inventory access-path decisions are benchmarked against representative StockQuant/StockMove cardinalities;
- intentional audits/migrations remain explicit scans;
- redundant single-column indexes are removed only after composite left-prefix coverage and consumers are proven;
- no projection becomes canonical audit/history state; Postgres remains durable history authority.
