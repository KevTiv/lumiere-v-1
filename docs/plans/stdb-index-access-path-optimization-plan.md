# STDB access-path, projection, and IR performance optimization plan

**Status:** Proposed — 2026-08-24  
**Tracks:** `spacetimedb`, `performance`, `indexes`, `reducers`, `projections`, `application-contract-ir`, `subscription-codegen`, `codegen-validation`  
**Related:** [subscription-query-ir-codegen-plan.md](./subscription-query-ir-codegen-plan.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Objective

Reshape Lumière's SpacetimeDB hot path so heavy reducers and realtime reads avoid avoidable table scans, repeated aggregation, and duplicated query knowledge.

Do this through an explicit **access-path and projection contract in application IR**, rather than by manually adding indexes table by table.

Target architecture:

```text
STDB schema/domain model
        ↓
application-contract IR
  resources
  operations
  read sets
  write sets
  access-path requirements
  projection requirements
        ↓
codegen / validation
  STDB indexes
  typed accessors
  subscription descriptors
  reducer lookup helpers
  projection maintenance wiring
        ↓
fast bounded STDB execution
```

IR owns the declared access shape. STDB remains the runtime/business-logic authority. Business rules remain handwritten domain logic unless already suitable for generated contracts.

---

## 2. Investigation approach

The initial investigation was split into four independent scan lanes:

1. **Table/index lane** — inspect table definitions and current indexes.
2. **Reducer lane** — identify `.iter().filter(...)`, `.find(...)`, repeated joins, and high-fanout reducer reads.
3. **Projection lane** — identify repeatedly recomputed balances, counts, queues, summaries, and operational dashboards that could become maintained STDB projections.
4. **IR/realtime lane** — identify where subscription/query descriptors can own the access-path contract and prevent future drift.

This plan is an implementation backlog, not a claim that every candidate below must become an index or materialized projection. Every addition must be justified by a known reducer, subscription, authorization path, or measured hot query.

---

## 3. Initial findings

### 3.1 Single-column indexes are common where workload-shaped composites are needed

Representative current patterns:

- `sale_order`: separate indexes for `organization_id`, `company_id`, `partner_id`, and `state`;
- `account_move`: separate indexes for organization/company/journal/partner/state/date/name;
- `account_move_line`: separate indexes for organization/move/account/partner/date;
- `queue_job`: separate indexes for organization/company/queue/status/available_at.

These are useful primitives, but common ERP access paths compose these predicates together. Examples:

```text
organization + state
organization + partner + state
organization + company + state + date
organization + account + date
organization + queue + status + available_at
organization + company + semantic_key
```

The hot-path design should prefer indexes matching real compound access patterns instead of relying on independent indexes plus in-memory filtering.

### 3.2 Reducer scans already exist on operational tables

The queue enqueue path currently searches `queue_job().iter()` for the semantic uniqueness tuple:

```text
organization_id
company_id
semantic_key
```

This should become a direct bounded access path.

Inventory preflight audit code also contains organization-scoped `.iter().filter(...)` scans over adjustment, integration-intent, close, warehouse and audit-violation tables. Some audit-style scans are intentionally broad and may stay that way, but the distinction must become explicit rather than accidental.

### 3.3 Some current tables already contain denormalized operational summaries

`SaleOrder` already stores values such as totals, residual amount, invoice/delivery counts, message/action counters, and activity state. This demonstrates that maintaining hot operational state in STDB is already part of the model.

The optimization should formalize that approach for cross-record summaries where repeated aggregation is expensive, while keeping long-history reporting in Postgres.

### 3.4 Subscription IR is the natural contract boundary

The subscription-query plan already moves resource scope, predicates, projections and ordering into structural IR. Extend that work so the same descriptor graph can declare the expected STDB access path.

A generated subscription such as:

```text
open invoices for organization/company
```

should be able to state that it expects a bounded path equivalent to:

```text
(organization_id, company_id, state)
```

and fail codegen/CI when no compatible path exists.

---

## 4. IR extensions

Introduce structural performance metadata rather than raw STDB syntax.

### 4.1 `AccessPathDescriptor`

Illustrative model:

```ts
interface AccessPathDescriptor {
  key: AccessPathKey
  resource: ResourceKey
  kind: "primary" | "unique" | "btree" | "direct"
  columns: readonly FieldKey[]
  supports: readonly AccessPatternKey[]
  tenantPrefix?: "organization" | "organization+company" | "none"
  cardinality: "one" | "few" | "many"
  ordered?: boolean
  generated?: boolean
}
```

Do not place Rust macro strings or SQL in application IR.

### 4.2 `OperationReadSet`

Each generated operation/query/subscription may declare the records it must locate:

```ts
interface OperationReadSet {
  resource: ResourceKey
  equality: readonly FieldKey[]
  range?: FieldKey
  orderBy?: readonly FieldKey[]
  expectedCardinality: "one" | "few" | "bounded-page" | "scan"
  accessPath?: AccessPathKey
}
```

`scan` must be explicit. An operation expected to return one/few rows must not silently compile to an unbounded iteration.

### 4.3 `OperationWriteSet`

Capture affected resources so projection dependencies can be generated/validated:

```ts
interface OperationWriteSet {
  resource: ResourceKey
  mutations: readonly ("insert" | "update" | "delete")[]
  affectsProjections?: readonly ProjectionKey[]
}
```

This is descriptive metadata, not generated business logic.

### 4.4 `ProjectionDescriptor`

For approved hot projections:

```ts
interface ProjectionDescriptor {
  key: ProjectionKey
  scope: "organization" | "company" | "resource"
  sourceResources: readonly ResourceKey[]
  keyFields: readonly FieldKey[]
  maintainedBy: readonly OperationKey[]
  rebuildable: true
  durableHistorySource: "postgres"
}
```

IR may generate wiring, table/accessor metadata and validation, but the aggregation formula remains explicit domain code unless a limited deterministic projection primitive is deliberately introduced later.

---

## 5. Candidate access-path reshapes

### 5.1 Core queue — highest priority

Current queue tables are a strong first proof because they are infrastructure hot paths and currently expose single-column indexes while reducer behavior composes multiple predicates.

Candidate paths:

```text
QueueJob
(org, company, semantic_key)          UNIQUE/equality
(org, queue_name, status, available_at)
(org, status, available_at)
(org, company, status, available_at)

QueueAttempt
(org, job_id)

QueueWorker
(org, company, is_active)
```

The worker-claim algorithm should use an explicitly bounded ordered path rather than broad iteration.

Acceptance proof:

- semantic replay lookup is direct/bounded;
- claim-next-job does not scan the whole queue;
- queue latency remains stable as completed/dead-letter history grows.

### 5.2 Sales

Candidate paths derived from normal workflow/read shapes:

```text
SaleOrder
(org, state)
(org, company, state)
(org, partner_id, state)
(org, user_id, state)
(org, warehouse_id, state)
(org, state, date_order)

SaleOrderLine
(org, order_id)
(org, product_id, state)
(org, company_id, invoice_status)
```

Review existing separate indexes and remove redundant ones only after generated operations prove composites cover their required left-prefix lookups.

### 5.3 Accounting

High-value candidates:

```text
AccountMove
(org, company, state)
(org, company, state, date)
(org, partner_id, payment_state)
(org, move_type, state, date)
(org, invoice_date_due, payment_state)

AccountMoveLine
(org, move_id)
(org, account_id, date)
(org, partner_id, date)
(org, company_id, parent_state, date)
```

This domain is a prime candidate for separating current operational state in STDB from large historical/reporting aggregation in Postgres.

### 5.4 Inventory

Inventory needs a dedicated second scan because access shape depends heavily on stock/warehouse/product semantics.

Candidate families to evaluate:

```text
(org, warehouse/location, product)
(org, product, lot/serial)
(org, state, scheduled/effective time)
(org, company, state)
```

Audit/preflight reducers should distinguish intentionally full organization scans from accidental scans. Production integrity checks should preferably operate through bounded partitions or scheduled/background work when datasets become large.

### 5.5 Workflow / approvals

Likely operational paths:

```text
(org, status)
(org, assignee/identity, status)
(org, action_key, status)
(org, company, status, created_at)
```

Filtered resources such as `*-to-approve`, `*-pending`, and `*-past-due` should share the same IR predicate/access-path contract as subscriptions.

### 5.6 CRM / projects / HR / expenses

The initial scan found repeated filter-heavy reducer candidates across CRM integrity, project accounting/PSA, HR onboarding, action drafts, expenses and other modules.

Do not add blanket indexes yet. Run per-domain access-path extraction and classify each lookup as:

```text
point lookup
small fanout
bounded queue/page
intentional scan
historical/reporting → move/read from PG
```

---

## 6. Candidate hot STDB projections

The goal is not to duplicate the entire database. Maintain only operational summaries that eliminate repeated work on high-frequency UI/reducer paths.

### 6.1 Organization/company operational summary

Potential fields:

```text
open_sales_orders
open_purchase_orders
overdue_receivables_count
open_approval_count
inventory_exception_count
active_queue_jobs
```

Use for owner/dashboard command-center reads.

### 6.2 Customer/vendor balance summary

Potential keys:

```text
organization_id
company_id
partner_id
```

Potential state:

```text
receivable_open
payable_open
overdue_amount
unapplied_payment_amount
open_invoice_count
```

Keep ledger history and reporting proof in Postgres; projection is current operational state and rebuildable.

### 6.3 Warehouse/product availability summary

Candidate key:

```text
organization + warehouse/location + product
```

Potential values:

```text
on_hand
reserved
available
incoming
outgoing
exception flags
```

This should only be added after reviewing existing stock quant/state tables to avoid duplicating an already canonical hot representation.

### 6.4 Approval queue summary

Candidate key:

```text
organization + actor/role + action class
```

Use when current queue views repeatedly derive counts/status from many workflow records.

### 6.5 Agent/job operational summary

Candidate values:

```text
running jobs
pending jobs
failed jobs
sandbox slots consumed
AI budget consumed/current period
```

This can align with the admission-control work without making gateway rate limiting depend on STDB.

---

## 7. Projection rules

A hot projection must satisfy all of the following:

1. serves a measured/high-frequency operational read;
2. has a deterministic authoritative source;
3. can be rebuilt;
4. can be updated transactionally with the relevant reducer or through a reliable internal event/job path;
5. does not become canonical historical/audit evidence;
6. has explicit tenant/company scope;
7. has drift/rebuild tests.

Do not materialize:

- arbitrary dashboard experiments;
- long-history BI metrics better served by Postgres;
- semantic/vector search state;
- duplicated copies of tables merely to avoid designing an index.

---

## 8. Generated accessors and reducer integration

Introduce generated helpers for declared access patterns where useful.

Instead of handwritten:

```rust
ctx.db.queue_job().iter().find(|job| {
    job.organization_id == org
        && job.company_id == company
        && job.semantic_key == key
})
```

prefer a generated/domain accessor conceptually like:

```rust
queue_job_access::by_org_company_semantic_key(ctx, org, company, key)
```

The generated layer may select the declared index/accessor. Reducers retain authorization, validation, state transition, audit and business rules.

Benefits:

- access semantics are consistent with IR;
- index renames/schema reshapes do not leak across domain code;
- CI can correlate every accessor to an index;
- tests can assert bounded cardinality.

---

## 9. Subscription/query integration

Extend `GeneratedSubscriptionDescriptor` with an optional/required access-path reference for hot resources:

```ts
interface GeneratedSubscriptionDescriptor {
  // existing fields
  accessPath?: AccessPathKey
  expectedCardinality?: "one" | "few" | "bounded-page" | "many"
}
```

The compiler/validator should verify that scope + predicates form a compatible left-prefix/range query for the declared access path.

Likewise, ordinary `QueryDescriptor` should declare equivalent access metadata so HTTP reads and realtime reads do not diverge operationally.

Example:

```text
resource: sale-orders-to-approve
scope: organization+company
predicate: state = pending_approval
order: created_at
accessPath: sale_order_by_org_company_state_created
```

---

## 10. Static validation and CI

Add a generated performance-contract check.

Fail CI for:

- point/few-row operation with no compatible index;
- subscription scope/predicates incompatible with its declared index prefix;
- generated reducer accessor pointing at no index;
- tenant-owned access path where organization scope is absent unless explicitly justified;
- projection declared but no maintainer operations registered;
- projection source mutation not represented in its write-set dependency graph;
- duplicate/redundant index with no known consumer after migration;
- new handwritten `.iter().find/filter` in reducers unless annotated as intentional bounded/full scan.

Warnings rather than failures initially for:

- high-write tables with many indexes;
- indexes with no generated consumer;
- operations whose expected cardinality is `many` without pagination/bounds;
- scan operations on tables projected to grow beyond configured thresholds.

Suggested escape hatch:

```rust
// lumiere: intentional-scan reason="preflight integrity audit"
```

Escapes must be explicit, reviewable and searchable.

---

## 11. Runtime observability

Do not optimize only statically. Add operation-level metrics keyed by generated operation/access-path IDs where feasible:

```text
operation key
access path key
rows examined / rows returned (when observable)
reducer duration
subscription setup/update duration
projection update duration
contention/retry count
```

Use these to decide when an index or projection remains justified.

Performance changes should have before/after fixtures with representative tenant sizes.

---

## 12. Implementation phases

### AP-0 — full inventory and classification

- [ ] enumerate STDB tables and their primary/unique/index definitions;
- [ ] enumerate reducers and internal helpers using `.iter()`, `.filter()`, `.find()`, repeated nested lookups and aggregation loops;
- [ ] map current QueryDescriptor and SubscriptionDescriptor resources to tables/read models;
- [ ] enumerate existing denormalized counts/totals/summary-like tables and fields;
- [ ] classify every discovered path as point/few/bounded-page/scan/history;
- [ ] record intentional audit/migration scans separately from interactive hot paths;
- [ ] produce a machine-readable inventory artifact for codegen work.

### AP-1 — IR access-path contract

- [ ] add `AccessPathDescriptor`;
- [ ] add read-set/cardinality metadata to operations/queries/subscriptions;
- [ ] add write-set/projection dependency metadata;
- [ ] add projection descriptors;
- [ ] add generation-time compatibility checks;
- [ ] ensure raw STDB syntax/macros do not leak into application IR.

### AP-2 — queue proof

- [ ] implement queue composite/unique access paths;
- [ ] remove semantic-key queue scan;
- [ ] make claim-next-job bounded and ordered;
- [ ] add benchmark/load fixture with large completed queue history;
- [ ] use generated accessors as first proof of IR→STDB access-path wiring.

### AP-3 — core ERP composites

- [ ] sales access-path migration;
- [ ] accounting access-path migration;
- [ ] purchasing access-path migration;
- [ ] inventory access-path migration;
- [ ] workflow/approval access-path migration;
- [ ] remove proven redundant single-column indexes only after regression/performance validation.

### AP-4 — subscription/query convergence

- [ ] attach access-path keys to generated subscriptions;
- [ ] attach access-path keys to ordinary query descriptors;
- [ ] validate prefix/range compatibility;
- [ ] make frontend subscription/query codegen consume the same resource/access-path contract;
- [ ] add regression fixtures for current subscription SQL issues.

### AP-5 — hot projections

- [ ] benchmark owner/dashboard aggregation cost;
- [ ] implement organization/company operational summary only if justified;
- [ ] evaluate customer/vendor balance summary;
- [ ] evaluate warehouse/product availability summary against existing stock model;
- [ ] evaluate approval queue summary;
- [ ] add rebuild/drift tests for every accepted projection.

### AP-6 — repository enforcement

- [ ] CI check for unapproved reducer scans;
- [ ] CI check for missing declared access paths;
- [ ] CI check for stale/unused generated indexes;
- [ ] performance benchmark fixtures for representative 100/1k/10k/100k-row tenant slices where practical;
- [ ] document rules in reducer/codegen contributor guidance.

---

## 13. Prioritization

Recommended first order:

```text
1. queue/job infrastructure
2. workflow/approval queues
3. sales + accounting hot paths
4. inventory stock/availability paths
5. generated subscription/query access-path validation
6. measured hot projections
7. remaining CRM/HR/projects/expenses domains
```

Do not begin by mass-adding composite indexes across all tables. First build the inventory and IR contract so indexes become generated/validated consequences of known workload semantics.

---

## 14. Performance target

The goal is not a specific synthetic requests/minute number. The target behavior is:

- point/few-row reducers remain approximately stable as unrelated tenant/table history grows;
- queue/admission operations do not degrade linearly with completed history;
- high-frequency subscriptions use bounded tenant-prefixed access paths;
- dashboard/owner-control reads avoid repeated large hot-table aggregation where projections are justified;
- historical/analytical scans move to or remain in Postgres rather than consuming STDB hot-path capacity;
- additional indexes do not exhaust the 16/32 GB STDB memory target through uncontrolled duplication.

---

## 15. Non-goals

- generating business state transitions from IR;
- making every table indexable by every field;
- materializing every aggregate;
- moving durable history back from Postgres into STDB;
- adding Redis/Qdrant as performance shortcuts;
- hiding intentional full scans used for bounded admin/migration/preflight workflows;
- introducing a generic unrestricted query DSL.

---

## 16. Exit criteria

This track is complete when:

1. every hot generated query/subscription/reducer access pattern has a declared bounded access path or an explicit scan justification;
2. workload-shaped composite indexes replace avoidable broad scans on core hot paths;
3. IR/query/subscription contracts can validate their required STDB access paths;
4. reducer code no longer independently invents common lookup semantics;
5. accepted operational projections are rebuildable, scoped, tested and tied to explicit write dependencies;
6. historical analytics remain on the Postgres side of the hot/cold architecture;
7. CI prevents reintroduction of unbounded interactive scans and contract/index drift;
8. representative load tests show stable p95/p99 behavior as tenant history grows.

---

## 17. Architectural decision

Adopt the following rule for Lumière V1:

> **Every interactive STDB read path should be either explicitly bounded by a declared access path or explicitly classified as an intentional scan; application IR should carry enough structural metadata to validate and generate that contract across reducers, queries, subscriptions and hot projections.**

This makes performance part of the same source-of-truth/codegen architecture already being established for application contracts instead of a later manual tuning exercise.
