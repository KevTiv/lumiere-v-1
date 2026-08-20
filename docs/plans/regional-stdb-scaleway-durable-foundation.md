# Regional SpacetimeDB + Scaleway durable foundation

**Status:** Proposed — future-proofing constraints
**Tracks:** `organization-placement`, `regional-stdb`, `scaleway-postgres`, `recovery`, `reactivation`, `audit-replay`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [audit-auth-operation-context-plan.md](./audit-auth-operation-context-plan.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Objective

Shape the current architecture so later deployment of SpacetimeDB execution cells in multiple locations becomes a placement and recovery problem rather than a redesign of application semantics.

The intended long-term model is:

```text
                         Lumiere control plane
                          + Scaleway durable PG
                                   │
                    durable convergence / recovery
                                   │
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
    West Africa STDB        East Africa STDB         local/edge STDB
       execution cell          execution cell           execution cell
           │                       │                       │
      web / Expo               web / Expo               site clients
           │                       │
        SQLite                  SQLite
```

The branch does **not** implement active-active SpacetimeDB replication or multi-region deployment. It establishes the data/placement/recovery contracts that make those later steps feasible.

---

## 2. Core decisions

1. **One authoritative STDB execution cell per organization at a time.** Do not require arbitrary active-active reconciliation between STDB instances.
2. **Scaleway Postgres is the durable convergence, historical, migration, and recovery layer.** Regional STDB cells optimize execution latency and realtime behavior.
3. **Device SQLite remains an offline working-set / queued-intent store, not business authority.**
4. **Organization placement is logical and generation-fenced.** Physical hosts/endpoints remain runtime configuration.
5. **STDB → PG durability is asynchronous and ordered.** User-visible reducer completion must not normally wait on a Europe round trip.
6. **Recovery guarantees use snapshots + canonical change records.** Semantic reducer replay is optional validation/debug tooling, not the sole recovery mechanism.
7. **Regional scaling is per-organization placement, not distributed query federation.**

---

## 3. Organization placement foundation

Introduce a canonical runtime placement record:

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

Rules:

- clients never select `cell_id`, `generation`, or `durable_store`;
- trusted routing resolves placement server-side;
- initial production may map all organizations to `cell-primary-eu` + `pg-primary`;
- moving an organization increments `generation`;
- stale cells/requests from an older generation are rejected/fenced;
- lifecycle state does not imply destructive deletion.

---

## 4. Execution vs durability responsibilities

### Regional SpacetimeDB cell

Owns:

- reducers and business invariants;
- active transactional state;
- realtime subscriptions;
- active workflow execution;
- local admission/concurrency control;
- ordered change/audit emission;
- local integration outbox/inbox state where applicable.

### Scaleway Postgres

Owns:

- durable organization history/projections;
- canonical archived state;
- recovery snapshots/manifests;
- migration/backfill sources;
- reactivation sources;
- durable replay/change stream storage;
- conventional PG backup/PITR/replication strategy.

Do not make ordinary reducer latency depend on synchronous Scaleway PG confirmation.

---

## 5. Ordered per-organization durability stream

Every durable business transition should be associated with a monotonic per-organization commit sequence:

```rust
pub struct OrgCommitSequence(pub u64);
```

Durable storage should enforce uniqueness/order:

```text
UNIQUE (organization_id, placement_generation, commit_sequence)
```

This gives the system a measurable durability watermark:

```text
STDB head       = 10842
PG durable head = 10839
lag             = 3 commits
```

Track at minimum:

```rust
pub struct DurableWatermark {
    pub organization_id: OrganizationId,
    pub generation: PlacementGeneration,
    pub execution_head: OrgCommitSequence,
    pub durable_head: OrgCommitSequence,
}
```

Operational policy may classify lag as healthy/degraded/critical without changing business truth.

---

## 6. Canonical change records

Keep durable audit evidence and reconstructable state changes related but separate.

Audit answers **who/why**. Change records reconstruct **what**.

```rust
pub struct ReducerChangeRecord {
    pub organization_id: OrganizationId,
    pub generation: PlacementGeneration,
    pub commit_sequence: OrgCommitSequence,

    pub operation_id: OperationId,
    pub correlation_id: CorrelationId,
    pub contract_operation: OperationName,

    pub entity_type: ResourceKey,
    pub entity_id: EntityId,
    pub previous_version: Option<u64>,
    pub new_version: Option<u64>,

    pub before_hash: Option<Hash>,
    pub after_hash: Option<Hash>,
    pub input_hash: Hash,
    pub change: CanonicalChangeSet,

    pub module_version: ModuleVersion,
    pub schema_version: SchemaVersion,
    pub contract_version: ContractVersion,
}
```

Canonical changes should be deterministic and schema-versioned.

Do not rely only on timestamps for ordering.

---

## 7. Snapshot manifests

Bound recovery/replay cost with periodic verified organization snapshots:

```rust
pub struct OrganizationSnapshotManifest {
    pub organization_id: OrganizationId,
    pub generation: PlacementGeneration,
    pub commit_sequence: OrgCommitSequence,
    pub schema_version: SchemaVersion,
    pub contract_version: ContractVersion,
    pub state_hash: Hash,
    pub created_at: Timestamp,
}
```

Recovery becomes:

```text
latest verified snapshot @ 10,000
        +
ordered changes 10,001..10,842
        ↓
reconstructed organization state
        ↓
hash/invariant verification
        ↓
new STDB cell / placement generation
```

Snapshot creation and replay verification should be idempotent.

---

## 8. Migration and cell move protocol

Future organization movement should follow a deterministic fenced workflow:

```text
current cell generation N
        ↓
quiesce/checkpoint or establish safe cut
        ↓
wait/verify durable watermark
        ↓
materialize target snapshot/state
        ↓
validate hashes/counts/invariants
        ↓
start target cell
        ↓
generation N+1
        ↓
placement flip
        ↓
old generation fenced
```

Do not introduce automatic live migration in the current branch. Define the metadata and proof points only.

---

## 9. Dormant organization reactivation

Suspension must preserve recoverability.

```text
Active
  ↓
GracePeriod
  ↓
Suspended
  ↓
Archived
  ↓
Reactivating
  ↓
Active
```

Reactivation should use a versioned manifest:

```rust
pub struct ReactivationManifest {
    pub organization_id: OrganizationId,
    pub source_generation: PlacementGeneration,
    pub target_generation: PlacementGeneration,
    pub source_schema_version: SchemaVersion,
    pub target_schema_version: SchemaVersion,
    pub snapshot_sequence: OrgCommitSequence,
    pub migration_plan: MigrationPlanId,
}
```

Workflow:

```text
resolve latest durable organization state
      ↓
select target cell
      ↓
apply schema/data migrations + backfills
      ↓
verify invariants
      ↓
hydrate required active working set
      ↓
activate new placement generation
```

This supports organizations returning after long periods without requiring historical application binaries to remain the primary recovery mechanism.

---

## 10. SQLite/offline boundary

Expo/device SQLite may store:

- subscribed working sets;
- drafts;
- offline proposed commands/changesets;
- local search/indexes;
- sync checkpoints;
- attachment/job metadata.

It must not establish authoritative business state independently.

```text
device SQLite
    ↓ reconnect / review
regional STDB reducer boundary
    ↓
ordered durable stream
    ↓
Scaleway PG
```

Offline operations are re-authorized against current server state when applied.

---

## 11. External integrations foundation

Future MoMo, M-Pesa, Orange Money, Airtel Money, banks, tax systems, email/SMS, and similar integrations should fit the same cell model through inbox/outbox boundaries.

```text
STDB reducer
   ↓
transactional integration outbox
   ↓
provider worker
   ↓
external provider

external callback
   ↓
authenticated/deduplicated provider inbox
   ↓
STDB command/reducer
```

Regional/control-plane connectivity loss may delay external side effects without corrupting local business state.

Provider adapters never become accounting/business authority.

---

## 12. Initial implementation constraints

The current production shape may remain deliberately simple:

```text
one logical execution cell
one STDB deployment
one Scaleway PG durable store
```

But code written in this branch should not assume:

- a globally fixed STDB endpoint;
- all organizations share one permanent execution location;
- durable PG and active STDB are co-located;
- organization data can be deleted on subscription lapse;
- timestamps alone can reconstruct ordering;
- current application code version will always be available for recovery;
- client SQLite can bypass reducers on reconnect.

---

## 13. Phase 0 foundation tasks

- [ ] define `OrganizationLifecycle`;
- [ ] define logical `CellId` and `PlacementGeneration`;
- [ ] replace durable-store-only placement thinking with canonical `OrganizationPlacement`;
- [ ] create one trusted `OrganizationPlacementResolver` boundary;
- [ ] map all current organizations to one initial logical cell without changing deployment topology;
- [ ] define generation fencing semantics;
- [ ] define `OrgCommitSequence` and durability watermark model;
- [ ] define canonical change-record schema separate from audit metadata;
- [ ] define snapshot manifest schema;
- [ ] define reactivation manifest/schema migration references;
- [ ] ensure organization onboarding creates placement/lifecycle metadata server-side;
- [ ] ensure durable gateway resolves durable store from canonical organization placement;
- [ ] add tests proving callers cannot select cell/generation/store;
- [ ] add tests proving stale placement generations are rejected where routing/migration context is used;
- [ ] preserve initial one-STDB/one-PG operation without special-case feature code.

**Exit gate:** all tenant-aware infrastructure resolves through one canonical organization placement/lifecycle model, and durable/audit metadata can later support ordered reconstruction without requiring multi-region STDB implementation today.

---

## 14. Deferred work

Explicitly defer:

- active-active STDB across regions;
- automated African cell placement;
- automatic live cell migration;
- PG cross-region topology selection;
- production Scaleway region choice;
- self-hosted disconnected cell packaging;
- full state replay engine;
- payment-provider implementations.

The branch only establishes the contracts needed so those decisions can be made later without changing application/business boundaries.

---

## 15. Acceptance criteria

This foundation is successful when:

- every organization has canonical server-controlled lifecycle and placement metadata;
- placement supports a logical execution cell, durable store, and generation fence;
- initial deployment still works with one STDB + one PG;
- durable writes can be ordered by organization/generation/commit sequence;
- audit and change records share operation/correlation identifiers without becoming the same schema;
- snapshots can identify an exact reconstructable durable point;
- suspended/archived organizations retain enough versioned metadata for later migration/reactivation;
- future West/East Africa STDB cells require new placement/runtime configuration, not frontend/business-logic redesign;
- Scaleway PG can remain the central durable convergence/recovery layer while regional STDB cells remain latency-optimized execution authorities.
