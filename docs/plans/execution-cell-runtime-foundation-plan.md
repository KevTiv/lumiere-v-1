# Execution-cell runtime and fleet-foundation plan

**Status:** Proposed — 2026-08-24  
**Tracks:** `organization-placement`, `execution-cell`, `module-release`, `runtime-contract`, `working-set`, `durable-convergence`, `cell-migration`, `subscription-bootstrap`, `future-horizontal-scaling`  
**Extends:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [scaleway-cloudflare-bootstrap-deployment-plan.md](./scaleway-cloudflare-bootstrap-deployment-plan.md) · [regional-stdb-scaleway-durable-foundation.md](./regional-stdb-scaleway-durable-foundation.md) · [subscription-query-ir-codegen-plan.md](./subscription-query-ir-codegen-plan.md)

---

## 1. Decision

Finish the current Lumière architecture as the implementation of **one well-defined schedulable execution cell**, even though initial production physically uses only one STDB deployment.

The near-term topology remains intentionally small:

```text
Cloudflare
   ↓
Kong / trusted API boundary
   ↓
OrganizationPlacementResolver
   ↓
cell-paris-01
   ├── STDB host
   ├── Lumière module release
   ├── hot organization working sets
   ├── indexes / projections
   └── realtime subscriptions
   ↓
Scaleway Managed PostgreSQL
```

The architectural twist is that callers, durable convergence, module versioning, activation/hydration, and subscriptions must not depend on `cell-paris-01` being permanent.

The future fleet may become:

```text
                     control plane
               OrganizationPlacement
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   cell-paris-01   cell-paris-02   cell-nairobi-01
        │               │               │
        └───────────────┬┴───────────────┘
                        ▼
                 durable convergence
                        │
                        ▼
               partitioned Postgres
```

This plan does **not** build an autoscheduler, Kubernetes control plane, active-active STDB, or transparent distributed database. It establishes the contracts that make those future choices possible without rewriting ERP behavior.

---

## 2. Core invariants

1. **Organization is the schedulable ownership/placement unit.** This does not require one physical STDB database per organization today.
2. **One authoritative execution cell owns an organization at a time.**
3. **All STDB callers resolve current organization placement.** No application surface treats one STDB URL as the permanent topology contract.
4. **Placement generation fences stale ownership.**
5. **An execution cell runs a versioned immutable Lumière module release/runtime contract.**
6. **Module artifact/version and physical cell are separate concepts.** The same release may run on multiple cells.
7. **Postgres is fleet-level durable convergence/history/recovery storage.** Durable records are independent of which cell emitted them.
8. **Hydration/working-set reconstruction is the primitive for cold-row activation, organization reactivation, migration, and recovery.**
9. **Rebuildable state is rebuilt rather than unnecessarily migrated.**
10. **Subscription contracts are logical-resource contracts, not physical-cell contracts.**
11. **Workers, agents, imports, API calls, and client bootstrap all use the same placement boundary.**
12. **No automatic scheduling or dynamic sharding is required for the first production release.** Manual placement is a valid first control plane.

---

## 3. First-class `ExecutionCell`

Introduce a small server-controlled runtime record conceptually like:

```rust
pub struct ExecutionCell {
    pub id: CellId,
    pub region: RegionId,
    pub status: CellStatus,
    pub capacity_class: CapacityClass,
    pub module_release: ModuleReleaseId,
    pub runtime_contract_version: RuntimeContractVersion,
}
```

The initial environment may contain exactly one:

```text
cell-paris-01
region = fr-par
status = active
capacity = bootstrap
```

This is not a scheduler. It exists to prevent physical deployment assumptions from leaking into application code.

### 3.1 `OrganizationPlacement`

Extend canonical placement conceptually to bind an organization to a cell **and compatible runtime release**:

```rust
pub struct OrganizationPlacement {
    pub organization_id: OrganizationId,
    pub cell_id: CellId,
    pub generation: PlacementGeneration,
    pub lifecycle: OrganizationLifecycle,
    pub durable_store: DurableStoreId,
    pub module_release: ModuleReleaseId,
    pub runtime_contract_version: RuntimeContractVersion,
}
```

Whether `module_release` is stored directly or resolved through the cell is an implementation detail. The invariant is that the active combination is explicit and compatibility-checked.

Callers never provide these values as authority.

---

## 4. Immutable `ModuleRelease`

Treat the deployable Lumière STDB workload as a versioned release artifact rather than an implicit build output.

Conceptually:

```text
LumièreModuleRelease
├── module.wasm
├── schema manifest/version
├── reducer manifest
├── application operation manifest
├── read/write-set manifest
├── access-path manifest
├── subscription descriptors
├── projection descriptors
├── hot-retention descriptors
├── working-set descriptors
├── durable codec/schema version
└── compatibility metadata
```

The package may physically remain an OCI/container build context plus generated contract artifacts. The important property is **immutable identity and reproducibility**, not introducing a new registry prematurely.

A cell says:

```text
I run ModuleRelease R42 / RuntimeContract V42
```

rather than merely “I run whatever was last deployed.”

### 4.1 Release compatibility

Deployment/startup should fail closed when incompatible combinations are detected among:

```text
module release
runtime contract
PG durable schema
codec version
frontend/generated contract compatibility window
```

This extends the release-set compatibility rule already present in the deployment plan.

---

## 5. Converged runtime contract

The existing IR/codegen plans should logically converge into one versioned **runtime contract**, even if emitted as several files/packages.

It includes structural metadata for:

```text
schema / resources
operations
read sets
write sets
access paths
subscription descriptors
projection descriptors
hot-retention descriptors
working-set descriptors
traffic/admission classes
durable codecs / durable read descriptors
```

The runtime contract contains no ERP business formulas, Casbin role assignments, physical SQL strings, or deployment credentials.

Its purpose is to make these statements mechanically checkable:

```text
cell supports runtime contract V42
PG supports durable contract V42
frontend SDK is compatible with V42
organization placement targets a compatible cell
```

---

## 6. `WorkingSetDescriptor`

Add a structural complement to `HotRetentionDescriptor` describing what must become resident when an organization/cell is activated or reconstructed.

Illustrative model:

```ts
interface WorkingSetDescriptor {
  resource: ResourceKey
  source:
    | "always"
    | "active-state"
    | "time-window"
    | "projection"
    | "dependency"
    | "pg-only"

  requiredForActivation: boolean
  statePredicate?: StatePredicateKey
  timeField?: FieldKey
  timeWindow?: DurationClass
  rebuildProjection?: ProjectionKey
  dependencies?: readonly ResourceKey[]
}
```

`HotRetentionDescriptor` answers:

```text
When is this resident row safe to cool?
```

`WorkingSetDescriptor` answers:

```text
What must be loaded/rebuilt to make this organization operational on a cell?
```

Together they define the STDB working-set lifecycle.

### 6.1 Representative classes

```text
organization/company config       → always
membership/RBAC active state      → always
current stock quantities          → always/current
open invoices                     → active-state
active sale/purchase orders       → active-state
closed orders                     → bounded recent window or PG-only
hot operational projections       → rebuild projection
old audit/usage/history           → PG-only
```

Exact classifications require domain review and generated validation; this plan does not hard-code those examples as business rules.

---

## 7. Four state classes for cell movement/restart

Every STDB resource should ultimately be classifiable as one of:

```text
A. canonical hot state
   hydrate/migrate when required

B. rebuildable hot projection
   rebuild on destination

C. ephemeral runtime state
   discard and reconnect/recreate

D. durable/history state
   remain PG-only
```

Examples:

```text
open SaleOrder                  → A
WarehouseProductAvailability   → B
websocket/subscription session → C
old audit history              → D
```

This prevents organization movement from degenerating into “copy every row from the old cell.”

---

## 8. Hydration becomes the migration primitive

Keep one data contract for:

```text
cold-row hydration
resource working-set hydration
organization activation
organization cell migration
disaster recovery reconstruction
```

Different orchestration may call it, but durable identity/version validation, tenant isolation, codec handling, and idempotency must be shared.

Target flow:

```text
PG snapshot + durable head
        ↓
resolve WorkingSetDescriptor graph
        ↓
hydrate canonical required state
        ↓
rebuild approved projections
        ↓
verify invariants / hashes / counts
        ↓
cell ready for placement
```

Do not create a separate bespoke migration data format when the durable/hydration contract can serve both purposes.

---

## 9. Fleet-level durable convergence

Postgres should not depend on a permanent source cell.

Durable records/manifests must continue to carry enough identity such as:

```text
organization_id
placement_generation
commit_sequence
module/runtime-contract version
resource durable identity/version
```

This supports:

```text
cell A generation N
     ↓
Postgres durable head
     ↓
cell B generation N+1
```

without treating PG as a second business engine.

PG remains partition-aware durable history/recovery storage. STDB remains business/state-transition authority.

---

## 10. Placement-aware callers

The following surfaces must resolve placement rather than retain a permanent STDB endpoint assumption:

```text
frontend bootstrap
API/reducer forwarding
subscriptions/realtime reconnect
background workers
imports/onboarding jobs
AI/agent ERP capability calls
maintenance operators
recovery/migration tooling
```

A trusted internal API may cache placement briefly, but the cache must be generation-aware and stale placement must fail/re-resolve rather than silently target an old cell.

### 10.1 Client bootstrap

Target:

```text
client auth + org
      ↓
trusted bootstrap
      ↓
OrganizationPlacementResolver
      ↓
cell endpoint + placement generation + compatible contract metadata
      ↓
client connects/subscribes
```

The client receives connection metadata, not placement authority.

### 10.2 Workers

Jobs should carry logical organization/operation identity, not a fixed STDB endpoint:

```text
job(org, operation)
      ↓
worker resolves placement
      ↓
current authoritative cell
```

---

## 11. Subscription/reconnect implications

Generated subscriptions remain logical resource descriptors:

```text
subscribe("sale-orders")
```

not:

```text
subscribe("cell-paris-01/sale-orders")
```

On placement generation change:

```text
old connection invalid/fenced
        ↓
client resolves placement
        ↓
reconnect to new cell
        ↓
recreate same generated subscription contract
```

Therefore the subscription performance plan's work on initial result cardinality, fanout, reconnect class, and staggered reconnect becomes part of migration correctness as well as performance.

A cell-movement load fixture should explicitly include reconnect/hydration pressure.

---

## 12. Manual placement before scheduling

Do **not** build automatic scheduling now.

Initial control-plane operation may be as simple as an operator-controlled placement record.

Later a trusted operation can conceptually support:

```text
move_org(org_id, target_cell)
```

with orchestration:

```text
1. stop/fence new ownership-sensitive work
2. reach/verify durable checkpoint
3. prepare target runtime/module compatibility
4. resolve + hydrate target working set
5. rebuild projections
6. validate tenant/version/hash invariants
7. increment placement generation
8. atomically flip placement
9. reconnect clients/workers
10. fence old generation
```

This is sufficient to prove horizontal placement architecture without implementing bin-packing or autoscaling.

---

## 13. First second-cell proof

After current cold-tier/access-path/subscription/performance work is green, run one deliberate proof:

```text
cell-paris-01
  org-test
      ↓
PG durable checkpoint
      ↓
cell-paris-02
  hydrate required working set
  rebuild projections
      ↓
verify
      ↓
placement generation N → N+1
      ↓
client reconnect
      ↓
old cell fenced
```

Required assertions:

- no application-contract/frontend rewrite;
- no caller-selected target store/cell;
- same logical generated subscription contracts work after reconnect;
- workers resolve the new cell;
- old generation cannot accept authoritative writes;
- PG durable history remains continuous across source-cell change;
- target does not need irrelevant PG-only history loaded into STDB;
- rebuildable projections are rebuilt rather than copied blindly.

This is the first **horizontal scaling correctness proof**, not an availability/SLO claim.

---

## 14. Implementation phases

### EC-0 — control-plane vocabulary

- [ ] define `ExecutionCell`, `CellStatus`, `RegionId`, and `CapacityClass` structural types;
- [ ] extend/resolve `OrganizationPlacement` against an `ExecutionCell`;
- [ ] introduce `ModuleReleaseId` and `RuntimeContractVersion`;
- [ ] ensure all values are server-controlled;
- [ ] model only `cell-paris-01` initially.

### EC-1 — immutable release contract

- [ ] define the `ModuleRelease` manifest/bundle boundary;
- [ ] bind STDB WASM, generated manifests, durable codec/schema version, and compatibility metadata;
- [ ] expose release/runtime contract versions in health/operator diagnostics;
- [ ] fail deployment/startup on unsupported compatibility combinations;
- [ ] keep generated business contracts in existing private npm/crate distribution paths rather than creating another source of truth.

### EC-2 — working-set contract

- [ ] add `WorkingSetDescriptor` / equivalent structural metadata;
- [ ] derive/review descriptors alongside `HotRetentionDescriptor`;
- [ ] classify representative always/active-window/projection/PG-only resources;
- [ ] validate coolable resources and activation requirements do not conflict;
- [ ] generate working-set reconstruction manifests/plans.

### EC-3 — placement-aware callers

- [ ] frontend bootstrap resolves placement;
- [ ] API/reducer forwarding resolves placement;
- [ ] subscription reconnect resolves placement generation;
- [ ] workers/imports/agent capability calls resolve placement;
- [ ] eliminate permanent STDB endpoint assumptions from supported application paths;
- [ ] add stale-generation retry/re-resolve tests without retry amplification.

### EC-4 — generic organization activation

- [ ] reuse durable snapshot/change/hydration contracts;
- [ ] hydrate canonical required state only;
- [ ] rebuild projections;
- [ ] leave PG-only history cold;
- [ ] validate organization/generation/module/schema/version compatibility;
- [ ] produce activation metrics and deterministic verification output.

### EC-5 — second-cell correctness proof

- [ ] provision/configure one synthetic second STDB execution cell;
- [ ] assign compatible `ModuleRelease`;
- [ ] move one test organization manually through durable checkpoint → activation → verification → generation flip;
- [ ] verify clients reconnect through bootstrap and generated subscriptions;
- [ ] verify workers follow placement;
- [ ] verify old generation fencing;
- [ ] verify durable history continuity and tenant isolation.

### EC-6 — future only after evidence

Possible later work, deliberately not part of the current implementation:

```text
capacity-aware placement
cell health registration
automated drain/move
scale-to-zero
regional placement
dedicated large-tenant cells
fleet autoscaling
```

Each should build on the same placement/release/working-set primitives rather than changing ERP contracts.

---

## 15. CI / validation additions

Fail or block release when:

```text
placement targets unknown/incompatible cell
cell release/runtime contract is incompatible with PG durable schema
working-set resource has no hydration/rebuild source
coolable canonical state is required for activation but cannot be reconstructed
caller path bypasses placement resolution
subscription bootstrap embeds a physical cell as contract identity
worker/job embeds permanent STDB endpoint
migration attempts placement flip before target verification/durable checkpoint
old generation can still perform authoritative work after flip
```

Warnings/observability should surface:

```text
cell resident memory / hot bytes
org working-set size
module release per cell
contract version drift
placement distribution
activation/hydration duration
projection rebuild duration
reconnect initial-result/fanout load
```

---

## 16. Explicit non-goals

- Kubernetes;
- automatic bin-packing/scheduling;
- active-active STDB ownership;
- transparent horizontal sharding inside one organization;
- one physical STDB process/database per org as an immediate requirement;
- automatic regional failover;
- service-mesh introduction;
- moving ERP rules into the control plane;
- using Postgres as mutation/business-logic authority;
- duplicating application-contract IR in deployment manifests;
- copying all durable history into STDB during activation;
- creating a bespoke migration data model when hydration/recovery contracts already suffice.

---

## 17. Exit criteria

This foundation is complete when:

1. initial production is explicitly represented as `cell-paris-01`, not a permanent unnamed singleton STDB topology;
2. every organization placement resolves to one authoritative compatible execution cell;
3. Lumière STDB deployment has an immutable/versioned `ModuleRelease` + runtime contract identity;
4. existing IR/codegen outputs participate in one logical runtime compatibility contract;
5. hot-retention and working-set reconstruction are complementary and mechanically validated;
6. canonical/rebuildable/ephemeral/PG-only state classes are explicit enough to reconstruct an organization without loading full history;
7. frontend/API/subscriptions/workers/agents use placement rather than permanent STDB endpoints;
8. PG durable history remains independent of source-cell identity and continuous across generation movement;
9. one second-cell organization movement passes checkpoint/hydration/rebuild/verification/generation-fencing/reconnect tests;
10. no autoscheduler or distributed-database rewrite is required to reach that proof.

---

## 18. Architectural rule

Adopt the following rule for Lumière V1:

> **Build and finish the current system as one complete execution-cell implementation. Keep organization placement, module/runtime-contract versioning, working-set reconstruction, durable convergence, and logical subscription/caller contracts independent of that cell so future horizontal scaling is a fleet-management evolution rather than an ERP rewrite.**
