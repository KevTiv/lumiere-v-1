# STDB-owned transactional core with durable Postgres projection

**Status:** Proposed — narrowed 2026-08-20
**Tracks:** `durable-postgres`, `tenant-onboarding`, `stdb-query-boundary`
**Related:** [audit-log-cold-by-default.md](./audit-log-cold-by-default.md) · [backup-recovery-followup.md](./backup-recovery-followup.md) · [offline-changeset-sync.md](./offline-changeset-sync.md)

---

## 1. Decision

Keep SpacetimeDB as Lumiere's single business-logic and application-query boundary. Postgres is a durable per-organization projection and historical store, but application callers must not query it directly and the api-server must not become a second place where resource authorization, business predicates, or query semantics are implemented.

The durable path is therefore:

```text
frontend / client
      │
      ▼
SpacetimeDB function boundary
      │
      ├── reducers own mutations + business invariants
      ├── views own STDB-native read models
      └── procedures are the narrow external-I/O bridge
                    │
                    ▼
          organization durable gateway
                    │
                    ▼
              Postgres shard
```

A reducer cannot directly query Postgres because reducers are isolated from external I/O. A SpacetimeDB procedure may perform the HTTP call, but it must not become a second business engine. Query authorization, organization scope, allowed fields, resource-specific predicates, ordering, pagination, and hydration decisions remain defined by STDB-owned reducer-compatible logic.

The concrete goal is:

> all business decisions remain inside the SpacetimeDB module; Postgres only executes a bounded durable query already authorized and shaped by STDB, and any state-changing result returns through an STDB transaction/reducer before normal business logic continues.

Initial production remains one STDB instance + one Postgres database. Organization placement keeps the durable layer shard-ready without expanding this branch into general scaling work.

---

## 2. Non-negotiable invariants

1. **SpacetimeDB owns all business rules and state transitions.** Reducers remain the only mutation/business-command implementation.
2. **Postgres is durable storage/projection, not a second business engine.**
3. **The api-server does not independently compile business/resource queries for PG.**
4. **A durable query cannot originate from a caller-provided SQL fragment, shard id, organization id, or unrestricted filter object.**
5. **STDB resolves organization/company scope, field policy, resource predicates, order, cursor, and page bounds before durable I/O occurs.**
6. **Procedures are transport/orchestration only.** They may perform external HTTP, but must reuse STDB-owned query-planning and reducer logic rather than duplicate it.
7. **Any durable row re-entering active mutable state is validated and inserted through an STDB transaction before a normal reducer acts on it.**
8. **Every organization-scoped durable operation resolves its PG placement from authoritative tenant placement.**
9. **Tenant placement is runtime/onboarding configuration, not generated schema.**
10. **No row is removed from STDB until its exact durable version is verified on the resolved PG store.**

---

## 3. Ownership model

```text
SpacetimeDB
────────────────────────────────────────
reducers
  business commands
  authorization-sensitive mutations
  archive eligibility
  hydration acceptance
  durable-query authorization/planning

views / subscriptions
  active application read models
  realtime state

procedures
  external-I/O bridge only
  no duplicated business policy

                 │ bounded generated contract
                 ▼

Durable gateway
────────────────────────────────────────
tenant placement resolution
connection pooling / TLS
execute generated durable query plan
serialize generated row shape
no business decisions

                 │
                 ▼

Postgres shard
────────────────────────────────────────
durable projection
historical data
archive transfer ledger
backup / restore source
```

The durable gateway may live in the api-server process initially, but it is infrastructure, not an application query layer.

---

## 4. STDB-owned durable query contract

### 4.1 Query intent

Replace the previous model where `query_exec.rs` resolves a `ResourceReadPlan` and independently fans out to STDB + PG.

The canonical durable query plan belongs to the SpacetimeDB module boundary:

```rust
pub struct DurableQueryPlan {
    pub request_id: QueryRequestId,
    pub organization_id: OrganizationId,
    pub company_id: Option<CompanyId>,
    pub resource: ResourceKey,
    pub projection: Vec<ColumnName>,
    pub predicates: Vec<ReadPredicate>,
    pub order: Vec<ReadOrder>,
    pub page: PageSpec,
}
```

This is not accepted directly from the frontend. It is produced only after STDB-owned policy resolution.

### 4.2 Procedure flow

Because reducers cannot perform external network I/O, durable access uses a procedure as a narrow bridge:

```text
client requests historical page
        │
        ▼
STDB durable-query procedure
        │
        ├─ with_tx
        │    resolve caller/session
        │    call reducer-compatible query-policy logic
        │    produce bounded DurableQueryPlan
        │
        ├─ transaction closes
        │
        ├─ HTTP → durable gateway
        │          resolve org → PG placement
        │          execute generated plan only
        │          return generated row shape
        │
        └─ return bounded result
```

No network request occurs while the procedure holds an STDB transaction open.

The procedure may share pure/internal helpers with reducers, or call reducer logic inside `with_tx`, but business rules must have one implementation inside the module.

### 4.3 No generic PG query endpoint

Do not expose an application endpoint equivalent to:

```text
GET /api/query/:resource → compile arbitrary PG SQL
```

for durable data.

The durable gateway accepts only a generated/validated durable contract originating from the STDB procedure boundary. It must not independently decide:

- which organization may be queried;
- which company scope applies;
- which fields are visible;
- which resource state is valid;
- archive eligibility;
- business-specific filters;
- whether a mutation is permitted.

Those decisions remain in STDB.

---

## 5. Durable mutation / rehydration path

A mutable row that exists only in Postgres must become hot before normal reducer business logic proceeds.

```text
client mutation intent
      │
      ▼
STDB hydration procedure
      │
      ├─ with_tx
      │    authorize caller + target organization
      │    determine hydration requirement
      │
      ├─ HTTP → durable gateway → resolved PG shard
      │    fetch exact generated row/version
      │
      └─ with_tx
           validate org + version + payload
           call hydration reducer/helper
           call existing business reducer
```

The external fetch and STDB transaction are deliberately separated. The procedure must never hold a transaction while waiting on Postgres.

Hydration logic must be idempotent. The existing reducer remains the canonical implementation of the business action; it must not learn about PG connections or shard placement.

---

## 6. Durable write / eviction path

Reducers decide when data is eligible to leave hot state. Infrastructure performs persistence; a reducer finalizes deletion.

```text
STDB reducer marks row durable-eligible
      │
      ▼
durable worker/procedure
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

The worker/procedure must not infer business eligibility. It executes eligibility already materialized by reducers.

---

## 7. Tenant onboarding and PG placement

Organization onboarding assigns exactly one durable store:

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

All durable infrastructure resolves through:

```rust
pub trait TenantStoreResolver {
    fn resolve(&self, organization_id: OrganizationId) -> Result<TenantStores>;
}

pub struct TenantStores {
    pub durable: PgPool,
}
```

No application or module caller supplies `DurableStoreId` directly.

Physical tenant placement remains runtime/onboarding state so an organization can move between PG shards without regenerating STDB bindings, schema IR, or PG DDL.

---

## 8. Schema IR and codegen

### 8.1 Source-of-truth chain

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
        ├── durable resource metadata
        ├── durable query contract metadata
        └── hydration metadata
```

Generated Rust bindings remain the schema input. Downstream generators must not parse generated TypeScript to recover database types.

### 8.2 Organization scope is schema; placement is not

The existing schema-IR helpers remain correct:

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

Do not serialize physical shard IDs, hosts, URLs, regions, or placement into schema IR.

### 8.3 Generated durable query metadata

Codegen may emit structural metadata needed by STDB and the durable gateway to agree on row/query shape:

```rust
pub struct GeneratedDurableResource {
    pub resource: ResourceKey,
    pub table: TableName,
    pub organization_column: ColumnName,
    pub primary_key: ColumnName,
    pub allowed_projection: Vec<ColumnName>,
    pub order_keys: Vec<ColumnName>,
}
```

This metadata describes structure, not business policy. Authorization predicates and state-dependent business rules remain hand-written/reducer-owned module logic.

---

## 9. What changes from the previous branch objective

Remove or demote these concepts:

- api-server as the canonical dual-store `ResourceReadPlan` owner;
- direct frontend/API historical PG query paths;
- PG query compilers that independently reproduce authorization/business filters;
- application repositories that choose between STDB and PG themselves.

Keep:

- generated PG schema/codecs;
- organization-scoped durable placement;
- archive version + payload hash;
- compare-and-finalize eviction;
- bounded keyset pagination;
- hydration manifests;
- PG TLS/pooling;
- transfer ledger;
- schema/codegen drift checks.

---

## 10. Implementation phases

### Phase 0 — align contracts

- [ ] move durable-query ownership from api-server orchestration to an STDB-owned procedure/reducer-compatible contract;
- [ ] define `DurableQueryPlan` as an internal/generated STDB → durable-gateway contract;
- [ ] remove independent PG business-policy compilation from the api-server;
- [ ] keep generated structural metadata only;
- [ ] ensure all durable pages are bounded and deterministic.

**Exit gate:** no business rule must be reimplemented outside the STDB module to query durable data.

### Phase 1 — tenant-aware durable gateway

- [ ] add durable-store/tenant-placement configuration;
- [ ] add `TenantStoreResolver`;
- [ ] make organization onboarding assign one durable store;
- [ ] durable gateway resolves organization → PG store internally;
- [ ] reject caller-provided shard/store overrides;
- [ ] tenant-isolation tests.

### Phase 2 — prove durable read

Use `audit_log` first:

- [ ] STDB procedure resolves/authorizes a bounded historical query;
- [ ] procedure calls durable gateway outside a transaction;
- [ ] gateway executes only the generated durable contract;
- [ ] verify org/company/field policy cannot be bypassed;
- [ ] verify one-PG deployment behavior remains simple.

### Phase 3 — prove mutable rehydration

Use one mutable transactional resource:

- [ ] STDB procedure determines hydration need;
- [ ] fetch durable row through tenant-resolved gateway;
- [ ] validate row/version/org in a fresh STDB transaction;
- [ ] call hydration reducer/helper;
- [ ] call existing business reducer;
- [ ] concurrency, crash, retry, and stale-version tests.

### Phase 4 — optional second PG store correctness proof

- [ ] configure a second ordinary PG store;
- [ ] onboard one test organization onto it;
- [ ] verify durable reads/writes/hydration cannot cross tenant stores;
- [ ] document manual copy → verify → placement flip → rollback migration.

This remains a correctness proof, not an autoscaling project.

---

## 11. Explicitly out of scope

- STDB horizontal scaling;
- automatic STDB tenant sharding;
- Kubernetes topology;
- PG read replicas;
- automatic PG shard balancing;
- cross-region placement;
- capacity prediction;
- distributed query federation;
- automatic tenant migration;
- moving business logic into Postgres or the api-server;
- reducers directly performing external I/O.

---

## 12. Required tests

At minimum:

1. durable queries can only be produced after STDB-owned authorization/scope resolution;
2. durable gateway rejects unknown/unplaced organizations;
3. durable gateway cannot accept caller-selected PG stores;
4. org A cannot query org B durable data even when resource/PK values collide;
5. field-level policy from STDB is preserved in the durable contract;
6. pagination/order are deterministic across hot/durable boundaries;
7. no external HTTP call occurs while an STDB transaction is held open;
8. hydration rejects organization/version mismatch;
9. normal business reducers remain unchanged by durable storage topology;
10. archive finalize still rejects stale versions;
11. one-PG deployment works without special-case application code;
12. two configured PG stores can host separate test organizations without cross-store access.

---

## 13. Acceptance criteria

This branch is complete when:

- SpacetimeDB remains the only business-logic boundary;
- reducers remain the only implementation of state-changing business commands;
- views/subscriptions remain the normal active-state read surface;
- procedures are used only where external durable I/O is required;
- durable query authorization/planning is STDB-owned;
- Postgres executes generated, bounded, already-authorized durable contracts only;
- organization onboarding establishes PG placement;
- schema/codegen identifies organization-scoped durable resources without embedding topology;
- the api-server/durable gateway contains infrastructure concerns only, not duplicate business policy;
- broader scaling remains outside this branch.