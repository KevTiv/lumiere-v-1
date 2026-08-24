# STDB write contention, transaction, view, and fanout performance plan

**Status:** Proposed — 2026-08-24  
**Tracks:** `spacetimedb`, `reducers`, `transactions`, `contention`, `write-amplification`, `views`, `subscriptions`, `performance`, `application-contract-ir`, `codegen-validation`  
**Extends:** [stdb-index-access-path-optimization-plan.md](./stdb-index-access-path-optimization-plan.md) · [stdb-access-path-post-batch-pickup.md](./stdb-access-path-post-batch-pickup.md) · [subscription-query-ir-codegen-plan.md](./subscription-query-ir-codegen-plan.md) · [sliding-window-cold-tier.md](./sliding-window-cold-tier.md)

---

## 1. Purpose

The existing STDB performance program answers the first major question well:

> **How efficiently can a reducer/query/subscription locate the rows it needs?**

This plan adds the other half of the hot-path contract:

> **Once those rows are found, how much transactional work does the operation perform, which keys does it contend on, how much index/projection maintenance does it cause, and how much realtime/view work does the write trigger?**

Do not use this plan to move business logic away from SpacetimeDB reducers. The objective is the opposite: make the reducer model remain viable by preventing a small number of pathological write, contention, view, or fanout shapes from dominating cell capacity.

Target model:

```text
operation intent
    │
    ├── read profile
    │     access path
    │     cardinality
    │
    └── write profile
          rows/tables touched
          contention key
          index maintenance
          projection writes
          view/subscription fanout
          transaction class
                │
                ▼
        generated validation
                │
                ▼
        bounded STDB execution
```

The final performance contract must therefore cover five dimensions together:

```text
READ       access paths / cardinality
WRITE      transaction size / write amplification / contention
REALTIME   subscription + view fanout / reconnect cost
MEMORY     hot residency / indexes / row width / projections
DURABLE    PG cooling / partitioning / history access
```

---

## 2. Core decision

Keep reducers as the business-logic and transactional authority, but make their **cost shape explicit and reviewable**.

A reducer that uses perfect indexes can still be an expensive hot path if it:

- mutates hundreds or thousands of rows in one transaction;
- repeatedly writes one tenant-global counter/sequence row;
- updates many indexed columns on a high-write table;
- maintains several projections per mutation;
- causes broad views to be re-evaluated;
- changes rows observed by thousands of subscriptions;
- allocates/sorts/clones a large transient working set;
- performs background maintenance without a batch/checkpoint limit.

The codegen/IR program should be able to distinguish these cases from a normal one/few-row business mutation.

---

## 3. `OperationWriteProfile`

Extend operation metadata with a structural write-performance profile. This remains descriptive metadata; it does not encode business rules.

Illustrative shape:

```ts
interface OperationWriteProfile {
  operation: OperationKey

  expectedWrites:
    | "none"
    | "one"
    | "few"
    | "bounded-batch"
    | "large-batch"

  maxExpectedRows?: number
  tablesTouched: readonly ResourceKey[]

  contention?: {
    class:
      | "row-local"
      | "resource-key"
      | "tenant-hot-key"
      | "global-hot-key"
    keyFields?: readonly FieldKey[]
  }

  projectionWrites?: readonly ProjectionKey[]

  realtimeFanout:
    | "none"
    | "local"
    | "tenant-small"
    | "tenant-broad"
    | "cross-tenant-global"

  transactionClass:
    | "interactive-short"
    | "interactive-multirow"
    | "worker-batch"
    | "maintenance-batch"
    | "migration"

  batchLimit?: number
  checkpointRequired?: boolean
}
```

The exact type may be split between existing `OperationWriteSet`, operation descriptors, projection metadata, and subscription metadata. Do not create duplicate IR if the existing contract can carry these fields cleanly.

---

## 4. Transaction-length and row-touch budget

### 4.1 Interactive reducers

Interactive reducers should normally remain in one of:

```text
one row
few rows
bounded multi-row transaction
```

An interactive reducer must not silently become a bulk processor because tenant data grows.

Examples requiring explicit review:

```text
confirm order
→ header + bounded lines + bounded stock/accounting consequences

approve expense sheet
→ sheet + bounded expense lines

post invoice
→ move + bounded move lines + bounded projections
```

The contract does not need a universal hard-coded row count. It must, however, declare whether fanout is inherently bounded by the input object or may grow with unrelated tenant history.

### 4.2 Worker / scheduled / maintenance reducers

Large work should prefer:

```text
bounded batch
+ deterministic cursor/checkpoint
+ idempotent retry
```

over:

```text
scan entire organization
+ mutate everything
+ one giant transaction
```

Candidate domains:

- subscription rating/billing;
- retention/cooling;
- import and rollback;
- replenishment;
- reconciliation;
- workflow maintenance;
- scheduled reporting materialization;
- IoT cleanup/aggregation;
- migration/backfill.

Use the existing `batch-checkpoint-required` classification where applicable.

---

## 5. Hot-key contention

Access-path optimization does not solve two reducers competing to mutate the same logical key.

Inventory the main contention-key families explicitly.

Candidate examples to investigate:

```text
inventory
(org, company, product, location, lot/package/owner)

sequences / numbering
(org, company, sequence-kind)

queue claim/lease
(org, queue, status/time bucket)

subscription usage/billing accumulator
(org, subscription/current-period)

approval/workflow token
(org, workflow-instance/token)

partner balance/current operational projection
(org, company, partner)
```

For each high-frequency mutation ask:

1. Is contention naturally local to a resource key?
2. Is one tenant-global row acting as an accidental mutex?
3. Can a counter be derived/partitioned without weakening invariants?
4. Can work be sharded by natural business key while retaining one reducer boundary?
5. Is contention actually measurable enough to justify complexity?

Do not introduce distributed locks, Redis locks, or eventual business invariants merely to avoid measuring STDB contention first.

---

## 6. Index write amplification budget

The access-path program intentionally adds workload-shaped indexes. Every accepted index also increases mutation work and memory use.

For high-write tables, track:

```text
index count
indexed columns touched per common mutation
index memory
insert/update/delete rate
read consumers served
before/after reducer latency
```

Rules:

- every generated composite index should have at least one declared read/subscription/accessor consumer;
- avoid overlapping indexes when a proven left-prefix path covers the same consumer;
- do not remove a primitive index until its remaining consumers are accounted for;
- warn when a high-write resource accumulates many indexes;
- benchmark write-heavy resources before accepting an additional read optimization.

Representative high-write candidates include queue state, stock quant/move state, workflow tokens/tasks, usage events/charges, presence/telemetry, and operational integration-intent tables.

---

## 7. Write → projection amplification

Projection cost must be considered on the write path, not just the read path.

For every accepted `ProjectionDescriptor`, generated validation should know:

```text
source resource
maintainer operations
projection rows touched per source mutation
rebuild owner
subscription consumers
```

Flag cases where a frequent one-row mutation causes broad projection rewrites.

Preferred shape:

```text
source mutation
→ one/few deterministic projection keys
```

Suspicious shape:

```text
source mutation
→ rebuild organization-wide projection
→ broad subscription update
```

Projection promotion remains benchmark-driven. A projection that reduces reads but makes the dominant write path materially worse should be rejected or redesigned.

---

## 8. Reducer → subscription fanout contract

The subscription plan classifies result cardinality and realtime fanout. This plan connects that metadata back to reducer writes.

Model the relationship conceptually as:

```text
reducer
  ↓
resources/keys mutated
  ↓
views/subscriptions affected
  ↓
matching clients
  ↓
rows/events delivered
```

Add enough generated metadata/observability to answer:

- which subscription descriptors can react to this resource mutation;
- whether the mutation key remains within tenant/resource-local scope;
- whether one write can cause tenant-broad re-evaluation;
- whether a projection/view would reduce or increase the fanout cost;
- how initial hydration and reconnect storms interact with frequently-mutated resources.

A tiny reducer is not necessarily cheap if it updates a row watched by thousands of connections.

---

## 9. View performance and read-set census

Views are a separate performance surface from normal indexed reads and must be inventoried explicitly.

For each STDB view or view-like derived realtime source, record:

```text
view key/name
consumer resources/subscriptions
source tables
join keys
predicates
scope
read-set cardinality
expected output cardinality
mutation sources that trigger re-evaluation
compatible access paths/indexes
projection alternative? yes/no
classification
```

Allowed classifications:

```text
point-derived
bounded-fanout
bounded-join
small-reference-join
broad-read-set-intentional
projection-candidate
bff-only
unclassified
```

`unclassified` must be zero at the final gate.

### Join rules

For joins used in interactive/realtime paths:

- join keys need compatible declared indexes/access paths;
- tenant scope should constrain the join as early as possible;
- large many-to-many or organization-wide joins require explicit justification;
- small reference/config tables are acceptable when their cardinality is bounded and measured;
- repeated expensive joins may justify a maintained hot projection only after benchmark evidence.

Do not encode join business semantics into generic codegen merely to satisfy the performance contract.

---

## 10. Row width, serialization, and transient allocation

A hot row costs more than its logical field count suggests: wider rows increase STDB memory, index payload/key cost, subscription transfer, client cache usage, serialization work, and transient reducer allocations.

Inventory especially wide/high-frequency hot resources and flag:

- large text/json fields on operational rows;
- duplicated historical/blob-like payloads that should live in PG/Object Storage;
- reducers collecting large `Vec`s before filtering/sorting;
- repeated row clones in nested loops;
- large in-memory sorts where an ordered access path is available;
- subscriptions projecting fields never consumed by the client.

Do not split rows merely for theoretical normalization. Use measurement and concrete client/reducer consumers.

---

## 11. Runtime observability additions

Extend existing access-path metrics where feasible with:

```text
operation key
reducer duration p50/p95/p99
transaction class
rows read / rows written
resources/tables touched
projection rows written
contention/retry/conflict count where observable
alloc/transient bytes where practical
subscription/view descriptors affected
fanout client count / delivered row count where practical
batch size + checkpoint progress
```

At minimum, benchmark fixtures should capture before/after transaction duration and affected-row counts even where engine-internal metrics are unavailable.

The goal is to identify the limiting dimension:

```text
lookup CPU
transaction work
hot-key contention
index maintenance
view re-evaluation
subscription fanout
memory/row width
```

rather than treating all slow reducers as indexing problems.

---

## 12. Static validation / CI

### Fail candidates

Once the metadata is sufficiently complete, CI should fail for:

- interactive reducer classified `large-batch` without explicit approved exception;
- worker/maintenance reducer with unbounded growing work and no checkpoint/batch classification;
- projection source mutation missing projection dependency metadata;
- view/subscription read path using a join key with no compatible access path where one is required;
- `global-hot-key` on tenant business traffic without explicit architectural justification;
- operation write profile missing from a reducer included in the final performance census;
- broad view/realtime fanout left `unclassified`;
- generated index with no declared consumer after migration.

### Warning / benchmark-required candidates

Warn or require benchmark evidence for:

- high-write table gaining another composite index;
- `tenant-hot-key` on high-frequency operations;
- interactive reducer touching many rows/tables;
- one-row source mutation maintaining many projection rows;
- view with a broad source read set;
- mutation classified `tenant-broad` fanout;
- hot row whose serialized/projection width exceeds an agreed threshold;
- reducer collecting/sorting a dataset classified larger than `few` where an ordered path may exist.

Escapes must include a reason and preferably a benchmark/reference identifier.

---

## 13. Investigation / implementation phases

### WP-0 — write/view census extension

Extend the existing AP/Wave4 census skeleton. Do **not** create an unrelated reducer inventory.

For every reducer add:

```text
expected rows written
tables/resources written
transaction class
contention class + key if known
indexes maintained by touched columns
projection writes
subscription/view consumers affected
fanout class
batch/checkpoint contract
transient aggregation/sort notes
```

For every STDB view add the view census from §9.

Exit:

```text
source reducer count = write-profile reducer count
source view count    = classified view count
unclassified reducer write profiles = 0
unclassified views = 0
```

### WP-1 — high-frequency contention proof

Select a few representative hot write paths rather than optimizing every module:

1. queue claim/enqueue;
2. StockQuant / stock reservation/update;
3. workflow/approval transition;
4. one accounting/sales posting flow;
5. subscription usage/rating if already production-critical.

Benchmark concurrent operations against the same key and against independent keys.

Goal: distinguish per-key contention from general reducer cost and avoid accidental tenant-global serialization.

### WP-2 — transaction/batch proof

Pick representative scheduled/maintenance work and enforce deterministic bounded batches + checkpoints where required.

Candidates:

- retention/cooling;
- subscription rating/billing backlog;
- import rollback;
- replenishment worker;
- reconciliation/backfill.

Prove retry/idempotency and no one-transaction growth with total tenant history.

### WP-3 — index write-cost validation

For Queue, Inventory, Workflow and another write-heavy domain:

- record baseline write latency;
- add accepted workload-shaped indexes;
- measure read improvement and write/index-memory cost;
- reject redundant or unjustified indexes;
- publish the tradeoff in benchmark artifacts.

### WP-4 — view/join census remediation

- inventory all current STDB views / view-like derived subscription sources;
- validate join access paths;
- identify broad read sets;
- benchmark high-frequency mutation re-evaluation;
- use projections only where measured cost justifies them;
- classify intentionally broad/private/BFF-only views.

### WP-5 — write→realtime fanout load proof

Extend subscription load tests so they are driven by representative reducers, not only subscription setup.

Test:

```text
100 clients
500 clients
1,000 clients
```

for at least:

- narrow resource-local mutation;
- tenant queue/status mutation;
- projection-backed mutation if applicable;
- one intentionally broader operational subscription.

Measure reducer latency, subscription update latency, delivered rows/events and reconnect interaction.

### WP-6 — final performance closure

Merge the write/view fields into the Wave4 final census gate.

The STDB performance investigation is not closed merely because all reducer **reads** are classified. Closure requires both:

```text
read path classified
AND
write/view/fanout profile classified
```

After this gate, new issues become ordinary benchmark/regression-driven performance work rather than another broad architecture investigation wave.

---

## 14. Final census extension

The final per-reducer record should now cover at least:

```text
reducer_name
module/domain
interactive | worker | scheduled | maintenance | migration
input scope

tables read
accessors/indexes used
full-table iterators
expected read cardinality
read classification

tables written
expected rows written
transaction class
contention class/key
index-maintenance exposure
projection dependencies/writes
subscription/view consumers
realtime fanout class
batch/checkpoint contract

in-memory filters/finds/sorts/aggregations
idempotency/replay path
IR operation mapping
benchmark required?
recommended action
```

This is one machine-readable performance inventory, not separate hand-maintained spreadsheets.

---

## 15. Exit criteria

This companion track is complete only when:

1. every reducer in the final census has a classified write/transaction profile in addition to its read profile;
2. high-frequency reducer contention is benchmarked for same-key and independent-key concurrency;
3. no interactive reducer silently scales transaction work with unrelated tenant history;
4. large worker/maintenance work is explicitly bounded/checkpointed or intentionally justified;
5. write-heavy index additions have measured read benefit and visible write/RAM cost;
6. accepted projections have bounded write-maintenance cost and do not create hidden broad rewrites;
7. every relevant STDB view/join source is classified and its join/access paths are validated;
8. subscription load tests include reducer-driven update fanout, not only initial subscription creation;
9. broad realtime/view fanout is explicit and benchmarked rather than accidental;
10. hot row width/transient allocation problems discovered by benchmarks are dispositioned;
11. the final performance census has `0 unclassified` read paths, write profiles, and views.

---

## 16. Architectural decision

Adopt the following extended performance rule for Lumière V1:

> **A hot STDB operation is considered bounded only when both its row-access work and its transactional downstream work are bounded or explicitly classified. Reducer performance therefore includes read cardinality, rows written, contention, index/projection maintenance, and view/subscription fanout.**

This complements the access-path rule without weakening the reducer-centric architecture. It makes the performance question complete enough that future scaling pressure can be addressed through cell sizing, tenant isolation, hot/cold residency, and workload-specific tuning before considering a change to the business-logic programming model.
