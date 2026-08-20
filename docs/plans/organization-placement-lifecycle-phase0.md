# Phase 0 — Organization execution boundary, lifecycle, and placement

**Status:** Proposed — 2026-08-20
**Role:** prerequisite foundation for the production-contract, durable-storage, regional-cell, payment-provider, offline/disconnected, and reactivation work
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [organization-onboarding-workflow-subagent-plan.md](./organization-onboarding-workflow-subagent-plan.md) · [audit-auth-operation-context-plan.md](./audit-auth-operation-context-plan.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Decision

Make the organization the first-class execution, placement, lifecycle, migration, and retention boundary before extending the contract IR, durable Postgres path, frontend surfaces, payment integrations, or regional infrastructure.

The immediate deployment can remain one SpacetimeDB instance + one Postgres database. Phase 0 introduces the stable organization abstractions so later movement to regional cells, disconnected installations, tenant restore/reactivation, and provider-specific integrations does not require another tenant-model rewrite.

```text
Organization
    │
    ▼
OrganizationPlacement
    ├── logical cell
    ├── placement generation
    ├── durable store
    └── lifecycle state
            │
            ▼
     Execution boundary
       STDB + durable PG
```

The physical topology is deliberately abstract. `CellId("primary-eu")` may initially represent the only deployment.

---

## 2. Why this precedes the existing contract work

The generated application-contract IR, durable gateway, admission control, audit context, onboarding workflow, payments, and future regional distribution all need to answer the same questions consistently:

- which organization owns this operation/data;
- where that organization executes;
- which durable store owns its retained history;
- which placement generation is authoritative;
- whether the organization is active, suspended, archived, or being reactivated;
- whether a stale client/worker is acting against an old placement;
- which migration/backfill path is required before an old organization can execute current contracts.

Without this boundary, later systems risk encoding different versions of tenant placement and lifecycle.

---

## 3. Canonical organization lifecycle

Define lifecycle independently from billing-provider state and physical infrastructure.

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

1. `Active` means normal business execution is permitted after ordinary authorization.
2. `GracePeriod` is an entitlement/billing policy state, not immediate data deletion.
3. `Suspended` prevents ordinary execution according to policy but preserves durable data and audit history.
4. `Archived` means the organization is not actively resident but remains recoverable under retention policy.
5. `Reactivating` is an explicit migration/backfill/validation workflow, not a direct status flip.
6. Billing/provider callbacks must never directly delete tenant data or bypass lifecycle reducers.
7. Lifecycle transitions remain STDB-owned business transitions and are audited.

Payment status may *cause an authorized lifecycle command*, but payment-provider state is not itself the organization lifecycle source of truth.

---

## 4. Canonical placement model

Introduce one authoritative placement record:

```rust
pub struct OrganizationPlacement {
    pub organization_id: OrganizationId,
    pub cell_id: CellId,
    pub generation: PlacementGeneration,
    pub durable_store_id: DurableStoreId,
}
```

Optional operational metadata may include placement status/checkpoint identifiers, but physical hostnames, PG URLs, credentials, and provider-specific infrastructure identifiers do not belong in application/schema IR.

Initial deployment:

```text
all organizations
      ↓
CellId("primary-eu")
      ↓
STDB primary + DurableStoreId("pg-primary")
```

Later deployments may resolve different cells without changing application contracts.

---

## 5. Placement generation

Treat placement generation as a fencing token for migration, restore, and reactivation.

```text
org generation 17
      ↓
checkpoint / copy / migrate
      ↓
validate
      ↓
placement generation 18
      ↓
routing flip
```

Rules:

- every authoritative organization placement has one monotonically increasing generation;
- background workers and migration/finalization commands carry the expected generation where stale execution is dangerous;
- a stale generation cannot finalize a move, archive deletion, durable restore, or other placement-sensitive side effect;
- generation is server-derived/verified, never caller-selectable;
- generation changes are audited with causation/correlation IDs.

This is the primary split-brain/fencing primitive for future cell movement.

---

## 6. Resolver boundary

Generalize the current durable-store-only resolver into an organization execution resolver while keeping infrastructure details internal.

Conceptual interface:

```rust
pub trait OrganizationPlacementResolver {
    fn resolve(
        &self,
        organization_id: OrganizationId,
    ) -> Result<ResolvedOrganizationPlacement>;
}

pub struct ResolvedOrganizationPlacement {
    pub organization_id: OrganizationId,
    pub cell_id: CellId,
    pub generation: PlacementGeneration,
    pub lifecycle: OrganizationLifecycle,
    pub durable_store: DurableStoreHandle,
}
```

Do not make callers choose `cell_id`, `generation`, or `durable_store`.

The first implementation may always resolve the same physical STDB/PG deployment. The abstraction exists to centralize future decisions, not to introduce distributed infrastructure now.

---

## 7. Reactivation and dormant-organization recovery

Reactivation is a first-class workflow:

```text
customer re-entitled / re-onboards
      ↓
organization → Reactivating
      ↓
locate latest durable snapshot/history
      ↓
resolve source schema/contract version
      ↓
run migrations + backfills
      ↓
validate counts/hashes/invariants
      ↓
assign/increment placement generation
      ↓
hydrate required hot working set
      ↓
organization → Active
```

Requirements:

- migration/backfill is deterministic and resumable;
- old organizations may skip multiple schema/application generations safely;
- migrations are version-addressed rather than assuming the previous deployment version;
- business invariants are verified before activation;
- failure leaves the organization recoverable in `Reactivating` or rolls back placement without exposing partially migrated state;
- reactivation does not require the old STDB instance to still exist when durable recovery data is sufficient.

---

## 8. Organization snapshot/migration manifest

Define a versioned organization recovery manifest sufficient to inspect and migrate dormant tenants.

Conceptual shape:

```rust
pub struct OrganizationDataManifest {
    pub organization_id: OrganizationId,
    pub placement_generation: PlacementGeneration,
    pub schema_version: SchemaVersion,
    pub application_contract_version: ContractVersion,
    pub durable_projection_version: ProjectionVersion,
    pub snapshot_id: SnapshotId,
    pub created_at: Timestamp,
}
```

The manifest is metadata; it does not move business logic into infrastructure.

Migration tooling should be able to determine:

```text
source version
   ↓
required migration chain
   ↓
target version
```

without depending on frontend code or handwritten one-off tenant knowledge.

---

## 9. Future cell model — shape now, do not deploy now

A `Cell` is a logical execution unit capable of hosting one or more organizations:

```text
Cell
  ├── STDB execution endpoint
  ├── durable PG placement
  ├── local workers
  ├── integration inbox/outbox
  └── operational capability metadata
```

Phase 0 only needs enough type/routing structure so `primary-eu` is a valid cell.

Explicitly defer:

- automatic regional placement;
- cross-region routing;
- STDB horizontal scaling;
- autonomous cell synchronization;
- customer-hosted/offline cell deployment;
- automatic tenant migration between cells.

Those become later decisions once latency, workload, and operational measurements exist.

---

## 10. Payment/integration readiness

Do not implement MoMo/payment architecture in this phase, but ensure organization placement does not make it harder later.

Every external-provider operation should be able to resolve:

```text
organization
   ↓
authoritative lifecycle + placement generation
   ↓
cell/integration capability
   ↓
provider adapter / inbox / outbox
```

Provider callbacks must not select organization placement from untrusted payload data. Provider account/merchant mappings resolve to an authoritative organization inside the server boundary.

This same model should support MTN MoMo, Orange Money, M-Pesa, Airtel Money, banks, tax/e-invoicing systems, email/SMS, and future provider adapters.

---

## 11. Auth, audit, and admission integration

Trusted operation context should include or resolve the current placement generation when a placement-sensitive operation executes.

Audit should be able to correlate:

```text
organization_id
placement_generation
operation_id
correlation_id
contract_operation
lifecycle transition
```

Admission control uses server-derived organization identity. A client must never select a different cell or quota bucket by submitting placement metadata.

---

## 12. Phase 0 implementation tasks

### 0.1 Inventory current organization assumptions

- [ ] inventory every organization/tenant identifier type and authoritative table;
- [ ] inventory current onboarding/provisioning state;
- [ ] inventory direct assumptions that one global STDB/PG exists;
- [ ] inventory workers/drainers that accept organization/store identifiers;
- [ ] inventory billing/subscription flags that currently affect tenant availability;
- [ ] inventory organization deletion/archive paths;
- [ ] inventory restore/backfill/migration tooling already present.

### 0.2 Define canonical types and state

- [ ] define `OrganizationLifecycle`;
- [ ] define `CellId` as a logical identifier;
- [ ] define `PlacementGeneration`;
- [ ] define canonical `OrganizationPlacement`;
- [ ] define one authoritative placement/lifecycle lookup path;
- [ ] make `primary-eu` / `pg-primary` the initial default mapping without special-case application behavior.

### 0.3 Centralize placement resolution

- [ ] introduce `OrganizationPlacementResolver`;
- [ ] adapt `TenantStoreResolver` behind/into the organization resolver;
- [ ] reject caller-provided cell/store/generation overrides;
- [ ] route durable infrastructure through resolved organization placement;
- [ ] preserve current one-STDB/one-PG deployment behavior.

### 0.4 Add lifecycle transition invariants

- [ ] encode allowed lifecycle transitions server-side;
- [ ] separate billing entitlement from deletion/retention;
- [ ] make suspension/archive/reactivation auditable;
- [ ] prevent ordinary mutations while lifecycle policy disallows them;
- [ ] ensure system/recovery operations have explicit privileged paths rather than bypasses.

### 0.5 Add generation fencing

- [ ] increment generation on authoritative placement/restore cutover;
- [ ] require expected generation on placement-sensitive finalization operations;
- [ ] reject stale workers/migrations/finalizers;
- [ ] add concurrency tests around generation flips.

### 0.6 Define reactivation manifest and dry-run migration

- [ ] define `OrganizationDataManifest`;
- [ ] record schema/contract/projection versions needed for recovery;
- [ ] implement a dry-run planner that reports required migrations/backfills without applying them;
- [ ] prove one synthetic dormant organization can be planned from an older version to current;
- [ ] do not build automatic cross-cell migration yet.

---

## 13. Phase 0 exit gate

Do not proceed with the existing contract/durable phases until:

1. there is one canonical organization lifecycle model;
2. there is one authoritative `OrganizationPlacement` model;
3. all physical durable-store selection resolves from server-side organization placement;
4. the initial one-cell deployment works with no caller-visible topology;
5. placement generation can fence stale placement-sensitive work;
6. billing suspension cannot accidentally become destructive data deletion;
7. reactivation has a versioned migration/backfill manifest and dry-run path;
8. organization placement/lifecycle changes are auditable;
9. application-contract/schema IR can reference organization scope without embedding physical cell/store topology;
10. later regional/disconnected/payment work can consume the same organization boundary without changing its core semantics.

---

## 14. Required tests

1. callers cannot choose `cell_id`, `durable_store_id`, or placement generation;
2. org A cannot resolve org B placement;
3. stale placement generation cannot finalize a migration/archive/restore action;
4. lifecycle transition rules reject invalid transitions;
5. `Suspended` preserves durable recovery data;
6. `Archived` remains recoverable according to retention policy;
7. reactivation refuses activation until migrations/backfills/invariant checks succeed;
8. one-cell/one-PG deployment requires no topology branching in ordinary application code;
9. audit captures placement/lifecycle transitions with trusted organization identity;
10. a synthetic old-version organization produces a deterministic migration plan to the current target.

---

## 15. Explicitly out of scope for Phase 0

- deploying West/East Africa cells;
- automatic cell placement;
- STDB horizontal scaling;
- cross-cell replication;
- customer-hosted autonomous cells;
- full MoMo/payment-provider implementation;
- provider-specific callback schemas;
- automatic subscription billing enforcement;
- automated tenant migration/cutover;
- deleting dormant customer data outside an explicit retention policy.
