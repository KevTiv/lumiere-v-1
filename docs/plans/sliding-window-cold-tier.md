# STDB-owned transactional core with durable Postgres projection

**Status:** Proposed — production-contract alignment 2026-08-20
**Tracks:** `organization-placement`, `contract-ir`, `generated-client-sdk`, `contract-migration`, `durable-postgres`, `tenant-onboarding`, `stdb-query-boundary`, `traffic-resilience`, `agent-capability-ir`, `analysis-shaping`, `scaleway-cloudflare-deployment`
**Related:** [scaleway-cloudflare-bootstrap-deployment-plan.md](./scaleway-cloudflare-bootstrap-deployment-plan.md) · [regional-stdb-scaleway-durable-foundation.md](./regional-stdb-scaleway-durable-foundation.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [audit-log-cold-by-default.md](./audit-log-cold-by-default.md) · [backup-recovery-followup.md](./backup-recovery-followup.md) · [offline-changeset-sync.md](./offline-changeset-sync.md) · [audit-auth-operation-context-plan.md](./audit-auth-operation-context-plan.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Decision

Keep SpacetimeDB as Lumiere's single business-logic and application-query authority. Postgres is a durable per-organization projection and historical store. Frontend/runtime callers consume generated typed application contracts rather than raw reducer names, positional payloads, transport URLs, handwritten cache keys, or locally duplicated generated types.

Before extending the durable or client contract paths, establish a canonical organization placement/lifecycle foundation. All later routing, durable-store selection, reactivation, regional STDB placement, migration, and recovery decisions must resolve through that single server-controlled tenant boundary.

The long-term deployment direction is one authoritative STDB execution cell per organization at a time, with Scaleway Postgres as the durable convergence/recovery layer. The current branch only lays the metadata/recovery foundation; it does not implement multi-region STDB or active-active replication.

The near-term production deployment is explicitly **Cloudflare global ingress → Scaleway Paris trusted runtime/STDB → Scaleway Managed PostgreSQL Paris**. All organizations may initially share the same logical Paris execution cell and managed PG placement while still resolving through `OrganizationPlacement` so later regional cells remain a routing/deployment change rather than an application rewrite.

The application-contract IR also becomes the source for generated harness-safe capability/tool descriptors. The AI harness, web, Expo, and future clients consume the same stable ERP operations. Casbin-style server policy remains the sole authorization authority; capability metadata is structural and never grants access by itself.

For analytical AI workflows, raw ERP query results are not the default model context. Large/bulk results remain server-side and are reduced through typed deterministic analysis plans before a compact result reaches the model. The model chooses authorized capabilities and analysis intent; trusted code performs bulk filtering, grouping, aggregation, comparison, and projection.

Traffic resilience is part of the contract boundary as well: generated operations carry structural traffic classification so Cloudflare/Kong and application admission control can apply bounded, server-authoritative rate/concurrency/retry policy without moving business logic into the edge or gateway.

```text
frontend / client / AI harness
      │
      ▼
Cloudflare global edge
      │
      ▼
private generated npm SDK + capability registry
      │
      ▼
Kong + server auth/admission boundary
      │
      ├── resolve actor/org
      ├── Casbin capability evaluation
      └── resolve OrganizationPlacement
      │
      ▼
SpacetimeDB Paris execution cell
      ├── reducers own mutations + business invariants
      ├── views/subscriptions own active read models
      └── ordered durable change/audit emission
                    │
                    ▼
          organization durable gateway
                    │
                    ▼
     Scaleway Managed PostgreSQL Paris
```

Reducers cannot perform network I/O. Durable reads therefore use an STDB procedure that resolves an already-authorized and bounded durable query contract inside STDB, closes the transaction, performs the durable fetch, and returns or hydrates the result through a fresh STDB transaction where required.

Initial production remains one logical execution cell + one STDB deployment + one managed Postgres database. The organization-placement model keeps later regional execution and migration possible without expanding this branch into a distributed-database project.

---

## 2. Non-negotiable invariants

1. **SpacetimeDB owns all business rules and state transitions.** Reducers remain the only implementation of state-changing business commands.
2. **One authoritative STDB execution cell owns an organization at a time.** Active-active STDB reconciliation is not assumed.
3. **Organization lifecycle, execution cell, placement generation, and durable-store placement are server-controlled runtime state.**
4. **Placement generation fences stale cells/routes during future migration/reactivation.**
5. **Generated contracts contain structural/application metadata, never business policy.**
6. **Casbin-style server policy is the single authorization authority for frontend and agent capabilities.**
7. **The AI harness never gains a parallel business API or trusted identity/permission model.**
8. **Frontend application code and harness code consume stable named operations instead of raw reducer names, resource URLs, positional argument arrays, or raw STDB binding details.**
9. **Raw bulk ERP results are not the default LLM context.** Analytical results are shaped server-side through validated typed plans first.
10. **AI/model/provider failure never blocks ordinary ERP workflows.**
11. **Migration scripts are generated/manifest-driven and idempotent.**
12. **Legacy transport/type APIs are temporary compatibility surfaces and are deleted after migration.**
13. **Postgres is durable convergence/history/recovery storage, not a second business engine.**
14. **The api-server/durable gateway does not independently compile business/resource policy.**
15. **STDB resolves organization/company scope, field policy, resource predicates, ordering, pagination, and hydration decisions before durable I/O.**
16. **Procedures are transport/orchestration only and must reuse STDB-owned business/query-policy logic.**
17. **No row leaves STDB until its exact durable version is verified on the resolved PG store.**
18. **Durable business transitions have a monotonic per-organization commit sequence and measurable PG durability watermark.**
19. **Audit explains who/why; canonical change records reconstruct what; snapshots bound replay cost.**
20. **All security-sensitive audit/admission identity is server-derived, never client-authored.**
21. **Every external operation has bounded rate, payload, timeout, and downstream concurrency policy.**
22. **Overload fails fast and locally through 429/503 shedding rather than cascading into STDB/PG/workers.**
23. **Mutation retries require explicit idempotency semantics; retries must not be amplified across client/gateway/service layers.**
24. **SQLite/offline clients queue intent and working sets; reconnect still crosses the STDB reducer boundary.**
25. **Saved skills/workflows never retain authorization; capability checks are re-evaluated at execution time.**
26. **Content-safety/prompt-safety models may filter/classify but never authorize ERP operations.**
27. **Cloudflare is edge/security/routing infrastructure, not a business-logic authority.**

---

## 3. Ownership model

```text
Cloudflare edge
────────────────────────────
DNS / TLS / WAF / DDoS
routing/bootstrap assistance
no ERP business policy

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
traffic class / idempotency
capability key / operation risk
confirmation metadata
result-shaping policy
presentation/file extension points
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
  capability/tool registry
  JSON-schema descriptors
  analysis-plan/result types

              │ calls
              ▼

Kong + auth + admission control
────────────────────────────
request bounds / rate limits
server-derived actor/org
Casbin capability evaluation
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

Durable gateway → Scaleway Managed PG
────────────────────────────
history / snapshots
migration + reactivation source
recovery manifests
managed backup / PITR / replication options

AI harness shaping runtime
────────────────────────────
provider-neutral tool adapter
typed dataset handles
validated AnalysisPlan
compact AnalysisResult
SSE model output
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

Initial deployment maps every organization to a logical Paris cell and managed PG store. Callers never supply cell/store/generation values.

---

## 5. STDB-owned durable query contract

A durable plan is produced only after STDB-owned policy resolution. The durable gateway resolves the organization's durable store from canonical placement; it never accepts a caller-selected PG target.

```text
client generated query
        ↓
Cloudflare / Kong / admission policy
        ↓
placement-resolved STDB procedure
        ↓
STDB transaction: auth + bounded durable plan
        ↓ transaction closes
procedure HTTP → durable gateway
        ↓
OrganizationPlacementResolver
        ↓
Scaleway Managed PG durable store
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

## 9. IR, codegen, private packages, harness tooling, and analysis shaping

The schema IR/application-contract IR split remains. IR identifies organization scope and operation semantics, but physical Cloudflare/Scaleway/cell/PG topology remains runtime placement/deployment state.

Application-contract IR should generate the same stable operations for ordinary clients and the AI harness. Add structural metadata sufficient to build a capability registry and choose result handling:

```rust
pub enum GeneratedOperationRisk {
    ReadOnly,
    Presentation,
    Draft,
    BusinessMutation,
    FinancialMutation,
}

pub struct GeneratedCapabilityDescriptor {
    pub operation: OperationName,
    pub input: GeneratedTypeRef,
    pub output: GeneratedTypeRef,
    pub required_capability: CapabilityKey,
    pub risk: GeneratedOperationRisk,
    pub requires_confirmation: bool,
    pub traffic: GeneratedOperationTrafficPolicy,
    pub analysis: Option<GeneratedAnalysisCapability>,
}
```

`required_capability` is a stable Casbin policy key; IR never emits role assignments or authorization policy. The server resolves trusted actor/org context, filters capability discovery for ergonomics, and re-authorizes every invocation.

Large analytical outputs should resolve to a server-side dataset/handle and validated declarative analysis plan rather than raw context injection:

```text
authorized source capability
        ↓
server-side typed dataset
        ↓
AnalysisPlan
 filter / project / group / aggregate / compare / top-N / timeseries
        ↓
compact AnalysisResult + provenance
        ↓
model interpretation
        ↓
presentation intent
```

Generated packages may expose provider-neutral tool descriptors/JSON schemas, `DatasetHandle`, `AnalysisPlan`, `AnalysisResult`, presentation capability descriptors, and organization-scoped file/content resource references. Raw bucket keys, arbitrary filesystem paths, SQL, reducer strings, arbitrary URLs, and arbitrary model-generated code are not harness tools.

Package publication and frontend codemod migration remain one workflow; legacy raw hooks/types/transports are removed after generated contract adoption.

See `agent-harness-capability-ir-foundation.md` for harness/result-shaping details and `scaleway-cloudflare-bootstrap-deployment-plan.md` for the first production topology.

---

## 10. Near-term deployment target

The current deployment work should converge on:

```text
Cloudflare
  DNS / TLS / WAF / DDoS
        ↓
Kong + trusted server boundary
        ↓
OrganizationPlacementResolver
        ↓
STDB Paris execution cell
        ↓
Scaleway Managed PostgreSQL Paris

AI requests:
Cloudflare → Paris AI harness → generated capabilities → shaping runtime → Scaleway Generative API
```

Required deployment properties:

- Cloudflare-origin hardening/trusted-proxy behavior is defined;
- STDB websocket connectivity works through the production ingress path;
- AI streaming uses HTTP/SSE rather than coupling token streams to STDB subscriptions;
- PG is managed on Scaleway and reached only from trusted infrastructure;
- AI/model/provider outages degrade AI only;
- per-org resource/AI/shaping costs are measurable;
- no client embeds the Paris endpoint as the permanent topology contract.

---

## 11. Implementation phases

### Phase 0 — organization placement, lifecycle, and recovery foundation

- [ ] define `OrganizationLifecycle`;
- [ ] define logical `CellId` and `PlacementGeneration`;
- [ ] define canonical `OrganizationPlacement`;
- [ ] create one trusted `OrganizationPlacementResolver`;
- [ ] map current organizations to one initial logical Paris cell + managed PG store without adding single-org paths;
- [ ] make onboarding create placement/lifecycle metadata server-side;
- [ ] define generation fencing semantics;
- [ ] define `OrgCommitSequence` and `DurableWatermark`;
- [ ] define canonical reducer change-record schema separate from audit metadata;
- [ ] define organization snapshot manifest;
- [ ] define reactivation manifest/migration references;
- [ ] make durable gateway resolve PG through canonical placement;
- [ ] add tests preventing caller-selected cell/generation/store;
- [ ] preserve one-STDB/one-managed-PG operation without feature-level special cases.

**Exit gate:** all tenant-aware infrastructure routes through one canonical organization placement/lifecycle model, and durable/audit metadata can later support ordered reconstruction without implementing multi-region STDB today.

### Phase 1 — production contract/IR + capability/analysis boundary

- [ ] split structural schema IR from caller-facing application-contract IR;
- [ ] define stable named operations and generated services/hooks;
- [ ] centralize serialization/auth/error/retry semantics;
- [ ] add traffic-class/idempotency metadata;
- [ ] add stable `CapabilityKey`, operation risk, confirmation, and result-policy metadata to explicitly approved operations;
- [ ] generate JSON-schema-compatible input/output descriptors;
- [ ] generate provider-neutral capability/tool registry artifacts;
- [ ] add server-side Casbin-backed capability filtering adapter;
- [ ] prove every tool invocation re-authorizes through trusted actor/org context;
- [ ] define generated `DatasetHandle`, `AnalysisPlan`, `AnalysisResult`, and provenance contracts;
- [ ] implement a minimal deterministic shaping engine for filter/project/group/aggregate/period comparison/top-N/timeseries;
- [ ] prove one accountant-style analysis reaches the model as a compact shaped result instead of raw rows;
- [ ] reserve typed presentation and file/content capability namespaces without adding raw storage access;
- [ ] publish private npm/crate artifacts;
- [ ] migrate Sales as representative domain;
- [ ] prove one read-only and one draft/proposal operation can be exposed through generated harness tooling;
- [ ] add codegen drift tests.

### Phase 1.5 — generated contract adoption and legacy transport removal

- [ ] run manifest-driven idempotent codemods;
- [ ] migrate generic query/reducer hooks and raw transport usage;
- [ ] enforce `migrate:contracts:check` and CI deny-list;
- [ ] delete superseded hooks/types/transports after verification;
- [ ] CI prevents harness code from dispatching raw reducer strings, raw SQL, or bypassing generated operations.

### Phase 2 — Scaleway + Cloudflare deployment readiness

- [ ] provision/configure Scaleway Managed PostgreSQL Paris;
- [ ] configure initial STDB Paris execution runtime;
- [ ] put public ingress behind Cloudflare;
- [ ] configure Kong trusted-proxy/origin-hardening rules;
- [ ] prove STDB websocket and AI SSE behavior through production ingress;
- [ ] deploy provider-neutral AI harness in Paris with Scaleway Generative API adapter;
- [ ] collect per-org infra/token/shaping metrics;
- [ ] run PG backup/PITR restore drill.

### Phase 3 — tenant-aware durable gateway

- [ ] consume `OrganizationPlacementResolver` rather than a separate durable-store-only resolver;
- [ ] reject unknown/unplaced or stale-generation organization context;
- [ ] resolve logical durable store internally;
- [ ] tenant-isolation tests.

### Phase 4 — prove durable read

Use `audit_log` first:

- [ ] STDB procedure authorizes bounded historical query;
- [ ] gateway executes generated contract against placement-resolved PG;
- [ ] expose through generated SDK;
- [ ] enforce pagination/time/result/admission bounds.

### Phase 5 — prove mutable rehydration

- [ ] determine hydration need in STDB;
- [ ] fetch from placement-resolved PG;
- [ ] validate organization/generation/version;
- [ ] hydrate idempotently;
- [ ] invoke existing reducer;
- [ ] explicit retry/idempotency semantics.

### Phase 6 — optional second logical cell/store correctness proof

- [ ] configure a second logical cell and/or PG store for tests;
- [ ] move one test organization using checkpoint → verify → generation increment → placement flip;
- [ ] prove stale generation is fenced;
- [ ] prove no cross-org/cross-store leakage.

This is a correctness proof, not an autoscaling or active-active project.

---

## 12. Explicitly out of scope

- active-active STDB across regions;
- automatic STDB tenant sharding;
- automatic African cell placement;
- automatic live cell migration;
- Kubernetes topology;
- PG read replicas/topology implementation beyond selected Scaleway managed-service configuration;
- automatic PG shard balancing;
- distributed query federation;
- self-hosted disconnected cell packaging;
- full replay engine implementation;
- payment-provider implementations;
- autonomous skill generation from observed behavior;
- production legal-research/content agents;
- unrestricted code execution or filesystem access;
- direct model access to Object Storage;
- general-purpose model-generated sandbox code before typed analysis shaping is proven;
- moving business logic into Postgres, Cloudflare, the api-server, Kong, generated packages, or the AI harness.

---

## 13. Required tests

At minimum:

1. callers cannot select execution cell, placement generation, or durable store;
2. onboarding creates server-derived placement/lifecycle state;
3. stale placement generations are rejected by migration/routing-sensitive flows;
4. one-STDB/one-managed-PG deployment remains the default/simple path;
5. durable records are ordered by organization + generation + commit sequence;
6. durability watermark detects gaps/lag;
7. audit and canonical change records share operation identifiers but remain separate schemas;
8. snapshot manifests bind an exact reconstructable durable point;
9. application-contract IR exposes only explicitly approved STDB operations;
10. generated hooks/services and harness tools resolve the same stable operations;
11. generated capability discovery cannot elevate permissions;
12. every harness tool invocation is re-authorized against server-derived actor/org context;
13. capability metadata includes risk/confirmation/traffic/result handling without embedding Casbin role assignments;
14. large analytical results remain server-side and only bounded shaped results enter model context;
15. analysis plans are schema/capability/cardinality/admission validated;
16. burst/reconnect/refetch storms remain bounded;
17. durable gateway cannot accept caller-selected PG stores;
18. org A cannot query org B durable data;
19. no external HTTP call occurs while an STDB transaction is held open;
20. hydration rejects organization/generation/version mismatch;
21. overload returns bounded 429/503 outcomes;
22. mutation retries are never transparently amplified across layers;
23. harness code cannot dispatch arbitrary reducer names, raw SQL, bucket keys, arbitrary HTTP URLs, or unrestricted sandbox code through supported APIs;
24. Cloudflare/Kong trusted-proxy behavior preserves correct source/admission identity;
25. STDB websocket and AI SSE flows work through production ingress;
26. loss of Scaleway Generative API does not prevent normal ERP reads/mutations;
27. Scaleway Managed PG backup/PITR restore is exercised before production acceptance.

---

## 14. Acceptance criteria

This branch is complete when:

- SpacetimeDB remains the only business-logic boundary;
- every organization has canonical server-controlled lifecycle + placement metadata;
- initial production runs Cloudflare ingress + one logical Paris STDB cell + Scaleway Managed PostgreSQL;
- future regional STDB placement is a routing/runtime concern rather than an application rewrite;
- Scaleway Managed PG serves as the durable convergence/history/recovery layer;
- application callers use stable generated operation contracts;
- frontend and AI harness share the same generated operation/capability source;
- Casbin-backed authorization remains the sole capability permission source;
- generated tool descriptors provide typed input/output, risk, confirmation, traffic, result policy, and stable capability keys without embedding business policy;
- at least one analytical harness workflow uses deterministic server-side shaping before model interpretation;
- the harness can expose approved ERP tools without a parallel application API;
- AI/model failure cannot block normal ERP workflows;
- private npm/crate artifacts remain generated-output-only;
- legacy hooks/types/transports are removed through repeatable migration tooling;
- broader multi-region, file import, skill-learning, and payment-provider implementations remain future consumers of these foundations.
