# Scaleway + Cloudflare bootstrap deployment plan

**Status:** Proposed — near-term deployment target 2026-08-20
**Tracks:** `deployment`, `scaleway`, `cloudflare`, `managed-postgres`, `stdb`, `ai-harness`, `bootstrap-cost`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [regional-stdb-scaleway-durable-foundation.md](./regional-stdb-scaleway-durable-foundation.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [production-readiness-release-hardening-plan.md](./production-readiness-release-hardening-plan.md)

---

## 1. Objective

Define the first production deployment shape without weakening the multi-tenant or future regional-cell architecture.

The near-term target is:

```text
Internet
   ↓
Cloudflare
DNS / WAF / DDoS / edge routing
   ↓
Kong / trusted ingress
   ↓
server auth + Casbin + admission control
   ↓
OrganizationPlacementResolver
   ↓
STDB Paris execution cell
   ↓
async durable convergence
   ↓
Scaleway Managed PostgreSQL Paris
```

Scaleway Paris is the initial home region. Cloudflare is the global ingress/security layer. Initial production may route every organization to the same logical STDB cell and the same managed PG placement while preserving the canonical organization-placement abstraction.

The deployment must remain a small physical instance of the final architecture rather than a one-off single-tenant topology.

---

## 2. Non-negotiable deployment rules

1. **Multi-tenant by architecture, bootstrap-sized by infrastructure.** Initial low utilization must not introduce single-org shortcuts.
2. **Cloudflare is the public edge; origin services are hardened against direct bypass where practical.**
3. **Kong remains the application ingress/admission boundary behind Cloudflare.**
4. **Postgres uses Scaleway Managed PostgreSQL for the initial production deployment.**
5. **Postgres is private/internal infrastructure and is never exposed directly to frontend or agent clients.**
6. **One authoritative STDB execution cell owns an organization at a time.** Initial placement maps all orgs to Paris.
7. **Normal reducer completion must not wait for AI or external document-processing services.**
8. **AI/provider failure must not prevent ordinary ERP operation.**
9. **Provider-specific endpoints/regions stay in deployment/runtime configuration, not application-contract IR.**
10. **Cost/usage telemetry is collected per organization and capability class so infrastructure upgrades follow measured demand.**
11. **A deployment is a compatible release set.** IR/codegen, STDB module, PG schema, web/mobile contract, and runtime configuration versions must be observable and checked rather than deployed as unrelated artifacts.
12. **Production dependence on backups starts only after restore/reconstruction has been exercised.**

---

## 3. Initial runtime topology

Recommended logical services:

```text
Cloudflare
  ├── DNS
  ├── TLS edge
  ├── WAF / bot / DDoS controls
  └── optional Worker for lightweight placement/bootstrap routing

Scaleway Paris
  ├── Kong
  ├── api/control boundary
  ├── STDB execution cell
  ├── durable gateway/workers
  ├── AI harness
  └── Managed PostgreSQL

External managed APIs
  └── Scaleway Generative APIs
```

The first deployment may co-locate low-duty API/control/harness workers where operationally sensible, but STDB resource requirements and PG managed-service boundaries should remain explicit.

---

## 4. Cloudflare ingress and origin-hardening investigation

Before production cutover, define:

- Cloudflare DNS/proxy configuration;
- TLS mode and origin certificates;
- source/origin restrictions so direct origin access does not bypass edge controls where feasible;
- trusted-proxy configuration in Kong so client IP/rate-limit attribution is correct;
- WAF/rate-limit split between Cloudflare and Kong;
- websocket compatibility and timeout requirements for STDB connectivity;
- SSE compatibility and timeout requirements for AI streaming;
- health-check behavior and maintenance/fail-closed semantics;
- whether a small Worker should resolve bootstrap/placement metadata or whether that remains entirely behind Kong initially.

Do not put authorization/business decisions in Cloudflare Workers.

---

## 5. Placement-aware client bootstrap

Clients must not embed Paris or future regional endpoints.

Target:

```text
client authenticates
      ↓
trusted bootstrap request
      ↓
server resolves actor + organization
      ↓
OrganizationPlacementResolver
      ↓
returns allowed connection/bootstrap descriptor
      ↓
client connects to assigned STDB endpoint
```

The descriptor may include endpoint and generation information but must not let the client choose cell/store placement.

This is the seam later used to move an organization from Paris to another execution cell without changing frontend contracts.

---

## 6. Scaleway Managed PostgreSQL role

The near-term deployment deliberately uses Scaleway Managed PostgreSQL rather than self-hosting PG.

PG responsibilities:

- durable per-organization projection/history;
- canonical change-record convergence;
- durability watermark state;
- snapshot/reactivation manifests;
- historical reads reached through STDB-owned bounded durable contracts;
- recovery/backfill source;
- managed backup/PITR capabilities according to selected service configuration.

Required deployment work:

- private networking/path from trusted services where supported;
- TLS and connection-pool configuration;
- least-privilege service identities;
- migration automation and drift checks;
- backup/PITR verification procedure;
- restore drill before treating backups as production-ready;
- PG capacity/connection metrics associated with organization/capability usage.

The durable schema version, migration state, backup restore target, and reconstructed STDB watermark must participate in the production-readiness evidence defined in the release-hardening plan.

---

## 7. STDB Paris execution cell

Initial logical placement:

```text
org A ─┐
org B ─┼──→ cell-primary-paris → pg-primary-paris
org C ─┘
```

The cell must already emit/track the primitives required by the regional foundation:

- placement generation;
- per-org commit sequence;
- durable convergence watermark;
- trusted operation/correlation context;
- canonical change/audit metadata;
- generation fencing for later move/reactivation.

Do not implement active-active STDB replication in this deployment phase.

---

## 8. AI connectivity and isolation

Keep the AI harness close to the trusted backend in Paris initially.

```text
web / Expo
    ↓ HTTPS/SSE
Cloudflare
    ↓
AI harness Paris
    ↓ typed capability/tool calls
server auth + Casbin
    ↓
STDB / bounded durable queries
    ↓
Scaleway Generative API
```

Use conventional HTTP/SSE for interactive AI output. Keep the STDB realtime websocket responsible for application state rather than overloading it with model token streaming.

AI is never on the reducer commit path. A model/provider outage must degrade AI features only.

---

## 9. Token-aware AI execution principle

The harness should not routinely send raw API/database result payloads into an LLM.

Preferred pipeline:

```text
user intent
   ↓
model chooses approved analytical capability
   ↓
server/Casbin authorization
   ↓
STDB query / bounded durable contract
   ↓
typed raw result kept server-side
   ↓
sandboxed deterministic shaping
  filter / aggregate / group / join allowed datasets
  calculate statistics / deltas / trends
  select representative rows
   ↓
compact typed AnalysisResult
   ↓
LLM interpretation / explanation
   ↓
renderer-neutral presentation intent
```

The model asks for operations and analysis shapes; trusted deterministic code performs bulk data manipulation wherever possible.

Benefits:

- lower token spend;
- less ERP data disclosed to the model;
- predictable context limits;
- stronger reproducibility;
- easier audit/provenance;
- faster analysis of large datasets;
- ability to change model/provider without changing data-processing semantics.

See the harness capability plan for the generated IR/tooling implications.

---

## 10. Sandbox requirements for analysis shaping

Investigate a constrained analysis runtime for deterministic transformations.

The runtime may support a restricted set of generated operations such as:

```text
analysis.select
analysis.filter
analysis.group_by
analysis.aggregate
analysis.compare_periods
analysis.top_n
analysis.histogram
analysis.timeseries
analysis.project
```

Prefer a typed declarative `AnalysisPlan` over arbitrary model-generated code.

If code execution is later allowed for advanced cases, it must be a separate sandbox with:

- no arbitrary network access;
- no filesystem/bucket credentials;
- hard CPU/memory/time limits;
- bounded input/output sizes;
- immutable input datasets;
- explicit approved libraries;
- operation/correlation provenance;
- Casbin-authorized source datasets only;
- deterministic or auditable output where practical.

Raw SQL remains unavailable to the model.

---

## 11. Cost-aware bootstrap operation

The deployment should support a low fixed baseline while keeping expensive features usage-based.

Instrument at minimum per organization:

- STDB resident working-set size;
- reducer/query/subscription volume;
- durable PG storage/query volume;
- AI input/output tokens by model/task class;
- analysis-sandbox CPU/time/data volume;
- OCR/document processing usage when enabled;
- object storage/egress when enabled;
- report/background-worker consumption.

Architecture should support graceful limits/degradation before upgrading infrastructure:

```text
cheap interactive ERP
   remains available

expensive AI/OCR/report operation
   ↓
quota / bounded queue / 429
```

Do not hard-code commercial pricing tiers into IR. Collect the measurements needed to determine cost per active organization and later plan economics.

---

## 12. Deployment phases

### D0 — provision home region

- [ ] provision Scaleway Managed PostgreSQL in Paris;
- [ ] provision initial STDB Paris runtime;
- [ ] establish private/internal network paths where practical;
- [ ] configure TLS/secrets/service identities using the provider-neutral lifecycle defined by the production-readiness plan;
- [ ] configure durable gateway connectivity;
- [ ] test PG migrations, backups and restore;
- [ ] record deployed release/contract/schema versions.

### D1 — put Cloudflare in front

- [ ] move DNS/proxy/TLS ingress through Cloudflare;
- [ ] configure origin hardening;
- [ ] configure Kong trusted-proxy behavior;
- [ ] verify STDB websocket connectivity through the selected route;
- [ ] verify AI SSE streaming;
- [ ] validate DDoS/WAF/Kong/admission responsibilities.

### D2 — placement-aware bootstrap

- [ ] all organizations resolve through `OrganizationPlacementResolver`;
- [ ] bootstrap returns assigned endpoint/generation rather than clients knowing Paris;
- [ ] prove a synthetic second endpoint can be introduced without frontend contract changes.

### D3 — AI harness bootstrap

- [ ] deploy provider-neutral harness in Paris;
- [ ] use Scaleway Generative API adapter first;
- [ ] implement model routing/config outside application IR;
- [ ] stream user-visible progress/output through SSE;
- [ ] prove AI outage leaves ordinary ERP healthy.

### D4 — token-aware shaping proof

- [ ] define typed `AnalysisPlan` + `AnalysisResult`;
- [ ] implement a small deterministic shaping engine;
- [ ] expose shaping operations through generated harness capability metadata;
- [ ] prove an accountant-style trend query without sending raw result rows to the model;
- [ ] emit source/provenance + row/count/hash metadata for auditability;
- [ ] measure token reduction versus raw-context baseline.

### D5 — production-readiness rehearsal

- [ ] validate release manifest/version compatibility across IR, generated contracts, STDB, PG, and clients;
- [ ] exercise a forward release and safe application rollback;
- [ ] perform managed-PG restore into a disposable target;
- [ ] reconstruct representative STDB organization state and verify watermarks/integrity;
- [ ] rotate at least one service credential without broad downtime;
- [ ] run deployed tenant-isolation tests through the real ingress/auth/data paths;
- [ ] enable initial synthetic checks and operator diagnostics before broad paid rollout.

---

## 13. Exit criteria

The first production topology is ready when:

- Cloudflare is the public edge and Kong/origin cannot be trivially bypassed;
- all tenant routing flows through canonical organization placement;
- all current organizations may share the Paris cell without single-org code paths;
- Scaleway Managed PostgreSQL is the tested durable convergence/recovery store;
- STDB websocket and AI SSE behavior are verified behind the production ingress;
- AI uses generated, Casbin-authorized capabilities rather than raw ERP APIs;
- at least one analytical AI workflow uses deterministic server-side shaping before model interpretation;
- provider/model failure does not block normal ERP workflows;
- per-org infrastructure and AI cost signals are measurable;
- release/contract/schema versions are observable and incompatible combinations fail closed;
- managed-PG restore plus representative STDB reconstruction has been exercised;
- tenant-isolation tests pass across every enabled production surface;
- adding a future regional STDB cell is a placement/deployment change rather than an application-contract rewrite.

---

## 14. Explicitly deferred

- multi-region active-active STDB;
- African cell provisioning before latency/demand justifies it;
- dedicated GPU inference;
- self-hosted model serving;
- Cloudflare as a business-logic runtime;
- raw model access to SQL/PG/Object Storage;
- arbitrary model-generated code execution;
- file/Object Storage implementation until storage is provisioned;
- payment-provider deployment;
- full operator/admin UI, final SLO thresholds, recurring DR automation, and payment-provider incident handling until the relevant production services are online.
