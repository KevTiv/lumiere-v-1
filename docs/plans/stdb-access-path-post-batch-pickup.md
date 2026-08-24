# STDB access-path post-batch pickup plan

**Status:** Deferred pickup — execute only after the first STDB access-path batch passes its acceptance gates  
**Tracks:** `spacetimedb`, `performance`, `indexes`, `reducers`, `projections`, `application-contract-ir`  
**Related:** [stdb-index-access-path-optimization-plan.md](./stdb-index-access-path-optimization-plan.md) · [stdb-access-path-investigation-wave-2.md](./stdb-access-path-investigation-wave-2.md) · [subscription-query-ir-codegen-plan.md](./subscription-query-ir-codegen-plan.md)

---

## 1. Purpose

Preserve the second investigation-wave findings as an explicit follow-up backlog without allowing them to expand or destabilize the first implementation batch.

The rule is:

> **Do not implement the Wave 2 access-path/projection candidates until the first STDB access-path batch has passed its functional, benchmark, IR/codegen, and regression gates.**

This file is the pickup handoff for the next implementation pass. The detailed evidence and candidate shapes remain in `stdb-access-path-investigation-wave-2.md`.

---

## 2. First-batch completion gate

Wave 2 work may begin only after all of the following are true:

- [ ] AP-0 inventory/classification is complete enough to map changed paths to concrete reducers/queries/subscriptions;
- [ ] the initial `AccessPathDescriptor` / read-set contract is represented in IR;
- [ ] Queue is the successful proof of IR → bounded STDB accessor/index wiring;
- [ ] the first core composite-index batch has no known correctness or tenant-scope regressions;
- [ ] representative before/after benchmarks exist and show a measurable benefit or bounded-scaling improvement;
- [ ] subscription/query parity and generated-contract checks are green;
- [ ] repository Rust/STDB tests are green;
- [ ] frontend/realtime regression coverage remains green for touched resources;
- [ ] no new accidental interactive `.iter().filter()` / `.iter().find()` paths were introduced;
- [ ] redundant indexes are not removed until left-prefix coverage and consumers are proven.

If the first batch fails one of these gates, fix or simplify that batch before pulling Wave 2 work forward.

---

## 3. Wave 2 pickup order

### Batch 2A — bounded lookups + adopt existing projections

Pick these first because they have high signal and limited semantic change.

1. **Project projection IR adoption**
   - describe existing `ProjectMarginSnapshot` as a `ProjectionDescriptor`;
   - describe existing `ResourceUtilisationSnapshot` as a `ProjectionDescriptor`;
   - add explicit source resources, maintainer operations, rebuild operations and access paths;
   - do not move project-margin/utilisation formulas into codegen.

2. **Workflow/approval bounded discovery**
   - replace broad guarded-workflow discovery paths with workload-shaped indexes/accessors;
   - add bounded receipt lookup for `(org, company, command_kind, idempotency_key)`;
   - add `(workflow_id, status)` and `(instance_id, state)` paths where supported by concrete consumers;
   - keep workflow graph/business-rule evaluation handwritten.

3. **AI action-draft queues**
   - add `(org, company, status)`;
   - add `(org, company, status, expires_at)` for pending/expiry work;
   - consider `(org, proposed_by, status)` only when a concrete UI/harness consumer is mapped.

4. **Subscription usage/rating**
   - add `(org, subscription_id, status, occurred_at)` where the rating path benefits;
   - add `(org, subscription_id, status)` for unbilled/pending counts and invoice assembly;
   - review plan/product tier lookup against `(org, plan_id, product_id, active, sequence)`;
   - retain the existing unique idempotency key as the replay authority.

Batch 2A acceptance:

- [ ] no broad workflow receipt lookup remains on the guarded-action hot path;
- [ ] AI pending/expiry work is bounded by org/company/status/time;
- [ ] subscription usage/rating fixtures remain deterministic/idempotent;
- [ ] existing project projections are represented in IR and rebuild tests still pass.

---

### Batch 2B — core operational throughput

Pick only after Batch 2A is green.

5. **Inventory access-path redesign**

Evaluate and benchmark:

```text
StockQuant
(org, company, product_id, location_id)
(org, product_id, location_id, lot_id)

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

Do not add `WarehouseProductAvailability` yet. First prove whether composite `StockQuant`/move access is sufficient.

6. **Purchasing state/company access paths**

Evaluate concrete consumers for:

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

PurchaseRequisition
(org, company, state)
(org, user_id, state)
(org, department_id, state)
```

7. **CRM activity/calendar access paths**

Evaluate:

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

Prefer these bounded paths before introducing any new CRM projection.

Batch 2B acceptance:

- [ ] representative large StockQuant/StockMove cardinality fixture shows bounded latency improvement;
- [ ] purchasing approval/receipt/match/invoice queue reads use declared access paths;
- [ ] CRM agenda and record-activity subscriptions map to compatible access paths;
- [ ] write amplification/RAM impact from new indexes is measured before redundant primitives are removed.

---

### Batch 2C — projection decisions after benchmark evidence

These are candidates, not pre-approved implementation tasks.

8. **`PublishedGuardedWorkflowBinding`**

Consider only if direct compound workflow access still leaves meaningful repeated graph-discovery cost. Candidate key:

```text
organization
company_scope
subject_model
action_key
action_schema_version
```

The projection remains rebuildable and references a validated published workflow/version.

9. **`WarehouseProductAvailability`**

Consider only if composite stock access does not meet operational latency/CPU targets. Candidate key:

```text
organization
company
warehouse/location
product
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

10. **Organization/company operational summary**

Consider for the owner command-center only after individual resource queries are optimized. Potential counters:

```text
open_sales_orders
open_purchase_orders
overdue_receivables_count
open_approval_count
inventory_exception_count
active_queue_jobs
```

11. **Partner balance summary**

Consider when record-level contact/vendor drilldowns show repeated receivable/payable aggregation cost. Keep ledger/history authority in Postgres.

12. **Subscription billing operational state**

Consider only if bounded usage/charge indexes are still insufficient for frequently requested counts/amounts.

Batch 2C rule:

> A new projection requires measured read-cost evidence, a rebuild path, explicit maintainer operations, tenant/company scope, and proof that it is not replacing canonical audit/history state.

---

## 4. IR pickup requirements

When Wave 2 begins, use the same IR access contract established by the first batch. Do not create a second performance metadata system.

Wave 2 operations should map to:

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

Projection candidates use the established `ProjectionDescriptor` contract and must declare:

```text
projection key
key fields
source resources
maintainer operations
rebuild operation
consistency mode
Postgres history authority
```

No STDB macro syntax or raw subscription SQL belongs in application IR.

---

## 5. Explicit non-goals for the pickup

Do not use Wave 2 to:

- mass-add every candidate index;
- materialize every proposed projection;
- move business logic/formulas from reducers into codegen;
- optimize intentional audit/migration scans as if they were interactive reads;
- remove single-column indexes without proving composite left-prefix coverage;
- move historical/reporting authority back from Postgres into STDB;
- introduce Redis/Qdrant/cache infrastructure as a substitute for fixing access paths;
- broaden the first batch while its benchmark/regression gates are still failing.

---

## 6. Exit criteria

This follow-up is complete when the useful Wave 2 candidates have either been implemented with evidence or explicitly rejected/deferred with benchmark justification, and:

1. interactive one/few-row STDB paths have compatible declared access paths;
2. intentional broad scans are explicitly classified;
3. project projections are represented in IR;
4. workflow, AI draft and subscription-usage hot paths are bounded;
5. inventory/purchasing/CRM access paths are benchmark-backed;
6. new projections exist only where composite indexes were insufficient;
7. Postgres remains durable history/reporting authority;
8. index RAM/write cost remains visible in capacity planning for the 16/32 GB Scaleway targets.
