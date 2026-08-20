# STDB-owned transactional core with durable Postgres projection

**Status:** Proposed — production-contract alignment 2026-08-20
**Tracks:** `organization-placement`, `contract-ir`, `generated-client-sdk`, `contract-migration`, `durable-postgres`, `tenant-onboarding`, `stdb-query-boundary`, `traffic-resilience`
**Related:** [regional-stdb-scaleway-durable-foundation.md](./regional-stdb-scaleway-durable-foundation.md) · [audit-log-cold-by-default.md](./audit-log-cold-by-default.md) · [backup-recovery-followup.md](./backup-recovery-followup.md) · [offline-changeset-sync.md](./offline-changeset-sync.md) · [audit-auth-operation-context-plan.md](./audit-auth-operation-context-plan.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Decision

Keep SpacetimeDB as Lumiere's single business-logic and application-query authority. Postgres is a durable per-organization projection and historical store. Frontend/runtime callers consume generated typed application contracts rather than raw reducer names, positional payloads, transport URLs, handwritten cache keys, or locally duplicated generated types.

Before extending the durable or client contract paths, establish a canonical organization placement/lifecycle foundation. All later routing, durable-store selection, reactivation, regional STDB placement, migration, and recovery decisions must resolve through that single server-controlled tenant boundary.

The long-term deployment direction is one authoritative STDB execution cell per organization at a time, with Scaleway Postgres as the durable convergence/recovery layer. The current branch only lays the metadata/recovery foundation; it does not implement multi-region STDB or active-active replication.

Traffic resilience is part of the contract boundary as well: generated operations carry structural traffic classification so Kong and application admission control can apply bounded, server-authoritative rate/concurrency/retry policy without moving business logic into the gateway.

```text
frontend / client
      │
      ▼
private generated npm SDK
      │
      ▼
Kong + server admission boundary
      │
      ▼
OrganizationPlacementResolver
      │
      ▼
SpacetimeDB execution cell
      ├── reducers own mutations + business invariants
      ├── views/subscriptions own active read models
      └── ordered durable change/audit emission
                    │
                    ▼
          organization durable gateway
                    │
                    ▼
        Scaleway Postgres durable store
```

Reducers cannot perform network I/O. Durable reads therefore use an STDB procedure that resolves an already-authorized and bounded durable query contract inside STDB, closes the transaction, performs the durable fetch, and returns or hydrates the result through a fresh STDB transaction where required.

Initial production remains one logical execution cell + one STDB deployment + one Postgres database. The organization-placement model keeps later regional execution and migration possible without expanding this branch into a distributed-database project.

---

## 2. Non-negotiable invariants

1. **SpacetimeDB owns all business rules and state transitions.** Reducers remain the only implementation of state-changing business commands.
2. **One authoritative STDB execution cell owns an organization at a time.** Active-active STDB reconciliation is not assumed.
3. **Organization lifecycle, execution cell, placement generation, and durable-store placement are server-controlled runtime state.**
4. **Placement generation fences stale cells/routes during future migration/reactivation.**
5. **Generated contracts contain structural/application metadata, never business policy.**
6. **Frontend application code consumes stable named operations instead of raw reducer names, resource URLs, positional argument arrays, or raw STDB binding details.**
7. **Migration scripts are generated/manifest-driven and idempotent.**
8. **Legacy transport/type APIs are temporary compatibility surfaces and are deleted after migration.**
9. **Postgres is durable convergence/history/recovery storage, not a second business engine.**
10. **The api-server/durable gateway does not independently compile business/resource policy.**
11. **STDB resolves organization/company scope, field policy, resource predicates, ordering, pagination, and hydration decisions before durable I/O.**
12. **Procedures are transport/orchestration only and must reuse STDB-owned business/query-policy logic.**
13. **No row leaves STDB until its exact durable version is verified on the resolved PG store.**
14. **Durable business transitions have a monotonic per-organization commit sequence and measurable PG durability watermark.**
15. **Audit explains who/why; canonical change records reconstruct what; snapshots bound replay cost.**
16. **All security-sensitive audit/admission identity is server-derived, never client-authored.**
17. **Every external operation has bounded rate, payload, timeout, and downstream concurrency policy.**
18. **Overload fails fast and locally through 429/503 shedding rather than cascading into STDB/PG/workers.**
19. **Mutation retries require explicit idempotency semantics; retries must not be amplified across client/gateway/service layers.**
20. **SQLite/offline clients queue intent and working sets; reconnect still crosses the STDB reducer boundary.**

---

## 3. Ownership model

```text
Organization placement/lifecycle
────────────────────────────
organization_id
logical cell_id
placement_generation
lifecycle
logical durable_store
server-controlled routing

Schema IR
────────────────────────────
tables / columns / keys
organization scope
wire + durable codecs
PG projection metadata

Application-contract IR
────────────────────────────
stable operation names
typed inputs / outputs
query | command | subscription
cache tags / invalidation
traffic class / idempotency metadata
no business policy

              │ generates
              ▼

Private contract artifacts
────────────────────────────
Rust contract crate
private npm package

              │ calls
              ▼

Kong + admission control
────────────────────────────
request bounds / rate limits
server-derived actor/org budgets
concurrency pools / load shedding

              │ resolve placement
              ▼

SpacetimeDB execution cell
────────────────────────────
reducers / views / procedures
business rules and authorization
ordered org commit/change stream

              │ asynchronous durable convergence
              ▼

Durable gateway → Scaleway PG
────────────────────────────
history / snapshots
migration + reactivation source
recovery manifests
PG backup / PITR / replication
```

The private package/crate repositories are distribution artifacts for generated output. `lumiere-v-1` continues to own STDB business logic and the code-generation implementation.

---

## 4. Canonical organization placement

The durable-store-only `TenantPlacement` concept is superseded by one canonical runtime record:

```rust
pub struct OrganizationPlacement {
    pub organization_id: OrganizationId,
    pub cell_id: CellId,
    pub generation: PlacementGeneration,
    pub lifecycle: OrganizationLifecycle,
    pub durable_store: DurableStoreId,
}
```

Suggested lifecycle:

```rust
pub enum OrganizationLifecycle {
    Provisioning,
    Active,
    GracePeriod,
    Suspended,
    Archived,
    Reactivating,
}
```

A single trusted resolver owns routing:

```rust
pub trait OrganizationPlacementResolver {
    fn resolve(&self, organization_id: OrganizationId) -> Result<ResolvedOrganizationPlacement>;
}
```

Initial deployment may map every organization to `cell-primary-eu` and `pg-primary`. Callers never supply cell/store/generation values.

---

## 5. STDB-owned durable query contract

A durable plan is produced only after STDB-owned policy resolution. The durable gateway resolves the organization's durable store from canonical placement; it never accepts a caller-selected PG target.

```text
client generated query
        ↓
Kong / admission policy
        ↓
placement-resolved STDB procedure
        ↓
STDB transaction: auth + bounded durable plan
        ↓ transaction closes
procedure HTTP → durable gateway
        ↓
OrganizationPlacementResolver
        ↓
Scaleway PG durable store
```

No application endpoint may expose arbitrary PG SQL/resource querying for durable data.

---

## 6. Durable mutation / rehydration

A durable-only mutable row becomes hot before ordinary reducer logic proceeds:

```text
client generated command
      ↓
resolved STDB execution cell
      ↓
with_tx: authorize + determine hydration requirement
      ↓
fetch durable row from placement-resolved PG
      ↓
with_tx
  validate org + generation + version + payload
  hydrate idempotently
  invoke existing reducer logic
```

Reducers never learn about PG connections, cells, shards, or physical placement.

---

## 7. Ordered durable convergence and replay foundation

Every durable business transition should carry a monotonic sequence scoped by organization + placement generation:

```rust
pub struct OrgCommitSequence(pub u64);
```

PG should enforce uniqueness/order such as:

```text
UNIQUE (organization_id, placement_generation, commit_sequence)
```

Track a durability watermark:

```rust
pub struct DurableWatermark {
    pub organization_id: OrganizationId,
    pub generation: PlacementGeneration,
    pub execution_head: OrgCommitSequence,
    pub durable_head: OrgCommitSequence,
}
```

This makes asynchronous STDB → PG durability observable without making normal reducer completion wait on a Europe round trip.

Canonical change records remain separate from durable audit metadata and contain enough versioned information to reconstruct state from a verified snapshot. Snapshot manifests bind organization, generation, commit sequence, schema/contract versions, and a state hash.

See `regional-stdb-scaleway-durable-foundation.md` for the exact future-proofing model.

---

## 8. Migration and reactivation foundation

Future movement/reactivation must be generation-fenced:

```text
current generation N
      ↓
checkpoint / durable watermark
      ↓
materialize + migrate/backfill
      ↓
verify hashes/counts/invariants
      ↓
target generation N+1
      ↓
placement flip
      ↓
old generation fenced
```

Suspension/archival never means destructive deletion. Reactivation uses durable snapshots/change history plus explicit schema/contract migration metadata, then hydrates the required active working set into the selected STDB execution cell.

---

## 9. IR, codegen, and private packages

The existing schema IR/application-contract IR split remains. IR identifies organization scope and operation semantics, but physical cell/PG topology remains runtime placement state.

Generated application operations may carry traffic/idempotency/migration metadata, while placement resolution, business policy, and authorization stay outside generated packages.

Package publication and frontend codemod migration remain one workflow; legacy raw hooks/types/transports are removed after generated contract adoption.

---

## 10. Implementation phases

### Phase 0 — organization placement, lifecycle, and recovery foundation

- [ ] define `OrganizationLifecycle`;
- [ ] define logical `CellId` and `PlacementGeneration`;
- [ ] define canonical `OrganizationPlacement`;
- [ ] create one trusted `OrganizationPlacementResolver`;
- [ ] map current organizations to one initial logical cell + PG store without changing deployment topology;
- [ ] make onboarding create placement/lifecycle metadata server-side;
- [ ] define generation fencing semantics;
- [ ] define `OrgCommitSequence` and `DurableWatermark`;
- [ ] define canonical reducer change-record schema separate from audit metadata;
- [ ] define organization snapshot manifest;
- [ ] define reactivation manifest/migration references;
- [ ] make durable gateway resolve PG through canonical placement;
- [ ] add tests preventing caller-selected cell/generation/store;
- [ ] preserve one-STDB/one-PG operation without feature-level special cases.

**Exit gate:** all tenant-aware infrastructure routes through one canonical organization placement/lifecycle model, and durable/audit metadata can later support ordered reconstruction without implementing multi-region STDB today.

### Phase 1 — production contract/IR boundary

- [ ] split structural schema IR from caller-facing application-contract IR;
- [ ] define stable named operations and generated services/hooks;
- [ ] centralize serialization/auth/error/retry semantics;
- [ ] add traffic-class/idempotency metadata;
- [ ] publish private npm/crate artifacts;
- [ ] migrate Sales as representative domain;
- [ ] add codegen drift tests.

### Phase 1.5 — generated contract adoption and legacy transport removal

- [ ] run manifest-driven idempotent codemods;
- [ ] migrate generic query/reducer hooks and raw transport usage;
- [ ] enforce `migrate:contracts:check` and CI deny-list;
- [ ] delete superseded hooks/types/transports after verification.

### Phase 2 — tenant-aware durable gateway

- [ ] consume `OrganizationPlacementResolver` rather than a separate durable-store-only resolver;
- [ ] reject unknown/unplaced or stale-generation organization context;
- [ ] resolve logical durable store internally;
- [ ] tenant-isolation tests.

### Phase 3 — prove durable read

Use `audit_log` first:

- [ ] STDB procedure authorizes bounded historical query;
- [ ] gateway executes generated contract against placement-resolved PG;
- [ ] expose through generated SDK;
- [ ] enforce pagination/time/result/admission bounds.

### Phase 4 — prove mutable rehydration

- [ ] determine hydration need in STDB;
- [ ] fetch from placement-resolved PG;
- [ ] validate organization/generation/version;
- [ ] hydrate idempotently;
- [ ] invoke existing reducer;
- [ ] explicit retry/idempotency semantics.

### Phase 5 — optional second logical cell/store correctness proof

- [ ] configure a second logical cell and/or PG store for tests;
- [ ] move one test organization using checkpoint → verify → generation increment → placement flip;
- [ ] prove stale generation is fenced;
- [ ] prove no cross-org/cross-store leakage.

This is a correctness proof, not an autoscaling or active-active project.

---

## 11. Explicitly out of scope

- active-active STDB across regions;
- automatic STDB tenant sharding;
- automatic African cell placement;
- automatic live cell migration;
- Kubernetes topology;
- PG read replicas/topology implementation;
- automatic PG shard balancing;
- distributed query federation;
- self-hosted disconnected cell packaging;
- full replay engine implementation;
- payment-provider implementations;
- moving business logic into Postgres, the api-server, Kong, or generated packages.

---

## 12. Required tests

At minimum:

1. callers cannot select execution cell, placement generation, or durable store;
2. onboarding creates server-derived placement/lifecycle state;
3. stale placement generations are rejected by migration/routing-sensitive flows;
4. one-STDB/one-PG deployment remains the default/simple path;
5. durable records are ordered by organization + generation + commit sequence;
6. durability watermark detects gaps/lag;
7. audit and canonical change records share operation identifiers but remain separate schemas;
8. snapshot manifests bind an exact reconstructable durable point;
9. application-contract IR exposes only explicitly approved STDB operations;
10. generated hooks/services resolve stable operations without raw reducer/resource paths;
11. burst/reconnect/refetch storms remain bounded;
12. durable gateway cannot accept caller-selected PG stores;
13. org A cannot query org B durable data;
14. no external HTTP call occurs while an STDB transaction is held open;
15. hydration rejects organization/generation/version mismatch;
16. overload returns bounded 429/503 outcomes;
17. mutation retries are never transparently amplified across layers.

---

## 13. Acceptance criteria

This branch is complete when:

- SpacetimeDB remains the only business-logic boundary;
- every organization has canonical server-controlled lifecycle + placement metadata;
- initial production still runs one logical cell + one STDB + one PG;
- future regional STDB placement is a routing/runtime concern rather than an application rewrite;
- Scaleway PG can serve as the durable convergence/history/recovery layer;
- durable transitions can be ordered and measured through commit sequence/watermark metadata;
- audit explains actor/context while canonical changes + snapshots enable future reconstruction;
- dormant organizations retain versioned data/migration metadata sufficient for later reactivation;
- generated contracts/private packages remain the stable frontend boundary;
- Kong/admission policy bounds load before STDB/PG/workers saturate;
- broader multi-region, PG replication topology, active-active STDB, and payment-provider implementation remain deferred.
