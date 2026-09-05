# STDB / PG / API call-path consistency plan

**Status:** Proposed — 2026-08-24 performance extension
**Tracks:** `stdb-query-boundary`, `contract-ir`, `codegen`, `durable-postgres`, `api-gateway`, `partitioning`, `access-paths`, `performance`
**Role:** the concrete, currently-executable slice of [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) §11 Phase 1, unblocked by the contracts extraction landing on this branch
**Related:** [contracts-extraction-execution-plan.md](./contracts-extraction-execution-plan.md) · [private-generated-contracts-repo.md](./private-generated-contracts-repo.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [sliding-window-cold-tier-phase0-mistakes.md](./sliding-window-cold-tier-phase0-mistakes.md) · [stdb-index-access-path-optimization-plan.md](./stdb-index-access-path-optimization-plan.md) · [stdb-access-path-post-batch-pickup.md](./stdb-access-path-post-batch-pickup.md)

---

## 1. Why now

`lumiere-contracts` v0.2.1 is pinned and consumed by both `api-server` and `crates/stdb-auth`. Generated bindings and the six manifests are now a *versioned dependency* rather than 3,000 in-tree files, and `make check-contracts-drift` catches divergence between the live module and the pinned tag.

That changes what is cheap. Before extraction, adding a generated artifact meant adding thousands of reviewed files to every PR. Now a new manifest is one JSON file in a released tag. The call-path inconsistencies below have all been "known but expensive"; the expense is gone.

This plan does **not** build the application-contract IR. It makes the existing STDB/PG/API call paths converge on single seams *shaped like* that IR, so Phase 1 of the cold-tier plan becomes a generation step rather than a rewrite. Its archive counts below are a historical 2026-08-24 snapshot; the current C5 policy has one active archive root, `pos_order`, while `audit_log` is `always_hot` with compatibility-only cold reads/migration.

The 2026-08-24 STDB access-path investigation adds one additional requirement to this convergence work:

> **The same application read intent that drives bounded STDB access must also drive partition-aware Postgres access-path generation and validation.**

This is additive. It does **not** reopen the durable-tier topology or partitioning decision. Partitioned durable Postgres remains part of the baseline design; the new work makes partitioning, composite indexes, pagination and projections align with declared application access patterns instead of evolving independently.

---

## 2. Measured current state

Counted on this branch (`vibe/sliding-window-cold-tier`), against pinned contracts `0.2.1`:

| Surface | Count | Where |
|---|---:|---|
| Reducers in the module | 1,312 | `lumiere-contracts` bindings, `*_reducer.rs` |
| Reducers reachable by name through `POST /v1/call/:reducer` | all 1,312 minus deny patterns | [http_app.rs:153](api-server/src/http_app.rs:153), [reducer_allowlist.rs](api-server/src/reducer_allowlist.rs) |
| `call_reducer` call sites in `api-server` | 73 across 23 files | routes + 6 workers + 2 drainers |
| Reducers with a declared cache-invalidation mapping | 70 | [reducer-stdb-invalidation.json](lumiere-codegen/reducer-stdb-invalidation.json) |
| Read resources in the hand-authored registry | 336 | [resource_registry.json](crates/stdb-auth/assets/resource_registry.json) |
| Read resources compiled through `ResourceReadPlan` | 1 (`pos_order`) | [pos_order_read.rs](api-server/src/cold_tier/pos_order_read.rs) |
| Hand-written read SQL builder | 2,149 lines | [query_exec.rs](api-server/src/query_exec.rs) |
| STDB→PG drainers | 2 (`audit_log`, `pos_order`) | `cold_tier/*_drainer.rs`, 919 lines |
| Active archive roots | 1 (`pos_order`; POS children inherit) | current C5 storage-policy subset |
| Hydration policies declared | 0 | `manifests/hydration-manifest.json` |
| Tables in the schema manifest | 458 | `manifests/lumiere-schema-manifest.json` |
| Reducers in the schema manifest | **0** | there is no reducer section |

The last row is the root cause of most of what follows: the generated schema IR describes *state* exhaustively and describes *commands* not at all. Every command-side decision — is this reducer callable, what are its arguments, which argument carries organization scope, what does it invalidate — is therefore hand-maintained, partial, or inferred at runtime.

A second gap now matters for Postgres performance: the typed durable read path can describe predicates/order/pagination, but there is no single generated contract that also states expected cardinality, latency class, partition-pruning expectation, and the physical access path that should support the query. That leaves room for a generated query to be logically correct but physically poor.

---

## 3. The five inconsistencies

### 3.1 Write path is stringly typed and org-scope is inferred

`StdbClient::call_reducer(&str, Value)` ([lib.rs:114](crates/stdb-client/src/lib.rs:114)) posts a positional JSON array. Nothing checks the name against the module, the arity, or the argument types; a renamed or reordered reducer parameter fails at runtime, in production, as an opaque STDB 400.

The generic endpoint is worse than the 73 in-tree call sites, because it is caller-driven:

```rust
} else if let Some(requested_org) = args.first().and_then(|v| v.as_u64()) {
    if requested_org != org_id {
        return Err(ApiError::Forbidden("organization scope mismatch for reducer call".into()));
    }
}
```
— [http_app.rs:192](api-server/src/http_app.rs:192)

Organization scoping is enforced **only** when `args[0]` happens to parse as a `u64`. A reducer whose first parameter is a string, an enum, a params struct, or absent silently skips the check entirely. This is not a hypothetical shape: reducers in the bindings take `organization_id` first *by convention*, and convention is what is being enforced here. The correct check requires knowing each reducer's parameter list — which is exactly what is not generated.

`blocked_reducer_reason` is a hand-written deny-pattern list, so the default posture for a newly added reducer is *exposed*.

### 3.2 Read path has two compilers, and the new one has one caller

- `execute_resource_query` ([query_exec.rs:611](api-server/src/query_exec.rs:611)) serves 336 registry resources by way of long `matches!` ladders over resource-name string literals, emitting STDB SQL directly. It has no cursor contract, no cold-tier awareness, and no shared predicate/ordering vocabulary.
- `ResourceReadPlan` + `compile_stdb_sql` / `compile_pg_sql` ([cold_tier/mod.rs:42](api-server/src/cold_tier/mod.rs:42)) is the typed, keyset-paginated, hot∪cold design — reached by exactly one resource. `audit_read.rs` predates it and stays hand-rolled by explicit choice.

Two compilers means every cold-tier promotion is a rewrite rather than a manifest entry, and the `sliding-window-cold-tier-phase0-mistakes.md` retro applies directly: the typed path's correctness is still carried almost entirely by its own unit tests.

### 3.3 Projection is per-table hand-written code

The historical audit and POS drainers implemented the same shape — read hot
tail, encode via codec manifest, upsert into PG, call a finalize reducer, and
advance a watermark — twice, divergently. The current archive manifest has
one active root (`pos_order`); `audit_log` remains a compatibility-only cold
read/migration surface and is not an active finalization candidate. The
manifest still carries everything a generic drainer needs for a coolable
candidate (`cold_table`, `finalize_reducer`, `mode`, `order_by`, `primary_key`,
`scope_columns`, `pg_ddl_file`).

### 3.4 Cache invalidation is 5% covered and fails open

70 of 1,312 reducers have an invalidation mapping. `stdbInvalidationFor(reducer)` returns an empty list for the other 1,242, so a successful mutation through `POST /api/call/:reducer` leaves the client's TanStack cache stale with no signal. Nothing detects that a new reducer arrived without a mapping.

### 3.5 Durable reads can be logically typed but physically unbounded

Partitioning alone does not guarantee responsive durable reads. A query may prune correctly but still scan too much inside a partition; conversely, a good composite index may still fan across too many partitions when the query contract carries no bounded partition expectation.

The durable compiler therefore needs enough structural intent to answer all of the following before emitting SQL:

```text
what tenant/company scope is required?
what equality predicates define the access path?
what trailing range/order is expected?
what cardinality is acceptable?
is this interactive, background, or analytical?
should this query touch one partition, a bounded range, or many partitions?
what cursor shape preserves keyset pagination?
which generated index is intended to support the query?
is the source a durable row, snapshot/projection, history stream, or semantic index?
```

Without this, Postgres can recreate the same class of problem found in STDB: an index exists but the generated query shape does not actually use it, or an interactive path degrades into a broad scan as data grows.

---

## 4. Target seams

One generated artifact unblocks three of the original four; one shared read-intent contract now aligns both STDB and Postgres physical access.

### 4.1 Reducer contract manifest (new codegen output)

Extend `lumiere-codegen/src/cold_tier/stdb_bindings_parse.rs` — which already walks the same bindings directory to build the schema IR — to emit `reducer-manifest.json` alongside the existing six:

```jsonc
{
  "version": 1,
  "reducers": [
    {
      "name": "accept_sale_order_quotation",
      "params": [
        { "name": "organization_id", "type": "U64", "scope": "organization" },
        { "name": "order_id",        "type": "U64" },
        { "name": "params",          "type": "Struct", "type_name": "AcceptSaleOrderQuotationParams" }
      ],
      "lifecycle": false,
      "exposure": "denied"
    }
  ]
}
```

`params` comes from the generated `*Args` struct, which is mechanical and already parsed for tables. `scope` is derived structurally (parameter named `organization_id` / `company_id` with an integer type), never guessed at runtime. `exposure` is the one hand-authored field, defaulting to `denied`, held in a small input file next to `reducer-stdb-invalidation.json` — so **new reducers are closed by default** and opening one is a reviewed diff.

This artifact stays structural. It carries no Casbin roles, no business validation, no risk/confirmation metadata — those belong to the capability IR in [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md), which can consume this manifest later rather than re-deriving it.

### 4.2 `ReducerCall` in `stdb-client`

`call_reducer(&str, Value)` becomes private; callers construct a checked call:

```rust
let call = ReducerCall::new("create_lead")?
    .arg("organization_id", org_id)?
    .arg("params", &params)?;
client.call(call).await?;
```

The manifest is compiled in from `lumiere_contracts::manifests::REDUCER_MANIFEST`, so a reducer rename fails the *build* of every call site, not the request. `post_call` resolves the scope parameter from the manifest instead of probing `args[0]`, and rejects any reducer whose `exposure` is not `session` — replacing the deny-pattern allowlist outright.

### 4.3 One read compiler

`execute_resource_query` produces a `ResourceReadPlan` rather than SQL. The registry becomes plan input (predicates, ordering, projection, scope columns) instead of a `matches!` ladder. Hot-only resources compile through `compile_stdb_sql` with no cold branch; promoting a resource to the cold tier becomes an `archive-manifest.json` entry plus a drainer registration, with no change to the read handler.

### 4.4 One drainer

A single `cold_tier::drainer` parameterized by an `ArchiveCandidate`, with
`pos_order` as the active registration. `audit_log` remains hot and its legacy
cold compatibility path must not be treated as an archive candidate.

### 4.5 Shared application read intent + durable physical access contract

Extend the read-plan vocabulary so application intent is described once and each storage backend derives its own physical implementation.

Conceptual contract:

```rust
pub enum ExpectedCardinality {
    One,
    Few,
    BoundedPage,
    Aggregate,
    HistoryScan,
}

pub enum LatencyClass {
    Interactive,
    Background,
    Analytical,
}

pub enum PartitionExpectation {
    Single,
    BoundedRange,
    MultiPartitionAnalytical,
}

pub enum DurableSourceClass {
    DurableRow,
    HotProjection,
    Snapshot,
    History,
    SemanticIndex,
}

pub struct OperationReadSet {
    pub resource: ResourceKey,
    pub equality: Vec<FieldKey>,
    pub range: Option<FieldKey>,
    pub ordering: Vec<OrderKey>,
    pub expected_cardinality: ExpectedCardinality,
    pub latency: LatencyClass,
    pub partition_expectation: Option<PartitionExpectation>,
    pub source_class: DurableSourceClass,
    pub access_path: Option<AccessPathKey>,
}
```

This stays structural. It does not encode business formulas, authorization policy, or raw database syntax.

The storage-specific compilers derive:

```text
OperationReadSet
        │
        ├── STDB compiler
        │     bounded accessor/index expectation
        │     subscription-compatible query shape
        │     hot projection selection
        │
        └── PG compiler
              partition pruning expectation
              workload-shaped composite index
              keyset cursor shape
              durable projection/history source
              bounded vs analytical execution class
```

The key rule is:

> **Partitioning remains baseline durable storage design; access-path metadata makes each partitioned query use the right tenant-leading composite index, cursor and bounded partition window.**

### 4.6 Generated durable access-path manifest

Add one generated durable-access artifact once the read-plan vocabulary is stable. It should be derived from application read intent plus archive/projection/schema metadata, not hand-authored as a second source of truth.

For each durable operation/resource, emit enough to validate:

```text
resource
scope columns
equality columns
range column
ordering + cursor tie-breaker
expected cardinality
latency class
partition key
partition expectation
source class
expected index/access-path id
projection/rebuild reference when applicable
```

The manifest should support CI validation and migration generation, while `ResourceReadPlan` remains the runtime typed query seam.

---

## 5. Invariants this plan must not break

Inherited from [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) §2, restated where this work could violate them:

1. No business rule moves into `api-server`, the manifests, or the generated crate. The reducer/read manifests describe *shape*, never *permission* — Casbin remains the sole authority (§2.6, §2.14).
2. Organization scope resolution remains server-derived. The manifest makes the scope parameter *knowable*; it never lets a caller name it (§2.20).
3. `exposure` defaults to `denied`. A generation step must never widen the reachable surface (§2.5).
4. No new hand-written read or projection path is added while the generic one is being built — otherwise this plan reproduces the problem it closes.
5. Generated artifacts stay generated-output-only; the hand-authored exposure/invalidation policy inputs live in `lumiere-v-1`, not in `lumiere-contracts` (contracts-extraction §2).
6. Every phase below ships with a caller. Per the Phase 0 retro, code with zero callers is not "done".
7. Postgres partitioning remains part of the durable-tier baseline. This extension may refine partition metadata and pruning checks, but must not demote partitioning to an optional future optimization.
8. Every generated durable index must map to at least one declared access-path consumer; do not mass-index every column.
9. Interactive durable queries must be tenant-scoped, bounded, keyset-paginated where paginated, and compatible with a declared partition-pruning expectation.
10. Projections are introduced only when measured read cost justifies them; business formulas remain handwritten/trusted.
11. Durable history/reporting remains PG authority; this performance work must not pull historical scans back into STDB.
12. Semantic retrieval remains derived/rebuildable and uses the same tenant/access-path discipline as other durable reads.

---

## 6. Phases

### Phase A — reducer contract manifest

- [ ] extract reducer name + ordered params + types in `stdb_bindings_parse.rs`, reusing the existing type parser;
- [ ] derive `scope` structurally; fail generation on a reducer with two organization-scope candidates;
- [ ] add `reducer-exposure.json` (hand-authored, `denied` default) next to `reducer-stdb-invalidation.json`;
- [ ] emit `manifests/reducer-manifest.json`; add it to `publish-contracts.sh`, `check-codegen`, and `check-contracts-drift`;
- [ ] expose it as `lumiere_contracts::manifests::REDUCER_MANIFEST`;
- [ ] publish `lumiere-contracts` v0.3.0 and bump the pin.

**Exit gate:** the manifest lists all 1,312 reducers, every entry's param list matches its generated `*Args` struct field-for-field, and drift CI fails if a reducer is added without regenerating.

### Phase B — typed write path

- [ ] add `ReducerCall` to `stdb-client`, validated against the compiled-in manifest;
- [ ] rewrite `post_call` to resolve exposure and scope from the manifest; delete `blocked_reducer_reason`'s pattern list;
- [ ] port all 73 call sites; make `call_reducer` private;
- [ ] populate `reducer-exposure.json` for exactly the reducers the frontend calls today — enumerated from the frontend, not assumed;
- [ ] add a CI lint rejecting reducer names as string literals outside the generated manifest.

**Exit gate:** no path reaches STDB with an unvalidated reducer name or arity; a reducer whose first parameter is not an organization id is either scope-checked correctly or rejected.

### Phase C — one read compiler

- [ ] give `ResourceReadPlan` the predicate/projection vocabulary `execute_resource_query` needs;
- [ ] add shared read-intent metadata: equality/range/order, expected cardinality and latency class;
- [ ] add durable-only partition expectation and source-class metadata without leaking PG syntax into application IR;
- [ ] port the registry to plan construction, domain by domain, starting with the domain the pos_order work already touched;
- [ ] keep `audit_read.rs` as-is until its bounded top-500 contract is intentionally replaced;
- [ ] adversarial tests first: empty `IN`, numeric-looking `Text`, mixed-direction multi-key cursors, quoted identifiers, unknown types;
- [ ] delete the `matches!` ladders as each domain lands.

**Exit gate:** every one of the 336 resources compiles through `ResourceReadPlan`; `query_exec.rs` contains no SQL string construction; durable-capable plans carry explicit cardinality/latency/partition expectations.

### Phase D — manifest-driven projection

- [ ] extract the shared drainer loop; register the reviewed `pos_order` root through it;
- [ ] prove equivalence against the current drainers on real data before deleting them;
- [ ] add a third candidate end-to-end as the actual test of genericity;
- [ ] extend projection metadata with key/source/maintainer/rebuild/access-path information where the application IR later adopts `ProjectionDescriptor`;
- [ ] keep projection formulas/business semantics out of codegen.

### Phase E — invalidation completeness

- [ ] make `reducer-stdb-invalidation.json` total: every non-lifecycle reducer maps to resources or to an explicit `[]` with a reason;
- [ ] fail codegen on an unmapped reducer;
- [ ] cross-check that every mapped resource name exists in the registry.

### Phase F — partition-aware durable access-path codegen

Pick this up once Phase C has one compiler and the first STDB access-path batch has validated the shared access-intent vocabulary.

- [ ] derive a `durable-access-path-manifest.json` from `ResourceReadPlan`/application read intent + schema/archive/projection metadata;
- [ ] preserve existing partitioning baseline and make each durable resource expose its partition key/strategy to the compiler;
- [ ] generate or validate tenant-leading workload-shaped composite indexes from concrete query consumers;
- [ ] require a deterministic cursor tie-breaker for every generated keyset page;
- [ ] reject large-history `OFFSET` pagination in generated durable paths;
- [ ] classify durable operations as `one`, `few`, `bounded-page`, `aggregate`, or `history-scan`;
- [ ] classify latency as `interactive`, `background`, or `analytical`;
- [ ] classify partition expectation as `single`, `bounded-range`, or `multi-partition-analytical`;
- [ ] make the PG compiler verify that interactive paths cannot silently compile into unbounded partition fan-out;
- [ ] detect "existing index unused" patterns where an index is generated/present but predicate ordering makes it unusable for the declared path;
- [ ] detect redundant generated indexes only after proving left-prefix/consumer coverage;
- [ ] require every generated durable index to cite at least one operation/resource consumer;
- [ ] emit benchmark fixtures for representative high-cardinality history tables;
- [ ] add semantic-index access-path metadata for tenant filters + FTS/vector/metadata filters without changing the pgvector dimension constraints in `postgres-semantic-index-plan.md`.

Representative target:

```text
partitioned durable history
        +
(org, company, business discriminator, time DESC, id DESC)
        +
keyset cursor
        +
explicit partition window
```

Example:

```text
usage history
partition key: occurred_at
access path: (org, subscription, status, occurred_at DESC, id DESC)
partition expectation: bounded-range
cardinality: bounded-page
latency: interactive
```

Phase F must not create an index merely because a field exists. It must be consumer-backed and benchmarkable.

### Phase G — durable query census and physical-plan gate

After Phase F proves the generator on a small representative set, run a census over every durable-capable `ResourceReadPlan`.

For each operation/resource record:

```text
resource
source class
scope columns
predicates
ordering
cursor
cardinality
latency class
partition key
partition expectation
expected access path/index
projection or history authority
benchmark/exception status
```

CI must fail on new durable-capable operations without a census/access-path classification.

Final gate:

```text
number of durable-capable read plans
=
number of durable access-path census entries
=
number classified as bounded/projection/history/analytical

unclassified = 0
```

This is the PG counterpart to the STDB reducer census. It closes discovery; later performance changes become normal benchmark/regression work rather than new exploratory architecture waves.

---

## 7. Required tests

1. reducer manifest params match the generated `*Args` structs for all 1,312 reducers;
2. a reducer absent from `reducer-exposure.json` is rejected by `post_call` in every mode, including local dev;
3. scope enforcement holds for a reducer whose first parameter is not a `u64`;
4. `ReducerCall` rejects wrong arity, unknown parameter names, and mismatched scalar kinds at compile time where possible and at construction otherwise;
5. org A cannot invoke a reducer scoped to org B through the generic endpoint;
6. every registry resource produces a valid `ResourceReadPlan` and compiles under both compilers;
7. plan compilation is adversarially tested (empty `IN`, mixed-direction cursors, identifier quoting, numeric-looking text keys);
8. the generic drainer reproduces both existing drainers' output byte-for-byte on a fixture;
9. codegen fails on an unmapped reducer and on an invalidation entry naming an unknown resource;
10. drift CI fails when the module gains a reducer and contracts are not republished;
11. every interactive durable plan contains server-derived tenant scope;
12. every paginated high-cardinality durable plan uses a deterministic keyset cursor rather than generated `OFFSET`;
13. a `single` or `bounded-range` partition expectation fails validation if the generated PG plan can fan across an unbounded partition set;
14. every generated durable index maps back to at least one declared consumer;
15. physical-access validation catches a deliberately mismatched predicate/index order fixture;
16. projection-backed reads reference a rebuildable projection contract and never make the projection canonical history authority;
17. a representative partitioned history table retains bounded p95/p99 behavior as fixture cardinality increases;
18. semantic durable plans preserve organization/resource filters before vector/FTS candidate retrieval;
19. durable census count equals durable-capable plan count and `unclassified = 0`.

---

## 8. Acceptance

- the schema manifest describes commands as completely as it describes state;
- no reducer is reachable from outside without a reviewed `exposure` entry;
- organization scope is resolved from generated metadata, never inferred from argument position;
- one read compiler, one drainer, one write seam;
- `query_exec.rs` and the two drainers are materially smaller or gone;
- the capability IR in `agent-ir-codegen-extension-plan.md` can be built by *annotating* these manifests rather than re-deriving them from bindings;
- Postgres partitioning remains a first-class durable-tier baseline, not a deferred optimization;
- durable queries derive partition pruning, composite indexes and keyset cursors from declared application access intent;
- interactive PG reads cannot silently degrade into unbounded history/partition scans;
- indexes are consumer-backed and validated against generated query shapes;
- projection promotion remains evidence-driven and rebuildable;
- every durable-capable read plan is represented in the durable query census with zero unclassified operations;
- STDB and PG share one access-intent philosophy while retaining storage-specific physical implementations.

---

## 9. Out of scope

- the full application-contract IR, generated hooks/services, and the private npm package (Phase 1 of the cold-tier plan proper);
- capability/risk/confirmation/traffic metadata and the harness tool registry;
- analysis shaping;
- organization placement/lifecycle (Phase 0 of the cold-tier plan);
- moving the `exposure` or invalidation inputs into `lumiere-contracts`;
- changing the already-selected durable Postgres partitioning baseline into an optional future feature;
- moving ERP business formulas into generated SQL/projection code;
- creating indexes without concrete consumers;
- replacing PostgreSQL with a specialized analytical/vector service without measured need;
- any new cold-tier candidate beyond the one Phase D uses as its genericity proof unless selected later by benchmark evidence.
