# STDB-owned transactional core with durable Postgres projection

**Status:** Proposed — production-contract alignment 2026-08-20
**Tracks:** `contract-ir`, `generated-client-sdk`, `contract-migration`, `durable-postgres`, `tenant-onboarding`, `stdb-query-boundary`, `traffic-resilience`
**Related:** [audit-log-cold-by-default.md](./audit-log-cold-by-default.md) · [backup-recovery-followup.md](./backup-recovery-followup.md) · [offline-changeset-sync.md](./offline-changeset-sync.md) · [audit-auth-operation-context-plan.md](./audit-auth-operation-context-plan.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Decision

Keep SpacetimeDB as Lumiere's single business-logic and application-query authority. Postgres is a durable per-organization projection and historical store. Frontend/runtime callers consume generated typed application contracts rather than raw reducer names, positional payloads, transport URLs, handwritten cache keys, or locally duplicated generated types.

Before extending the durable path, establish a stable generated application-contract layer and migrate existing frontend usage onto it. The migration must be scriptable, repeatable, idempotent, and CI-enforced so the legacy transport/type ecosystem can be deleted rather than maintained indefinitely.

Traffic resilience is part of the contract boundary as well: generated operations carry structural traffic classification so Kong and application admission control can apply bounded, server-authoritative rate/concurrency/retry policy without moving business logic into the gateway.

```text
frontend / client
      │
      ▼
private generated npm SDK
      ├── typed domain services
      ├── React Query hooks + query keys
      ├── mutation invalidation metadata
      └── subscription bindings
      │
      ▼
Kong + server admission boundary
      │
      ▼
SpacetimeDB function boundary
      ├── reducers own mutations + business invariants
      ├── views/subscriptions own active read models
      └── procedures bridge external durable I/O
                    │
                    ▼
          organization durable gateway
                    │
                    ▼
              Postgres store
```

Reducers cannot perform network I/O. Durable reads therefore use an STDB procedure that resolves an already-authorized and bounded durable query contract inside STDB, closes the transaction, performs the durable fetch, and returns or hydrates the result through a fresh STDB transaction where required.

The concrete goal is:

> business decisions stay inside the SpacetimeDB module; generated contracts provide the stable typed application boundary; migration tooling converts existing frontend usage onto that boundary; traffic/admission policy bounds ecosystem load; Postgres executes bounded durable contracts already authorized and shaped by STDB.

Initial production remains one STDB instance + one Postgres database. Organization placement keeps the durable layer shard-ready without expanding this branch into general scaling work.

---

## 2. Non-negotiable invariants

1. **SpacetimeDB owns all business rules and state transitions.** Reducers remain the only implementation of state-changing business commands.
2. **Generated contracts contain structural/application metadata, never business policy.**
3. **Frontend application code consumes stable named operations instead of raw reducer names, resource URLs, positional argument arrays, or raw STDB binding details.**
4. **Migration scripts are generated/manifest-driven and idempotent.** Re-running them must produce no additional semantic changes.
5. **Legacy transport/type APIs are temporary compatibility surfaces and are deleted after migration.**
6. **Postgres is durable storage/projection, not a second business engine.**
7. **The api-server/durable gateway does not independently compile business/resource policy.**
8. **STDB resolves organization/company scope, field policy, resource predicates, ordering, pagination, and hydration decisions before durable I/O.**
9. **Procedures are transport/orchestration only and must reuse STDB-owned business/query-policy logic.**
10. **Tenant placement is runtime/onboarding configuration, not generated schema or application-contract IR.**
11. **No row leaves STDB until its exact durable version is verified on the resolved PG store.**
12. **All security-sensitive audit/admission identity is server-derived, never client-authored.**
13. **Every external operation has bounded rate, payload, timeout, and downstream concurrency policy.**
14. **Overload fails fast and locally through 429/503 shedding rather than cascading into STDB/PG/workers.**
15. **Mutation retries require explicit idempotency semantics; retries must not be amplified across client/gateway/service layers.**

---

## 3. Ownership model

```text
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
transport target metadata
legacy migration metadata
traffic class / idempotency metadata
no business policy

              │ generates
              ▼

Private contract artifacts
────────────────────────────
Rust contract crate
private npm package
  framework-neutral services
  React Query hooks
  query-key factories
  subscription adapters
  transport serialization

              │ calls
              ▼

Kong + admission control
────────────────────────────
edge request bounds
rate limits
upstream health/timeouts
server-derived actor/org budgets
concurrency pools / load shedding

              │ calls
              ▼

SpacetimeDB
────────────────────────────
reducers / views / procedures
business rules and authorization

              │ bounded durable contract
              ▼

Durable gateway → tenant PG store
```

The private package/crate repositories are distribution artifacts for generated output. `lumiere-v-1` continues to own STDB business logic and the code-generation implementation.

---

## 4. STDB-owned durable query contract

A durable plan is produced only after STDB-owned policy resolution:

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

It is not accepted directly from the frontend.

```text
client generated query
        │
        ▼
Kong / admission policy
        │
        ▼
STDB durable-query procedure
        │
        ├─ with_tx
        │    resolve caller/session
        │    apply STDB query policy
        │    produce DurableQueryPlan
        │
        ├─ transaction closes
        │
        ├─ HTTP → durable gateway
        │          resolve org → PG placement
        │          execute generated plan only
        │
        └─ return bounded result
```

No application endpoint may expose arbitrary PG SQL/resource querying for durable data.

---

## 5. Durable mutation / rehydration

A durable-only mutable row becomes hot before ordinary reducer logic proceeds:

```text
client generated command
      │
      ▼
Kong / admission policy
      │
      ▼
STDB hydration procedure
      │
      ├─ with_tx: authorize + determine hydration requirement
      ├─ HTTP → durable gateway → tenant PG
      └─ with_tx
           validate org + version + payload
           hydrate idempotently
           invoke existing reducer logic
```

Reducers never learn about PG connections, shards, or placement.

---

## 6. Durable write / eviction

Reducers decide eligibility; infrastructure persists; reducers finalize removal:

```text
STDB reducer marks durable-eligible
      ↓
durable worker/procedure
      ↓
TenantStoreResolver
      ↓
organization PG store
      ├── UPSERT exact archive_version
      └── verify id + version + payload hash
      ↓
STDB finalize reducer
      └── delete only when eligibility/version still match
```

---

## 7. Tenant onboarding and PG placement

Organization onboarding assigns one durable store:

```rust
pub struct TenantPlacement {
    pub organization_id: OrganizationId,
    pub durable_store: DurableStoreId,
}
```

The initial deployment may contain only `DurableStoreId("pg-primary")`.

```rust
pub trait TenantStoreResolver {
    fn resolve(&self, organization_id: OrganizationId) -> Result<TenantStores>;
}

pub struct TenantStores {
    pub durable: PgPool,
}
```

No caller supplies a physical store/shard ID. Physical placement stays runtime configuration so a tenant can move without regenerating STDB bindings, schema IR, or frontend contracts.

---

## 8. IR, codegen, and private packages

### 8.1 Source-of-truth chain

```text
SpacetimeDB Rust definitions
        ↓
spacetime generate --lang rust
        ↓
Rust generated STDB bindings
        ↓
lumiere-codegen
        ├── schema IR
        │     ├── PG DDL/migrations
        │     ├── codecs
        │     ├── durable metadata
        │     └── hydration metadata
        │
        └── application-contract IR
              ├── operations
              ├── typed inputs/outputs
              ├── cache/invalidation metadata
              ├── subscriptions
              ├── migration aliases/legacy mappings
              └── traffic class/idempotency metadata
                    ↓
            generated private artifacts
              ├── Rust contract crate
              └── npm SDK + React Query adapters
```

Generated Rust bindings remain the schema input. Do not parse generated TypeScript to reconstruct database types.

### 8.2 Schema IR and application-contract IR stay separate

Schema IR describes storage structure. Application-contract IR describes explicitly approved caller-facing operations. A table or reducer existing in STDB does not automatically become public CRUD surface.

```rust
pub enum GeneratedOperationKind {
    Query,
    Command,
    Subscription,
}

pub struct GeneratedApplicationOperation {
    pub name: OperationName,
    pub kind: GeneratedOperationKind,
    pub target: StdbFunctionName,
    pub input: GeneratedTypeRef,
    pub output: GeneratedTypeRef,
    pub cache_tags: Vec<CacheTag>,
    pub invalidates: Vec<CacheTag>,
    pub traffic: GeneratedOperationTrafficPolicy,
}
```

### 8.3 Migration metadata belongs beside application contracts

The code generator may emit deterministic migration metadata, for example:

```rust
pub struct GeneratedLegacyOperationAlias {
    pub legacy_symbol: String,
    pub operation: OperationName,
    pub generated_hook: Option<String>,
}
```

Example manifest entry:

```json
{
  "legacyReducer": "confirm_sale_order",
  "operation": "sales.orders.confirm",
  "hook": "useConfirmSaleOrder"
}
```

This metadata is mechanical mapping only. It must not encode authorization or domain decisions.

### 8.4 Private npm package is the frontend boundary

The package should expose domain-oriented framework-neutral and React-specific entry points:

```text
@lumiere/contracts
  /sales
  /crm
  /accounting
  /inventory
  /react-query
```

Application code converges toward:

```ts
const orders = useSaleOrders({ companyId });
const confirmOrder = useConfirmSaleOrder();

confirmOrder.mutate({ orderId });
```

and away from `/api/query/*`, `/api/call/*`, reducer-name strings, positional arrays, local generated STDB types, manual bigint serialization, and handwritten cache aliases.

### 8.5 Package publishing and migration are one workflow

The private npm/crate work is not complete when artifacts are merely published. Publishing must trigger or enable a repository migration step that updates consumers onto the generated contract surface and then proves the legacy surface is unused.

Recommended workflow:

```text
STDB/codegen change
      ↓
generate schema + application IR
      ↓
publish private crate/npm artifacts
      ↓
pin compatible versions in lumiere-v-1
      ↓
run pnpm migrate:contracts
      ↓
run pnpm migrate:contracts:check
      ↓
typecheck/lint/tests
      ↓
delete superseded legacy hooks/types/transports
      ↓
CI deny-list prevents regression
```

Package publication scripts should print the exact follow-up migration/check commands and CI should verify that the pinned package contract fingerprint matches the generated IR expected by the repository.

---

## 9. What changes from the previous branch objective

Remove or demote:

- api-server-owned dual-store `ResourceReadPlan` business semantics;
- direct frontend/API durable PG query paths;
- PG-side duplicated authorization/business filters;
- frontend features depending directly on generated STDB bindings/reducer names;
- handwritten feature transport wrappers/query-key conventions where generated equivalents exist;
- locally duplicated generated contract/type surfaces after package adoption;
- minute-only gateway limiting as the primary resilience strategy;
- transparent multi-layer retries for mutations.

Keep:

- generated PG schema/codecs;
- generated frontend contracts/services/hooks;
- private generated npm/crate distribution;
- organization-scoped durable placement;
- archive version + payload hash;
- compare-and-finalize eviction;
- bounded pagination;
- hydration manifests;
- PG TLS/pooling;
- transfer ledger;
- schema/codegen drift checks;
- Kong as ingress policy enforcement;
- application-level admission/load shedding for true operation cost.

---

## 10. Implementation phases

### Phase 0 — establish the production contract/IR boundary

- [ ] split structural schema IR from caller-facing application-contract IR;
- [ ] define stable named operations with typed input/output and `Query | Command | Subscription` classification;
- [ ] make public operations explicit rather than deriving CRUD automatically from every table/reducer;
- [ ] generate framework-neutral typed services;
- [ ] generate React Query hooks, query-key factories, invalidation helpers, and subscription adapters;
- [ ] centralize bigint/wire serialization, auth/session propagation, error normalization, and connection semantics in one transport boundary;
- [ ] add structural operation traffic-class/idempotency metadata for gateway/client/admission policy;
- [ ] publish generated contract types/services/hooks through the private npm package and generated Rust contract types through the private crate;
- [ ] keep codegen implementation and business logic in `lumiere-v-1`;
- [ ] migrate Sales as the representative proof domain;
- [ ] align durable-query metadata with the same application-contract source;
- [ ] add codegen drift tests.

**Exit gate:** Sales runs end-to-end through generated typed services/hooks, with no raw reducer/resource transport usage in Sales application code, no business rule is implemented outside STDB to access durable data, and every generated external operation has a traffic classification.

### Phase 0.5 — generated contract adoption and legacy transport removal

This phase migrates the existing frontend after the private npm/crate artifacts are available. It is deliberately script-driven so hundreds of call sites can move consistently and reviewers can distinguish mechanical migration from semantic changes.

#### 0.5.1 Package/version precondition

- [ ] publish/pin the private npm contract package version used by this branch;
- [ ] publish/pin the matching private Rust contract crate where consumed;
- [ ] record generated schema/application contract version or fingerprint;
- [ ] CI rejects incompatible npm/crate/IR combinations;
- [ ] migration does not start until generated exports compile independently.

#### 0.5.2 Add repo-local codemods

Create a dedicated migration surface such as:

```text
scripts/migrate-contracts/
  index.ts
  manifest.ts
  transforms/
    imports.ts
    query-hooks.ts
    command-hooks.ts
    reducer-args.ts
    query-keys.ts
    generated-types.ts
    transport.ts
  checks/
    legacy-usage.ts
```

Expose deterministic commands:

```bash
pnpm migrate:contracts
pnpm migrate:contracts:check
```

Requirements:

- [ ] scripts are idempotent;
- [ ] transforms use generated migration metadata/application IR rather than guessing domain semantics;
- [ ] `--check` performs no writes and exits non-zero when migration work remains;
- [ ] ambiguous transformations are reported as explicit TODO/failures instead of silently changing behavior;
- [ ] generated files are never hand-edited by the migration scripts.

#### 0.5.3 Mechanical frontend transformations

Migrate, where an application-contract mapping exists:

- [ ] local/generated type imports → private package contract imports;
- [ ] `useStdbQuery(...)` → generated domain query hooks/services;
- [ ] `useStdbReducer(...)` → generated command hooks/services;
- [ ] `queryStdbList(...)` / equivalent generic list wrappers → generated query operations;
- [ ] raw reducer-name strings → stable generated operation identifiers hidden behind SDK exports;
- [ ] positional reducer arrays → generated named object inputs;
- [ ] `/api/query/*` and `/api/call/*` application usage → generated service transport;
- [ ] handwritten query keys → generated query-key factories;
- [ ] handwritten mutation invalidation aliases → generated invalidation metadata;
- [ ] duplicate bigint/wire conversion → shared generated transport serializer;
- [ ] feature-local subscription adapters → generated subscription bindings where supported.

Example:

```ts
// before
const orders = useStdbQuery("sale-orders", organizationId);
const confirm = useStdbReducer("confirm_sale_order");
confirm.mutate([organizationId, orderId]);

// after
const orders = useSaleOrders({ organizationId });
const confirm = useConfirmSaleOrder();
confirm.mutate({ organizationId, orderId });
```

#### 0.5.4 Verification before deletion

Run at minimum:

```bash
pnpm migrate:contracts:check
pnpm typecheck
pnpm lint
pnpm test
```

Plus domain/runtime tests for migrated query, command, subscription, cache invalidation, auth/session propagation, and retry/reconnect behavior.

- [ ] compare representative before/after query payloads and reducer inputs;
- [ ] verify React Query cache identity remains deterministic;
- [ ] verify generated invalidation refreshes the same required resource surfaces;
- [ ] verify no organization/company scope is lost during object-input migration;
- [ ] verify offline/realtime compatibility adapters continue to work until their dedicated migration lands;
- [ ] verify generated hooks do not introduce unbounded retries/refetch/reconnect storms.

#### 0.5.5 CI legacy deny-list

After a legacy surface is migrated, add repository checks preventing it from returning. Initial deny-list candidates:

```text
useStdbQuery(
useStdbReducer(
queryStdbList(
/api/query/
/api/call/
raw reducer string dispatch
local generated STDB contract type imports
```

Allow exceptions only in explicitly named compatibility/transport implementation files. Exceptions must be finite and removed as the associated migration completes.

#### 0.5.6 Delete superseded frontend infrastructure

Only after `migrate:contracts:check` is clean and tests pass:

- [ ] delete superseded generic query/reducer hooks;
- [ ] delete duplicated local generated contract types;
- [ ] delete obsolete reducer/resource string constants;
- [ ] delete redundant cache-key/invalidation manifests;
- [ ] delete transport wrappers replaced by the generated SDK;
- [ ] retain only compatibility surfaces still required by explicitly tracked migration work.

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
- [ ] expose the operation through the generated SDK rather than a direct durable endpoint;
- [ ] enforce durable-read admission/pagination/time/result bounds;
- [ ] verify org/company/field policy cannot be bypassed;
- [ ] verify one-PG deployment behavior remains simple.

### Phase 3 — prove mutable rehydration

Use one mutable transactional resource:

- [ ] STDB procedure determines hydration need;
- [ ] fetch durable row through tenant-resolved gateway;
- [ ] validate row/version/org in a fresh STDB transaction;
- [ ] call hydration reducer/helper;
- [ ] call existing business reducer;
- [ ] generated command hook/service invokes the stable application operation, not the hydration transport directly;
- [ ] ensure mutation retry/idempotency semantics are explicit;
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
- moving business logic into Postgres, the api-server, Kong, or generated packages;
- using Kong as the only DDoS/resilience layer;
- reducers directly performing external I/O.

---

## 12. Required tests

At minimum:

1. application-contract IR exposes only explicitly approved STDB operations;
2. generated service input/output types match Rust-generated STDB bindings;
3. generated React Query hooks and framework-neutral services resolve the same stable operation identifiers;
4. mutation invalidation metadata produces deterministic query-key invalidation;
5. wire serialization/deserialization is centralized;
6. a representative frontend domain contains no direct reducer-name/resource-URL transport calls after migration;
7. traffic classes/idempotency metadata exist for externally callable generated operations;
8. burst/reconnect/refetch storms remain bounded by gateway/client/admission policy;
9. durable queries can only be produced after STDB-owned authorization/scope resolution;
10. durable gateway rejects unknown/unplaced organizations;
11. durable gateway cannot accept caller-selected PG stores;
12. org A cannot query org B durable data even when resource/PK values collide;
13. field-level policy from STDB is preserved in the durable contract;
14. pagination/order are deterministic across hot/durable boundaries;
15. no external HTTP call occurs while an STDB transaction is held open;
16. hydration rejects organization/version mismatch;
17. normal business reducers remain unchanged by durable storage topology;
18. archive finalize still rejects stale versions;
19. one-PG deployment works without special-case application code;
20. two configured PG stores can host separate test organizations without cross-store access;
21. codegen drift CI fails when generated private-package artifacts no longer match the committed STDB contract source;
22. overload returns bounded 429/503 outcomes instead of unbounded queue growth;
23. mutation retries are never transparently amplified across multiple layers.

---

## 13. Acceptance criteria

This branch is complete when:

- SpacetimeDB remains the only business-logic boundary;
- reducers remain the only implementation of state-changing business commands;
- views/subscriptions remain the normal active-state read surface;
- application callers consume stable generated operation contracts instead of raw STDB binding/reducer details;
- private npm/crate artifacts contain generated output only;
- frontend consumers are migrated through repeatable codemods and legacy transport/types are removed;
- client-provided audit metadata cannot establish actor/org/role/permission/session identity;
- external operations have traffic classifications and bounded retry behavior;
- Kong and application admission controls can shed excess load before STDB/PG/workers saturate;
- procedures are used only where external durable I/O is required;
- durable query authorization/planning is STDB-owned;
- Postgres executes generated, bounded, already-authorized durable contracts only;
- organization onboarding establishes PG placement;
- schema/codegen identifies organization-scoped durable resources without embedding topology;
- broader scaling remains outside this branch.
