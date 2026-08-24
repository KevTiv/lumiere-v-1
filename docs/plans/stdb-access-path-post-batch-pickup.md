# STDB access-path post-batch pickup plan

**Status:** Deferred pickup — execute only after the first STDB access-path batch passes its acceptance gates  
**Tracks:** `spacetimedb`, `performance`, `indexes`, `reducers`, `projections`, `application-contract-ir`  
**Related:** [stdb-index-access-path-optimization-plan.md](./stdb-index-access-path-optimization-plan.md) · [stdb-access-path-investigation-wave-2.md](./stdb-access-path-investigation-wave-2.md) · [stdb-access-path-investigation-wave-3.md](./stdb-access-path-investigation-wave-3.md) · [subscription-query-ir-codegen-plan.md](./subscription-query-ir-codegen-plan.md)

---

## 1. Purpose

Preserve the investigation findings as an explicit follow-up backlog without allowing them to expand or destabilize the first implementation batch.

The rule is:

> **Do not implement Wave 2 / Wave 3 access-path or projection candidates until the first STDB access-path batch has passed its functional, benchmark, IR/codegen, and regression gates.**

After those batches, one final investigation gate remains: an exhaustive reducer census. The STDB access-path discovery program is not considered complete until every reducer is classified.

---

## 2. First-batch completion gate

Wave 2 / Wave 3 work may begin only after all of the following are true:

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

If the first batch fails one of these gates, fix or simplify that batch before pulling later work forward.

---

## 3. Wave 2 pickup order

### Batch 2A — bounded lookups + adopt existing projections

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

Batch 2B acceptance:

- [ ] representative large StockQuant/StockMove cardinality fixture shows bounded latency improvement;
- [ ] purchasing approval/receipt/match/invoice queue reads use declared access paths;
- [ ] CRM agenda and record-activity subscriptions map to compatible access paths;
- [ ] write amplification/RAM impact from new indexes is measured before redundant primitives are removed.

---

### Batch 2C — projection decisions after benchmark evidence

These are candidates, not pre-approved implementation tasks.

8. **`PublishedGuardedWorkflowBinding`** — only if direct compound workflow access still leaves meaningful repeated graph-discovery cost.

9. **`WarehouseProductAvailability`** — only if composite stock access does not meet operational latency/CPU targets.

10. **Organization/company operational summary** — only after individual resource queries are optimized.

11. **Partner balance summary** — only if contact/vendor drilldowns still show repeated receivable/payable aggregation cost.

12. **Subscription billing operational state** — only if bounded usage/charge indexes remain insufficient.

Batch 2C rule:

> A new projection requires measured read-cost evidence, a rebuild path, explicit maintainer operations, tenant/company scope, and proof that it is not replacing canonical audit/history state.

---

## 4. Wave 3 pickup — cross-cutting and missed reducer families

Wave 3 findings are picked only after the first-batch gate and should generally precede lower-value domain tuning when they affect many reducers.

### 4.1 Cross-cutting auth / membership / permission paths

Treat as the highest-value Wave 3 work because the cost is multiplied across protected reducers.

Evaluate and benchmark:

```text
UserOrganization
(user_identity, organization_id, is_active)
(user_identity, organization_id, company_id, is_active)

Role
(organization_id, normalized_name, is_active)

OrgPermission
(organization_id, subject discriminator/key, resource, action/effect)
```

Goals:

- avoid user-only lookup followed by org/active filtering on every permission check;
- avoid org-wide permission traversal when the subject/resource/action are known;
- avoid global role scans for normalized names;
- preserve deny-over-allow semantics and all authorization behavior.

Do not move authorization semantics into generated code; IR may describe required access paths, not policy meaning.

### 4.2 Fix existing-index misuse and schema mistakes before adding new indexes

Explicitly classify and fix:

- `HrExpense.sheet_lines()` using a table scan despite an existing sheet index;
- Helpdesk `ticket_by_assignee` index definition if it is still mapped to `organization_id` rather than the assignee field;
- any equivalent `existing-index-unused` or `wrong-index-definition` result found during implementation.

CI/static-analysis classifications should distinguish:

```text
missing-index
existing-index-unused
wrong-index-definition
bounded-fanout
intentional-scan
batch-checkpoint-required
postgres-history
```

### 4.3 Canonical `StockQuant` semantic identity

Do not independently optimize MRP, cycle counting, replenishment, quality and inventory against different quant lookup shapes.

Establish one canonical semantic lookup contract for the stock identity dimensions, conceptually:

```text
organization
company
product
location
lot
package
owner
```

If nullable index semantics make direct compound lookup awkward, normalize nullable dimensions into stable keys or another deterministic representation. Benchmark first; enforce uniqueness only if it matches actual business invariants.

Migrate known consumers such as:

- manufacturing quant upsert;
- cycle-count expected-quantity lookup;
- replenishment availability/source-location lookup;
- quality/quarantine paths;
- inventory movement/reservation helpers.

### 4.4 Configurable forms and custom-field EAV access

Evaluate:

```text
FormConfig
(org, module_id, form_id)

FormConfigField
(configuration_id, field_id)

FormRoleConfig
(configuration_id, role_id)

RecordCustomFieldValue
(org, company, model, record_id, field_key)

UserCustomField
(org, user, configuration_id, field_id)
```

The IR may own/configure these access-path descriptors because configurable forms are already contract-driven, but validation/business rules remain handwritten.

### 4.5 HR / Expenses / Helpdesk / Payments / Replenishment

Pick concrete hot paths only:

- HR onboarding progress by `(employee, template, template_item/status)` where repeated fanout is measurable;
- expense receipt idempotency by `(org, client_request_id)` and sheet-line lookup via existing index;
- helpdesk team membership by `(org, team, identity)` and ticket work queues by actual assignee/state/SLA shape;
- payment preferred clearing-account discovery using bounded posted/open partner-move access rather than broad account-move scans;
- replenishment supplier/demand discovery and post-create rediscovery elimination.

Prefer returning authoritative created row/ID from internal create operations over scanning human-readable `name`, `origin`, or `partner_ref` fields after mutation.

### 4.6 Provider callbacks, documents, presence, IoT and long-tail modules

Treat these as workload-dependent candidates:

- CRM provider event receipt by `(org, provider_account, provider_event_id)`;
- provider message identity by `(org, provider_message_id)` where required;
- document / CRM / proposal presence identities by resource + user/session;
- AI chat/agent/skill session/status/version paths;
- core messaging queues and status/time windows;
- pricelist/CPQ resolution;
- IoT actions/alerts/integration event paths;
- HR skills/contracts, UTM and regional-document reducers.

Do not prioritize future/low-volume modules ahead of current production traffic unless the census discovers an obviously pathological access path.

### 4.7 Maintenance scans remain scans unless bounded/checkpointed work is needed

Examples include:

- retention purge;
- integrity/audit sweeps;
- migrations/import rollback;
- workflow topology traversal with bounded workflow-version cardinality.

Use `batch-checkpoint-required` when table growth makes a single maintenance transaction risky. Do not create hot projections merely to eliminate legitimate maintenance scans.

---

## 5. IR pickup requirements

Use one access-contract system for every batch.

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

Projection candidates use `ProjectionDescriptor` and declare:

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

## 6. Final remaining investigation gate — Wave 4 exhaustive reducer census

After Waves 1–3 findings are recorded and implementation batches are underway/green, run one final exhaustive census over **every `#[spacetimedb::reducer]` / `#[reducer]` in the STDB module**.

This is the last investigation gate. Do not declare the STDB access-path discovery phase complete before it passes.

### 6.1 Census record per reducer

Produce a machine-readable inventory with at least:

```text
reducer_name
module/domain
interactive | worker | scheduled | maintenance | migration
input scope (org/company/user/resource)
tables read
tables written
accessors/indexes used
full-table iterators used
in-memory filters/finds/sorts/aggregations
expected cardinality per read
idempotency/replay path
subscription/frontend consumer if known
IR operation mapping if any
projection dependency if any
classification
recommended action
benchmark required? yes/no
```

### 6.2 Allowed classifications

Every reducer read path must land in one of:

```text
point-lookup
bounded-fanout
bounded-page
hot-projection
intentional-scan
batch-checkpoint-required
postgres-history
missing-index
existing-index-unused
wrong-index-definition
missing-idempotency-path
post-write-rediscovery
unclassified
```

`unclassified` is allowed while the census is running but must be zero at exit.

### 6.3 Final long-tail modules explicitly included

The census must explicitly cover the reducer families not deeply inspected in Waves 1–3, including at minimum:

- AI chat / agents / skills;
- core messaging;
- CRM, proposal and document presence;
- sales pricelists / CPQ / remaining OMS extensions;
- HR contracts / skills and remaining HR modules;
- UTM / attribution;
- IoT actions / alerts / integrations;
- regional-document reducers;
- smaller reference/config/integration reducers;
- any newly added reducer since the previous wave scans.

### 6.4 Census validation

Generate/check totals so the inventory cannot silently omit reducers:

```text
source reducer count
= census reducer count
= classified reducer count
```

CI should fail if:

- a reducer exists in source but not the census/IR inventory;
- a reducer read path remains `unclassified`;
- an interactive path performs a new broad iterator without an explicit intentional classification;
- an IR operation references an access path absent from the STDB schema contract;
- a declared projection has no maintainer/rebuild ownership.

Prefer generating the census skeleton from source/schema metadata rather than maintaining the reducer-name list manually.

### 6.5 Wave 4 output

The final census should produce:

1. a complete reducer inventory artifact;
2. a short residual remediation list containing only unresolved candidates;
3. explicit intentional-scan/batch exceptions;
4. an IR coverage report;
5. a count of indexes/projections proposed, accepted, rejected and benchmark-deferred;
6. a `0 unclassified reducers` assertion.

No new broad exploratory wave follows Wave 4. Anything discovered after this point becomes a normal benchmark/regression-driven performance issue, not another architecture investigation phase.

---

## 7. Explicit non-goals

Do not use this program to:

- mass-add every candidate index;
- materialize every proposed projection;
- move business logic/formulas from reducers into codegen;
- optimize intentional audit/migration scans as if they were interactive reads;
- remove single-column indexes without proving composite left-prefix coverage;
- move historical/reporting authority back from Postgres into STDB;
- introduce Redis/Qdrant/cache infrastructure as a substitute for fixing access paths;
- broaden the first batch while its benchmark/regression gates are still failing;
- keep opening investigation waves after the exhaustive census has closed the inventory.

---

## 8. Final exit criteria

The STDB access-path investigation and pickup program is complete only when:

1. first-batch Queue/IR/index proof and regression gates are green;
2. useful Wave 2 candidates are implemented or explicitly rejected/deferred with evidence;
3. cross-cutting Wave 3 findings (especially auth/membership, index misuse, StockQuant identity and forms/EAV) are dispositioned;
4. interactive one/few-row STDB paths have compatible declared access paths;
5. intentional broad scans are explicitly classified;
6. project and any accepted hot projections are represented in IR with rebuild ownership;
7. workflow, AI draft, subscription usage, inventory, purchasing, CRM and other benchmark-backed hot paths are bounded;
8. Postgres remains durable history/reporting authority;
9. index RAM/write cost remains visible in capacity planning for the 16/32 GB Scaleway targets;
10. the Wave 4 reducer census count matches the source reducer count;
11. every reducer/read path has a classification and **`unclassified = 0`**;
12. all remaining unresolved findings are converted into ordinary benchmark/regression backlog items rather than another investigation wave.
