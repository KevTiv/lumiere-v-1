# Durable Postgres projection with organization-scoped tenant placement

**Status:** Proposed — narrowed 2026-08-20
**Tracks:** `durable-postgres`, `tenant-onboarding`, `organization-sharding`
**Related:** [audit-log-cold-by-default.md](./audit-log-cold-by-default.md) · [backup-recovery-followup.md](./backup-recovery-followup.md) · [offline-changeset-sync.md](./offline-changeset-sync.md)

---

## 1. Decision

Keep SpacetimeDB as Lumiere's authoritative hot transactional engine and business-logic boundary. Use Postgres as the durable historical projection, with every organization-scoped Postgres access resolved through a tenant placement layer.

This branch no longer attempts to design general horizontal scaling, distributed SpacetimeDB topology, read replicas, Kubernetes placement, or automatic capacity management.

The concrete goal is smaller:

> make organization onboarding assign a durable Postgres placement once, make every durable read/write resolve through that placement, and keep the schema/codegen layer independent from physical shard topology.

Initial production can still run one SpacetimeDB instance and one Postgres database. The routing abstraction exists so additional Postgres shards can be added later without rewriting repositories, codegen, archive workers, or API contracts.

---

## 2. Ownership model

```text
organization
    │
    ▼
tenant placement
    │
    ├── SpacetimeDB hot state
    │     reducers
    │     active transactional state
    │     realtime subscriptions
    │     business invariants
    │
    └── Postgres durable shard
          full durable projection
          historical reads
          reporting / restore source
          archived inactive rows
```

### Non-negotiable invariants

1. **SpacetimeDB owns business decisions and reducer transactions.**
2. **Postgres is durable storage/projection, not a second business engine.**
3. **Every organization-scoped PG operation requires an already-resolved organization identity.**
4. **Callers never select a PG pool/shard directly.** They receive a durable store from the tenant resolver.
5. **Tenant placement is runtime configuration, not generated schema.** Moving an organization must not regenerate bindings or migrations.
6. **Organization-scoped tables must carry `organization_id`.** Generated tooling may classify them from that schema fact.
7. **No row is evicted from STDB until its exact durable version is verified in the organization’s PG shard.**
8. **Authorization and field policy are resolved once before either hot or durable reads.**

---

## 3. Tenant onboarding and placement

Organization creation/onboarding owns durable placement.

```rust
pub struct TenantPlacement {
    pub organization_id: OrganizationId,
    pub durable_store: DurableStoreId,
}
```

The first deployment may contain only:

```text
DurableStoreId("pg-primary")
```

so every tenant resolves to the same Postgres cluster. Adding a second cluster later becomes a placement-data change rather than an application rewrite.

### Resolver boundary

```rust
pub trait TenantStoreResolver {
    fn resolve(&self, organization_id: OrganizationId) -> Result<TenantStores>;
}

pub struct TenantStores {
    pub durable: PgPool,
}
```

The exact pool wrapper may differ, but the dependency direction is mandatory:

```text
request/session
    ↓
organization_id
    ↓
TenantStoreResolver
    ↓
organization's durable PG store
    ↓
repository / query / archive operation
```

Forbidden pattern:

```rust
state.pg_pool.get().await?;
```

Required shape:

```rust
let stores = state.tenant_stores.resolve(organization_id)?;
let conn = stores.durable.get().await?;
```

This branch does not need a dynamic shard-balancing algorithm. Placement may initially be explicit/static.

---

## 4. Schema IR and codegen

### 4.1 Source-of-truth chain

```text
SpacetimeDB Rust module definitions
        │
        ▼
spacetime generate --lang rust
        │
        ▼
api-server/src/stdb_sdk_bindings/
        │
        ▼
lumiere-codegen
        │
        ▼
GeneratedSchemaManifest / schema IR
        ├── PG DDL + migrations
        ├── STDB ↔ PG codecs
        ├── archive metadata
        ├── generated read metadata
        └── generated hydration metadata
```

Generated Rust bindings remain the schema input. Downstream generators must not recover DB types by parsing generated TypeScript.

### 4.2 Organization scope is schema; shard placement is not

The schema IR may derive whether a table is organization-scoped from the presence of `organization_id`:

```rust
pub enum GeneratedTenantScope {
    Organization,
    Global,
}

impl GeneratedTableSchema {
    pub fn tenant_scope(&self) -> GeneratedTenantScope;
    pub fn organization_column(&self) -> Option<&GeneratedColumn>;
}
```

This branch exposes those helpers without changing the serialized manifest shape.

Do **not** add values such as `pg_shard_1`, database URLs, regions, hostnames, or tenant-placement IDs to generated schema artifacts. Those values change operationally and belong to onboarding/runtime configuration.

Generated PG/archive tooling should use `tenant_scope()` to fail closed when an organization-routed durable operation targets a table that has no organization ownership column.

### 4.3 Type mapping remains unchanged

Postgres `BIGINT` is signed and cannot losslessly represent the complete Rust `u64` domain. Continue using the existing explicit mapping rule (`NUMERIC(20,0)` unless a repository-wide checked invariant chooses otherwise).

---

## 5. Durable write and eviction path

The existing compare-and-finalize safety model remains useful, but the PG target is now selected by tenant placement.

```text
eligible STDB row
    │ organization_id
    ▼
TenantStoreResolver
    │
    ▼
organization PG shard
    │
    ├── UPSERT exact archive_version
    ├── verify id + version + payload hash
    ▼
STDB finalize reducer
    │
    └── delete only if version / eligibility still match
```

The worker must never derive a shard from a table name, request field, or untrusted payload. It resolves only from the authoritative `organization_id` associated with the operation.

The `archive_transfer` ledger remains organization-scoped and must live on the same durable shard as the archived row, or carry enough placement identity to prove which durable store was verified.

---

## 6. Durable read path

`ResourceReadPlan` remains the shared semantic contract:

```rust
pub struct ResourceReadPlan {
    pub resource: ResourceKey,
    pub table: TableName,
    pub projection: Vec<ColumnName>,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub predicates: Vec<ReadPredicate>,
    pub order: Vec<ReadOrder>,
    pub page: PageSpec,
}
```

Execution becomes:

```text
authenticated request
    ↓
resolve org/company/field policy
    ↓
ResourceReadPlan
    ↓
TenantStoreResolver(plan.organization_id)
    ↓
STDB + resolved PG durable store
    ↓
bounded merged result
```

No PG compiler or repository may accept a caller-provided shard identifier independently from the organization-bound plan/context.

Existing bounded pagination, global ordering, dedupe, and STDB-wins-current-version rules remain unchanged.

---

## 7. Rehydration

Late mutation of a durable-only row remains orchestrated before the normal reducer call:

```text
mutation request
    ↓
organization context
    ↓
resolve organization PG shard
    ↓
fetch durable row
    ↓
hydrate into STDB if still absent
    ↓
call existing reducer
```

Hydration must verify that the durable row belongs to the resolved organization before inserting it into hot state.

Reducers remain unchanged and do not learn about Postgres or shard placement.

---

## 8. Implementation scope

### Phase 0 — keep existing cold-tier safety foundation

Retain the already-built pieces that directly support durable PG:

- [x] Rust STDB bindings as codegen input;
- [x] stable schema IR;
- [x] PG DDL/codecs generation;
- [x] `ResourceReadPlan` and store compilers;
- [x] archive/hydration manifests;
- [x] archive-version and payload-hash conventions;
- [x] production PG TLS configuration;
- [x] bounded cursor/order contract;
- [x] `make check-codegen` drift checks.

### Phase 1 — organization-aware durable store resolution

- [ ] add durable-store/tenant-placement configuration;
- [ ] add `TenantStoreResolver` abstraction;
- [ ] make organization onboarding assign a durable store;
- [ ] remove direct global PG-pool access from durable repositories/workers;
- [ ] propagate resolved organization context through PG query/archive/hydration paths;
- [x] expose organization-scope helpers in schema IR without serializing topology;
- [ ] fail codegen/runtime validation when an organization-routed durable table lacks `organization_id`;
- [ ] tenant isolation tests proving org A cannot read/write org B's durable shard context.

**Exit gate:** application code can run with one PG database, but no organization-scoped durable path depends on there being only one PG database.

### Phase 2 — prove the durable path

Use `audit_log` first, then one mutable transactional resource:

- [ ] write/verify through resolved durable store;
- [ ] checked STDB finalize;
- [ ] scoped historical read;
- [ ] rehydration for the mutable resource;
- [ ] crash/retry/version-race tests;
- [ ] backup/restore validation for the tenant placement + durable data pair.

### Phase 3 — optional second Postgres shard proof

Only after the single-store path works:

- [ ] configure a second ordinary Postgres durable store;
- [ ] onboard a test organization directly onto it;
- [ ] verify reads/writes/archive/hydration never cross stores;
- [ ] document a manual tenant-placement migration procedure with copy → verify → routing flip → rollback.

This is a correctness proof, not an autoscaling project.

---

## 9. Explicitly out of scope for this branch

Drop the previous general scaling investigation from this PR:

- SpacetimeDB horizontal scaling strategy;
- automatic STDB tenant sharding;
- Kubernetes topology;
- PG read replicas;
- automatic shard balancing/rebalancing;
- cross-region placement;
- capacity prediction;
- distributed query federation;
- automatic live tenant migration;
- generalized multi-store orchestration beyond organization → durable PG placement.

Those decisions should be driven by production measurements later.

---

## 10. Required tests

At minimum:

1. onboarding produces exactly one valid durable placement for an organization;
2. resolving the same organization is deterministic;
3. an unknown/unplaced organization fails closed;
4. durable reads cannot override the organization-derived store;
5. archive writes and transfer-ledger writes use the same resolved store;
6. hydration rejects a row whose `organization_id` differs from the request context;
7. an organization-scoped durable table without `organization_id` is rejected;
8. single-PG deployment behavior is unchanged;
9. two configured PG stores can host different test organizations without cross-tenant access.

---

## 11. Acceptance criteria

This branch is complete when:

- SpacetimeDB still owns reducer/business logic;
- Postgres is the durable historical projection;
- organization onboarding establishes durable PG placement;
- every organization-scoped PG operation resolves through that placement;
- schema/codegen can identify organization-scoped tables without embedding topology;
- one-PG deployment remains the default and simplest production setup;
- a second PG store can be introduced by configuration/onboarding rather than repository rewrites;
- broader scaling work has been removed from the branch scope.
