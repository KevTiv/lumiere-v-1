# Offline-first synchronization through generated Drizzle + SQLite

**Status:** Proposed — architecture plan only  
**Tracks:** `offline-first`, `desktop`, `web`, `changesets`, `codegen`, `production-readiness`  
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [audit-log-cold-by-default.md](./audit-log-cold-by-default.md) · [backup-recovery-followup.md](./backup-recovery-followup.md) · [ARCHITECTURE.md](../ARCHITECTURE.md)

> The Postgres cold tier, shared schema IR, generated Drizzle client projection, and Lumiere replication pipeline described here are architectural targets. This document extends PR #3's direction; it does not claim those components are implemented today.

---

## 1. Decision

Build Lumiere offline support around a **generated SQLite local projection accessed through Drizzle**, plus a Lumiere-owned, checkpointed master/replica synchronization protocol.

SpacetimeDB remains the sole authoritative business-state engine. A disconnected client may persist authorized canonical projections and capture user intent locally, but it may not directly create canonical ERP state. Local business writes are stored as immutable **ChangeSet actions**. Reconnection uploads those actions for current-policy validation, reconciliation, optional human approval, and execution through canonical SpacetimeDB reducers.

```text
                         SPACETIMEDB
                    authoritative master
                            │
                    canonical reducers
                            │
                  ordered change stream
                            │
                      sync API server
                     ┌──────┴──────┐
                     │             │
                 pull state    push proposals
                     │             │
                     ▼             ▲
                 SyncEngine ───────┘
                     │
              SQLite transaction
             ┌───────┴────────┐
             │                │
       canonical mirrors   ChangeSets
             │                │
             └───────┬────────┘
                     │
                  Drizzle
                     │
             generated repositories
                     │
              React / React Query
```

The local database therefore replaces the need for separate persistent cache and offline-mutation stores. React Query may remain as disposable React query lifecycle state, but SQLite is the durable client-side data layer.

### 1.1 Why Drizzle + SQLite

The client architecture needs a typed, generated SQL surface without adopting a database library's synchronization semantics.

| Layer | Choice | Responsibility |
|---|---|---|
| **Durable client data** | SQLite | Authorized canonical projections, pending ChangeSets, sync checkpoints, device state, capability metadata |
| **Typed client access** | Drizzle | Generated table definitions, typed reads, transactions, repository implementation |
| **Synchronization** | Lumiere `SyncEngine` | Ordered pull, durable checkpointing, proposal push, retries, reconciliation, local invalidation |
| **Business authority** | SpacetimeDB | Reducer execution, validation, permissions, invariants, authoritative revisions and review decisions |
| **Cold history** | Postgres | Server-side generated historical projection; never a client authority |

Drizzle is deliberately **not** the synchronization engine. It provides typed access to SQLite while leaving Lumiere free to implement the master/replica semantics required by reducers and approvals.

### 1.2 Master/fork rule

The replication model borrows the useful part of an RxDB-style master/fork architecture without adopting generic row-conflict resolution:

```text
master = SpacetimeDB-approved canonical state
fork   = local SQLite projection + unaccepted proposals
```

Canonical local tables are server-owned mirrors. Local user mutations are expressed as ChangeSet actions rather than direct canonical row writes.

> **Non-negotiable:** local databases may propose state; only a successful SpacetimeDB reducer produces authoritative business state.

---

## 2. Key invariants

1. **SpacetimeDB is authoritative.** Canonical business state, reducer transactions, permissions, workflow transitions, accounting rules, inventory rules, and final approval decisions remain server-side.
2. **SQLite is a projection, not a second ERP.** Canonical local rows can always be rebuilt from the server without losing pending local intent.
3. **Business writes are reducer intents.** UI code must not directly mutate canonical mirror tables for domain actions.
4. **Every local action is durable before acknowledgement.** The local transaction must persist the ChangeSet action before the UI considers the offline operation captured.
5. **No blind replay.** Reconnection re-resolves identity, organization, company, permissions, reducer policy, base revision, dependencies, and approval requirements.
6. **Master wins canonical conflicts.** The client never performs generic row-level last-write-wins or field merge to manufacture canonical ERP state.
7. **Stale proposals become reviewable facts.** A base-revision mismatch is classified and surfaced; it is not silently overwritten.
8. **Pull application and cursor advancement are atomic.** A client cannot advance its sync checkpoint without durably applying the corresponding canonical changes.
9. **Push is idempotent.** Every ChangeSet/action carries stable IDs and can be retried safely.
10. **Sensitive data is projection-scoped.** Fields and rows not authorized by the current server projection must never be materialized locally.
11. **React Query is disposable.** It can cache query results in memory, but it is not the durable offline ledger or synchronization truth.
12. **Postgres cold storage is orthogonal.** The client sync contract receives authorized canonical resources through the API and does not know whether the server read came from hot STDB, cold Postgres, or a merged read plan.

---

## 3. Goals and non-goals

### Goals

- Continue useful ERP workflows through multi-hour or multi-day network outages.
- Use one durable local data layer for cached canonical data, offline reads, pending actions, synchronization metadata, and review status.
- Preserve one canonical reducer mutation path for online and offline operation.
- Generate client SQLite/Drizzle contracts from the same stable Rust-derived Lumiere schema IR used for Postgres/codegen.
- Keep browser, installed web app, Tauri/desktop, and future native clients behind the same local-data interfaces.
- Make online and offline commands follow the same proposal pipeline rather than maintaining separate mutation architectures.
- Provide explicit ChangeSet, conflict, dependency, review, approval, rejection, and application states.
- Support selective organization/company/resource synchronization rather than copying an entire tenant or historical archive.
- Keep the local projection rebuildable without losing unsynchronized ChangeSets.
- Reuse existing React Query hooks where useful while moving durable data ownership below them.

### Non-goals

- Running SpacetimeDB reducers locally.
- Reimplementing business validation in TypeScript or SQLite constraints.
- Peer-to-peer or multi-master synchronization.
- Generic automatic conflict merging for ERP rows.
- Treating Postgres as a client synchronization source of truth.
- Treating browser storage, React Query persistence, or JSON snapshots as the offline database.
- Making every resource/reducer offline-capable in the first phase.
- Implementing the runtime in this documentation PR.

---

## 4. Responsibility boundaries

| Component | Responsibility |
|---|---|
| **SpacetimeDB** | Canonical rows, reducer transactions, domain invariants, authoritative revisions, review/approval facts, audit state |
| **Postgres** | Generated server-side cold projection only |
| **Rust api-server** | Session resolution, projection policy, sync pull/push endpoints, ordered changefeed exposure, reconciliation, approval routing, reducer invocation, idempotency |
| **Lumiere codegen** | Stable schema IR and generated Postgres, SQLite/Drizzle, codecs, repository metadata, reducer-command metadata, sync metadata |
| **SQLite** | Durable authorized canonical mirrors, ChangeSets, actions, checkpoints, device/capability metadata |
| **Drizzle** | Typed SQL access and transactions over the selected SQLite runtime adapter |
| **SyncEngine** | Pull/push scheduling, checkpointing, retries, batch application, proposal status refresh, local invalidation |
| **Repository layer** | Only application-facing path for canonical queries and domain commands |
| **React Query** | React query lifecycle, deduplication, suspense/loading/error state, optional short-lived memory cache |
| **Runtime adapter** | Browser/desktop/native SQLite opening, secure key handling where available, filesystem/OPFS lifecycle, network state |

---

## 5. Generated client database architecture

### 5.1 Stable schema IR is the source for generated persistence artifacts

Do not create a second handwritten frontend schema.

Target generation chain:

```text
SpacetimeDB Rust tables + reducer bindings
                  │
                  ▼
          stable Lumiere schema IR
                  │
        ┌─────────┼───────────┬──────────────┐
        ▼         ▼           ▼              ▼
   Postgres DDL  SQLite DDL  Drizzle TS   sync/reducer manifests
        │                     │              │
        └─────────────────────┴──────────────┘
                              │
                    generated repositories
```

The IR should preserve at least:

```rust
pub struct ResourceSchema {
    pub name: String,
    pub table: String,
    pub primary_key: String,
    pub fields: Vec<FieldSchema>,
    pub organization_scoped: bool,
    pub company_scoped: bool,
    pub revision_field: Option<String>,
    pub offline: OfflinePolicy,
}

pub struct OfflinePolicy {
    pub replicated: bool,
    pub projection: ProjectionPolicy,
    pub operations: Vec<OfflineOperation>,
}

pub struct OfflineOperation {
    pub reducer: String,
    pub approval: ApprovalPolicy,
    pub conflict: ConflictPolicy,
}
```

### 5.2 Generated canonical mirror tables

For an offline-capable resource such as `sale_order`, codegen emits a Drizzle table equivalent to:

```ts
export const saleOrder = sqliteTable("sale_order", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id"),
  state: text("state").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
```

Canonical mirror tables are **pull-owned**. Repository command methods may read them but must not write domain state directly.

### 5.3 Generic ChangeSet tables

Do not generate one proposal table per ERP resource. Keep the transport/review model generic and generate resource-specific command types around it.

Minimum local metadata:

```ts
export const changeSet = sqliteTable("_lumiere_change_set", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id"),
  actorId: text("actor_id").notNull(),
  deviceId: text("device_id").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const changeSetAction = sqliteTable("_lumiere_change_set_action", {
  id: text("id").primaryKey(),
  changeSetId: text("change_set_id").notNull(),
  resource: text("resource").notNull(),
  entityId: text("entity_id").notNull(),
  reducer: text("reducer").notNull(),
  payloadJson: text("payload_json").notNull(),
  baseRevision: integer("base_revision"),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
});
```

Recommended action states:

```text
local
queued
submitted
awaiting_review
approved
rejected
applied
superseded
```

### 5.4 Sync metadata tables

```ts
export const syncCheckpoint = sqliteTable("_lumiere_sync_checkpoint", {
  stream: text("stream").primaryKey(),
  cursor: text("cursor").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
```

Additional internal tables may cover:

- device identity;
- projection version;
- schema version;
- capability snapshot metadata;
- tombstones where required;
- retry/backoff metadata;
- unresolved dependency references.

Internal sync tables must use a reserved `_lumiere_` namespace so generated domain resources cannot collide with them.

---

## 6. Repository and command boundary

Application code should not receive the raw Drizzle database for business operations.

Target API:

```ts
interface ResourceRepository<TEntity> {
  get(id: string): Promise<TEntity | null>;
  list(query: ResourceQuery): Promise<TEntity[]>;
}

interface SaleOrderCommands {
  confirm(input: ConfirmSaleOrderInput): Promise<LocalCommandResult>;
  cancel(input: CancelSaleOrderInput): Promise<LocalCommandResult>;
}
```

Usage:

```ts
const order = await saleOrderRepository.get(orderId);
await saleOrderCommands.confirm({ entityId: orderId });
```

`confirm()` must not execute:

```ts
await db.update(saleOrder).set({ state: "confirmed" });
```

It should atomically capture reducer intent:

```ts
await db.transaction(async (tx) => {
  await tx.insert(changeSetAction).values({
    id: actionId,
    changeSetId,
    resource: "sale_order",
    entityId: orderId,
    reducer: "confirm_sales_order",
    payloadJson: encodedPayload,
    baseRevision: order.revision,
    status: "local",
    createdAt: Date.now(),
  });
});
```

Generated command wrappers provide compile-time reducer payload typing and prevent resource/reducer mismatches.

---

## 7. Optimistic local projection

A pending action is not canonical state, but the UI often needs to show its expected effect immediately.

Repository reads may therefore expose a derived view:

```text
canonical SQLite mirror
        +
pending local ChangeSet actions
        ↓
projected UI state
```

Example:

```text
canonical sale_order.state = draft
pending action             = confirm_sales_order
UI projection              = confirmed (pending)
```

The projection helper is generated or explicitly authored per supported reducer. It is presentation logic only and must not duplicate server validation.

When the server later applies the reducer, canonical pull state converges to the projected state and the corresponding action becomes `applied`. The overlay then disappears without changing the visible result.

If the proposal is rejected or requires review, the projected view must surface that state rather than silently pretending the canonical row changed.

---

## 8. RxDB-like master/replica pipeline implemented by Lumiere

### 8.1 Ordered canonical changefeed

The server must expose an ordered, resumable stream of authoritative changes.

Conceptual contract:

```ts
type CanonicalChange = {
  sequence: string;
  resource: string;
  entityId: string;
  operation: "upsert" | "delete";
  revision: string;
  row?: unknown;
};
```

Properties:

- sequence is monotonic within the defined stream scope;
- rows are already filtered to the caller's authorized projection;
- deleted/revoked rows produce enough information to remove local materialization;
- reconnecting with a previous cursor returns all subsequent visible changes;
- schema/projection incompatibility can force a safe resnapshot rather than corrupting the local fork.

Do not assume the existing realtime invalidation WebSocket is sufficient. Invalidation is ephemeral; offline replication requires a durable replayable sequence.

### 8.2 Pull endpoint

Conceptual API:

```text
GET /api/sync/pull?cursor=<cursor>&limit=<n>
```

Response:

```ts
type PullBatch = {
  nextCursor: string;
  changes: CanonicalChange[];
  proposalUpdates: ProposalStatusUpdate[];
  hasMore: boolean;
};
```

Client application must be atomic:

```ts
await db.transaction(async (tx) => {
  await applyCanonicalChanges(tx, batch.changes);
  await applyProposalUpdates(tx, batch.proposalUpdates);
  await saveCheckpoint(tx, batch.nextCursor);
});
```

If the transaction fails, the cursor does not advance and the same batch can be replayed safely.

### 8.3 Push endpoint

Conceptual API:

```text
POST /api/sync/changesets
```

Push only immutable reducer intents, never arbitrary SQL row mutations.

The api-server performs:

```text
idempotency lookup
      ↓
current session resolution
      ↓
organization/company scope
      ↓
current field/reducer permission
      ↓
base-revision/dependency checks
      ↓
policy classification
  ┌───┼───────────────┐
  │   │               │
auto review          reject
  │   │
  │   └── awaiting_review
  │
  ▼
STDB reducer
  │
  ▼
canonical revision
```

The client may mark an action `submitted`, `awaiting_review`, or `rejected` from the push response, but it must only mark canonical business state as changed after observing the authoritative result through pull/subscription state.

### 8.4 Scheduler

The `SyncEngine` owns transport lifecycle:

```ts
interface SyncEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
  pull(): Promise<SyncResult>;
  push(): Promise<SyncResult>;
  syncNow(): Promise<SyncResult>;
}
```

Trigger sync on:

- application startup;
- transition to online;
- local action capture;
- server realtime hint;
- periodic fallback interval while online;
- explicit user retry.

Realtime events are wake-up hints, not the synchronization ledger. The durable pull cursor remains authoritative.

---

## 9. Approval and review model

ChangeSets provide the Git/PR-like workflow discussed for offline operations.

A server-side ChangeSet/action should preserve enough information to review intent against current canonical state:

```text
resource
entity
reducer/operation
proposer
origin device
created time
base revision
canonical current revision
submitted reducer payload
projected before/after representation
policy/risk classification
dependency information
review status
reviewer
rejection/amendment reason
resulting canonical revision
```

Review UI should show a domain-aware diff where possible:

```text
Sale Order #123

Canonical master (revision 15)
State: Draft
Total: 100

Offline proposal (based on revision 14)
State: Draft -> Confirmed

[Reject] [Approve]
```

Approval itself is a server-authorized operation. A reviewer cannot approve a mutation they are not currently permitted to cause.

High-risk reducers may always require review. Low-risk reducers may be auto-applied when the base revision, identity, permissions, dependencies, and policy all still match.

---

## 10. Conflict semantics

Do not implement generic client-side conflict merging.

Default rule:

```text
canonical STDB state always wins
```

A proposal references the canonical revision it was based on. If current canonical revision differs, the server classifies the proposal rather than allowing SQLite/Drizzle to resolve it.

Possible classifications:

```text
clean                    -> apply if policy allows
stale_but_safe           -> apply if reducer/policy explicitly supports it
needs_review             -> authorized human decision
invalid_dependency       -> reject or require remediation
permission_changed       -> reject
entity_deleted           -> reject / compensate / review
business_rule_changed    -> reject / review
```

For physical facts such as POS sales, stock movement, or cash events, review semantics should favor acceptance, correction, compensation, or escalation rather than pretending an event can simply be erased.

---

## 11. React Query integration

React Query may remain because it solves React-specific concerns well, but it should sit above repositories rather than own persistence.

Target:

```text
React component
      ↓
React Query hook
      ↓
generated repository
      ↓
Drizzle / SQLite
```

When a pull transaction modifies resources, the local data layer emits a small invalidation event:

```ts
type LocalChangeEvent = {
  resource: string;
  entityIds?: string[];
};
```

React Query subscribes and invalidates only affected keys.

This avoids maintaining two persistent caches:

```text
avoid:
React Query persisted cache
+
SQLite canonical cache
+
separate offline queue
```

Prefer:

```text
SQLite = durable data + action ledger
React Query = disposable reactive query state
```

---

## 12. Runtime portability

Keep runtime-specific SQLite details behind a narrow port.

```ts
interface LocalDatabaseRuntime {
  open(config: LocalDatabaseConfig): Promise<LocalDatabase>;
}
```

Target adapters may include:

```text
Browser/PWA      -> SQLite WASM + durable browser filesystem/OPFS adapter
Tauri/Desktop    -> native SQLite adapter
future native    -> native SQLite adapter
```

The shared layers should not know which adapter is active:

```text
generated Drizzle schema
repositories
ChangeSet model
SyncEngine
projection logic
```

The plan intentionally standardizes on the SQLite dialect and generated Drizzle contract rather than coupling domain architecture to a specific SQLite distribution or replication vendor.

Storage encryption, key custody, filesystem lifecycle, and backup behavior are runtime concerns and must be resolved before production rollout for each adapter.

---

## 13. Codegen deliverables

Extend `lumiere-codegen` from the stable Rust-derived schema IR rather than parsing generated frontend TypeScript as the source of truth.

Target generated artifacts:

```text
lumiere-codegen/
  schema IR
      ↓
api-server/src/generated/pg_ddl/*
frontend/packages/local-db/src/generated/schema.ts
frontend/packages/local-db/src/generated/codecs.ts
frontend/packages/local-db/src/generated/repositories.ts
frontend/packages/local-db/src/generated/commands.ts
frontend/packages/local-db/src/generated/offline-manifest.ts
crates/stdb-auth/assets/lumiere-schema-manifest.json
```

Generated manifest fields should include at least:

- resource/table mapping;
- primary key;
- organization/company scope;
- SQLite codec mapping;
- revision/version strategy;
- offline eligibility;
- authorized projection class;
- reducer command mapping;
- reducer payload type;
- approval policy;
- conflict policy;
- invalidated resources;
- dependency references;
- optional optimistic projector identifier.

`make check-codegen` should eventually verify that generated Drizzle/SQLite artifacts are reproducible and in sync with the same IR used for Postgres.

---

## 14. Proposed package boundary

```text
frontend/packages/local-db/
  src/
    generated/
      schema.ts
      codecs.ts
      repositories.ts
      commands.ts
      offline-manifest.ts

    runtime/
      database.ts
      adapter.ts
      migrations.ts

    changesets/
      create-change-set.ts
      statuses.ts
      projector.ts
      dependencies.ts

    sync/
      engine.ts
      pull.ts
      push.ts
      checkpoint.ts
      apply-batch.ts
      scheduler.ts

    events/
      local-change-bus.ts
```

SOLID boundaries:

- storage adapter knows SQLite runtime details;
- repositories know generated tables;
- command layer captures reducer intents;
- SyncEngine knows transport/checkpoint rules;
- approval policy stays server-side;
- React hooks know only repositories/query invalidation.

---

## 15. Security model

Offline availability must not expand authority.

Before materializing local data, the server projection layer must enforce:

- organization membership;
- active company scope;
- row visibility;
- field visibility;
- restricted-field policy;
- resource offline eligibility.

Before applying a ChangeSet, the server must re-resolve all authority from current canonical state.

A previously authorized offline capability is evidence that the user was allowed to capture an intent while disconnected; it is not proof that the server must later apply that intent.

Local data should be encrypted at rest where the runtime can provide an auditable implementation. Logout, organization removal, device revocation, and projection-policy changes must have defined local purge/rekey behavior.

---

## 16. Schema evolution and long-offline devices

A device may reconnect after weeks while several application/schema versions behind.

The sync handshake must include:

```text
client app version
local schema version
projection version
sync protocol version
last cursor
```

The server can respond with:

```text
incremental_sync
migration_required
resnapshot_required
client_upgrade_required
```

Pending ChangeSets must survive canonical projection rebuilds. Store them separately from generated canonical mirror tables so a resnapshot can safely:

1. preserve pending ChangeSets;
2. recreate/migrate canonical projection tables;
3. download current authorized state;
4. restore/re-evaluate pending projected views;
5. resume push/reconciliation.

---

## 17. Implementation phases

### Phase 0 — contracts and codegen

- Stabilize Rust-derived Lumiere schema IR.
- Add offline metadata to the IR/manifests.
- Generate SQLite/Drizzle tables and codecs for one low-risk resource.
- Define `LocalDatabase`, repository, command, and `SyncEngine` ports.
- Define canonical revision and ordered changefeed contracts.
- Add deterministic codegen checks.

**Exit:** one generated resource can be represented consistently in STDB metadata, Postgres projection metadata, and Drizzle SQLite artifacts without handwritten duplicate schemas.

### Phase 1 — local projection + pull

- Add SQLite runtime adapter for the first target runtime.
- Create sync checkpoint tables.
- Implement authenticated initial snapshot.
- Implement ordered incremental pull.
- Apply batches and cursor updates atomically.
- Wire repository reads to SQLite.
- Wire local change events into React Query invalidation.

**Exit:** the app can start from local SQLite, reconnect, and converge to current canonical STDB state without client writes.

### Phase 2 — ChangeSet capture + push

- Generate typed reducer command wrappers.
- Add generic local ChangeSet/action tables.
- Capture actions transactionally.
- Implement idempotent push endpoint.
- Re-resolve current authorization and base revisions.
- Apply clean/allowed actions through canonical STDB reducers.
- Pull resulting canonical revisions back to SQLite.

**Exit:** the same user command works online or offline and becomes canonical only through STDB.

### Phase 3 — review workflow

- Add authoritative server ChangeSet/review records.
- Add conflict/risk classification.
- Add Git/PR-like review UI.
- Add approve/reject/amend flows with reviewer authorization.
- Add audit and observability.

**Exit:** stale/high-risk offline activity is explicitly reviewable and cannot bypass reducer policy.

### Phase 4 — broader runtime/resource coverage

- Browser/PWA SQLite adapter.
- Tauri/desktop native SQLite adapter if not first.
- Expand generated resource eligibility deliberately.
- Add larger selective-sync policies and cold-history hydration rules.
- Evaluate branch/edge sync node needs separately; do not add multi-master semantics accidentally.

---

## 18. Test strategy

### Codegen

- Rust schema -> IR -> Drizzle snapshot tests.
- SQLite type/codec parity tests.
- Generated reducer command payload tests.
- `make check-codegen` dirty-tree detection.

### Local database

- transaction rollback tests;
- checkpoint atomicity tests;
- projection rebuild preserving ChangeSets;
- migration tests from multiple prior local schema versions;
- canonical table write-guard tests through repository boundaries.

### Sync

- duplicate push idempotency;
- duplicate pull batch idempotency;
- crash after rows but before cursor commit;
- crash after server reducer success but before client acknowledgement;
- reconnect after multi-day outage;
- cursor expiration/resnapshot;
- permission revoked while offline;
- company membership changed while offline;
- entity changed/deleted while offline;
- out-of-order network responses;
- partial batch/network interruption.

### Review

- stale base revision requires correct classification;
- unauthorized reviewer cannot approve;
- self-review rules for elevated actions;
- rejected proposal never mutates canonical state;
- approved proposal still revalidates current reducer policy;
- approval/result is idempotent and audited.

### Runtime

- browser persistence/restart;
- desktop process crash/restart;
- disk-full behavior;
- corrupted local DB recovery/resnapshot;
- encryption/key-loss behavior where encryption is enabled.

---

## 19. Operational observability

Track at least:

```text
sync_pull_batches_total
sync_pull_rows_total
sync_pull_lag
sync_push_actions_total
sync_push_retries_total
sync_checkpoint_age
changesets_local
changesets_awaiting_review
changesets_rejected
changesets_applied
changeset_oldest_pending_age
resnapshots_total
local_schema_migration_failures_total
```

Every ChangeSet should have stable correlation identifiers shared across client logs, api-server reconciliation, reducer execution, audit rows, and review UI.

---

## 20. Relationship to the Postgres cold tier

The cold-tier plan and offline plan solve different problems:

```text
Postgres cold tier
    -> server memory/history scaling

Drizzle + SQLite local projection
    -> client availability and durable offline work
```

The API/query planner should hide server storage placement from the client. A local hydration or sync request asks for an authorized resource projection; the server decides whether the data comes from STDB, Postgres, or a merged read.

Offline ChangeSets always target reducer intent and therefore always converge through SpacetimeDB authority, regardless of where historical reads are stored.

---

## 21. Open questions before implementation

1. What canonical revision/change-sequence primitive should the STDB side expose so all offline-capable resources have a durable ordered stream?
2. Should the first client runtime be Tauri/native SQLite or browser SQLite WASM/OPFS, while preserving the same Drizzle schema?
3. Which SQLite runtime/encryption combination meets the deployment and at-rest-security requirements for each platform?
4. Which alpha resources/reducers are safe enough for Phase 2 offline commands?
5. Which reducer intents need explicit optimistic projectors versus a generic pending-action badge?
6. How long are server changefeed cursors retained before a client must resnapshot?
7. What is the exact policy for local data purge when organization/company permissions are revoked while a device is offline?
8. Which physical-event workflows require compensation semantics rather than reject semantics?
9. When should a branch-local sync node be investigated for sites with many simultaneously offline devices?

---

## 22. Final architectural rule

The client database is not a replica that may independently decide business truth. It is a durable **fork/projection** containing the last authorized canonical state plus unaccepted reducer intents.

```text
SQLite            = durable local projection
Drizzle           = generated typed access
ChangeSet         = durable user intent
SyncEngine        = checkpointed master/fork transport
Approval Engine   = governance
SpacetimeDB       = canonical decision and truth
Postgres          = server-side cold history
React Query       = disposable UI query state
```

That division preserves the existing reducer-centric architecture while providing the RxDB-like replication behavior Lumiere needs without adopting a generic replication engine whose conflict semantics would compete with ERP approval and reducer rules.
