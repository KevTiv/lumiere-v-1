# Production readiness, release compatibility, and hardening plan

**Status:** Proposed — split between current refactor/deployment phase and post-service-online hardening
**Tracks:** `production-readiness`, `release`, `rollback`, `contract-versioning`, `disaster-recovery`, `secrets`, `tenant-isolation`, `operations`, `billing`
**Related:** [scaleway-cloudflare-bootstrap-deployment-plan.md](./scaleway-cloudflare-bootstrap-deployment-plan.md) · [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [regional-stdb-scaleway-durable-foundation.md](./regional-stdb-scaleway-durable-foundation.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Objective

Close the remaining production-readiness gaps without expanding the current branch into another feature program.

This plan separates work into:

1. **foundation that should be incorporated during the current IR/refactor/deployment phase**, because delaying it would create migration or compatibility debt; and
2. **service-online hardening**, which requires real Scaleway/Cloudflare/managed-service endpoints, operational traffic, billing providers, or deployed clients before it can be validated meaningfully.

The current phase should establish contracts, automation, invariants, and test seams. Later phases exercise them against production-like infrastructure.

---

## 2. Current-phase requirements

### 2.1 Release and rollback contract

Define one release manifest that identifies the mutually compatible deployment set:

```text
ReleaseManifest
  ├── application_ir_version
  ├── generated_contract_version
  ├── stdb_module_version
  ├── durable_pg_schema_version
  ├── web_build_version
  ├── minimum_mobile_contract_version
  └── deployment/config generation
```

Required now:

- [ ] define the release-manifest schema and ownership;
- [ ] make generated package/contract versions machine-readable;
- [ ] record STDB module and PG schema/migration versions;
- [ ] make deployment tooling reject known-incompatible version combinations;
- [ ] document forward and rollback ordering for IR/codegen, STDB, PG, web, and later Expo;
- [ ] ensure rollback never silently requires destructive PG downgrade;
- [ ] prefer expand/migrate/contract schema changes over in-place breaking changes;
- [ ] make release/correlation identifiers visible in diagnostics and telemetry.

The release unit is the compatible set, not an independently deployed frontend bundle.

### 2.2 Contract and mobile compatibility policy

The IR/codegen revamp must define compatibility before Expo ships stale installed clients.

Classify generated contract changes:

```text
additive field / additive operation
  → compatible when defaults/optionality are explicit

rename / removal / semantic reinterpretation / incompatible type change
  → breaking; requires versioned migration or compatibility adapter
```

Required now:

- [ ] add compatibility classification to IR/codegen validation;
- [ ] emit a stable contract/protocol version in generated SDKs;
- [ ] generate or maintain a machine-readable compatibility manifest;
- [ ] define minimum-supported-client behavior without hard-coding provider endpoints;
- [ ] retain compatibility adapters long enough for mobile rollout windows;
- [ ] add CI fixtures proving old supported clients can still invoke compatible operations;
- [ ] forbid codegen from silently reusing an operation identity after semantic replacement.

Do not couple compatibility versions to concrete model, cloud, or transport-provider versions.

### 2.3 Disaster-recovery primitives and reconstruction contract

The current branch should make recovery possible even before the real managed-PG restore drill occurs.

Required now:

- [ ] define the canonical recovery inputs: durable change records, snapshots/manifests, placement generation, commit/durable watermarks, and schema/contract version;
- [ ] define an idempotent per-organization reconstruction command/workflow;
- [ ] make recovery generation-fenced so stale cells cannot resume authority;
- [ ] ensure reconstruction can report progress and a verifiable final watermark;
- [ ] define integrity checks comparing rebuilt operational state against durable expectations;
- [ ] provide synthetic/local recovery tests using disposable STDB/PG state;
- [ ] define backup/PITR restore verification steps for execution once Scaleway Managed PG is online;
- [ ] document recovery RPO/RTO measurements to capture later rather than inventing targets before measurements exist.

Target invariant:

```text
loss of an STDB execution cell
        ↓
placement fenced
        ↓
rebuild from approved durable inputs
        ↓
validate sequence/watermark/integrity
        ↓
advance placement generation
        ↓
resume organization
```

### 2.4 Secrets and machine-identity lifecycle

Define a provider-neutral secret contract now; bind it to Scaleway/Cloudflare mechanisms during deployment.

Required now:

- [ ] inventory service secrets and machine identities by owner/purpose;
- [ ] distinguish application configuration from secret material;
- [ ] ensure secrets never enter application IR, generated frontend packages, logs, agent context, artifacts, or Qdrant;
- [ ] define least-privilege identities for STDB↔PG, durable workers, AI provider, ingress/control services, and later bucket/payment/device services;
- [ ] define secret version/rotation semantics so credentials can overlap during rotation;
- [ ] define revocation/emergency-rotation procedure;
- [ ] ensure services consume secret references/configuration rather than assuming checked-in `.env` values;
- [ ] add secret-scanning/forbidden-pattern CI where not already present;
- [ ] define deployed-provider binding as a D0 task in the Scaleway deployment plan.

### 2.5 Tenant-isolation test harness

This is worth pulling into the current phase because the IR/codegen migration changes nearly every access path.

Build reusable adversarial fixtures with at least Org A and Org B and prove isolation across:

- generated reads and mutations;
- STDB subscriptions;
- durable-query contracts;
- offline queued/replayed operations;
- capability/tool invocation;
- artifacts and agent-session references;
- Qdrant semantic retrieval metadata/filtering;
- future file references through placeholder contracts where bucket implementation is deferred.

The test should fail if changing an identifier/reference can cross tenant boundaries even when the caller knows the other tenant's object ID.

---

## 3. Deployment-time hardening once Scaleway/Cloudflare are online

These items should be planned now but validated only against deployed services.

### 3.1 Release rehearsal

- [ ] deploy a complete release manifest to staging/production-like infrastructure;
- [ ] exercise one forward-compatible release;
- [ ] exercise application rollback while leaving an expanded PG schema in place;
- [ ] verify unsupported contract combinations fail closed;
- [ ] verify an older supported Expo/client contract against the newer backend once Expo exists.

### 3.2 Managed-PG recovery drill

- [ ] verify Scaleway backup/PITR configuration;
- [ ] restore to a disposable recovery target;
- [ ] validate durable sequence/watermark and representative tenant data;
- [ ] reconstruct a disposable STDB cell from restored durable state;
- [ ] record measured RPO/RTO and operational steps;
- [ ] repeat periodically after meaningful persistence/migration changes.

### 3.3 Secret rotation drill

- [ ] rotate at least one service-to-service credential without full-system downtime;
- [ ] rotate/revoke an AI/provider credential;
- [ ] validate old credential expiry/revocation;
- [ ] ensure telemetry contains secret version/reference metadata only, never values.

---

## 4. Service-online hardening plan

The following should remain future hardening rather than inflate the current refactor.

### 4.1 Billing/subscription lifecycle

When payment providers are selected/online, implement a provider-neutral organization entitlement state machine such as:

```text
trial → active → past_due → grace → suspended → reactivating → active
```

Provider webhooks/events map into trusted billing commands; Stripe/MoMo/etc. must not directly own ERP authorization semantics.

Exercise failed payment, duplicate/out-of-order webhook, grace, suspension, reactivation, org rehydration/backfill, and provider outage scenarios.

### 4.2 Operator/admin diagnostics

Build a small internal operations surface from authoritative/generated contracts that can answer:

- where an organization is placed;
- current placement generation;
- STDB execution and durable watermarks;
- failed/retrying durable operations;
- auth/Casbin denial reason references;
- offline reconciliation state;
- agent execution trace/correlation IDs;
- contract/release versions;
- subscription/entitlement state once billing exists.

This surface is diagnostic/control tooling, not an alternate privileged data-access path.

### 4.3 SLOs and synthetic checks

Once endpoints exist, establish measured service objectives and synthetic probes for:

- authentication/bootstrap;
- organization placement resolution;
- STDB websocket connect/subscription;
- representative reducer round trip;
- durable watermark advancement;
- managed-PG reachability through trusted services;
- AI harness health without making AI an ERP availability dependency;
- web/mobile supported-contract compatibility.

Alert on user-impacting invariants rather than raw infrastructure noise where possible.

### 4.4 Production tenant-isolation exercises

Extend CI isolation tests into deployed staging with real Cloudflare/Kong/auth/STDB/PG/Qdrant paths. Include malformed IDs, replay, stale auth, stale placement generation, cross-org artifact references, semantic-search filtering, and later bucket/file references.

### 4.5 Operational runbooks and incident rehearsal

Create concise runbooks for:

- STDB cell unavailable;
- PG degraded/unavailable;
- durable convergence lag;
- Cloudflare/Kong ingress problem;
- auth provider outage;
- AI/Qdrant outage;
- compromised/revoked credential;
- failed deployment/contract incompatibility;
- tenant suspension/reactivation;
- later bucket/payment-provider incidents.

Run at least one game-day style rehearsal before broad paid rollout.

---

## 5. Production readiness gate

Do not define production readiness by feature count. A release candidate passes when these gates are evidenced:

### Architecture
- [ ] IR/codegen migration is authoritative for targeted domains;
- [ ] legacy transport/type/hook paths targeted for removal are gone or explicitly quarantined;
- [ ] release/contract versions are observable and compatibility is enforced.

### Security
- [ ] trusted actor/org context is server-derived;
- [ ] tenant-isolation suite passes across all currently enabled surfaces;
- [ ] secret material is isolated and rotation/revocation is documented.

### Durability
- [ ] durable convergence invariants pass;
- [ ] local/synthetic reconstruction succeeds;
- [ ] deployed managed-PG restore + STDB reconstruction drill succeeds before paid production dependence.

### Clients
- [ ] web critical workflows pass end-to-end;
- [ ] Expo critical workflows and offline→online reconciliation pass once mobile is included;
- [ ] supported contract-version compatibility is tested.

### Resilience
- [ ] duplicate/replay/stale-generation cases fail safely;
- [ ] provider outages degrade optional capabilities rather than corrupting ERP state;
- [ ] admission/backpressure controls are exercised.

### Operations
- [ ] release identity and correlation are visible;
- [ ] synthetic checks cover critical user journeys;
- [ ] operator diagnostics/runbooks are sufficient to locate tenant, durability, auth, and agent failures.

### Commercial
- [ ] provider-neutral entitlement lifecycle is exercised before automated paid access is relied upon;
- [ ] suspension/reactivation preserves durable organization data and can safely rehydrate execution state.

---

## 6. Explicit non-goals for the current branch

Do not block the current IR/refactor on:

- full operator/admin UI implementation;
- production billing-provider integration;
- final SLO thresholds before real measurements;
- recurring disaster-recovery automation before the first manual drill is proven;
- multi-region DR;
- bucket-dependent file hardening before Object Storage is provisioned;
- Fleet/IoT production operations;
- Niantic/spatial production integration;
- regional STDB provisioning beyond the existing placement-ready foundation.

The current branch should leave strong seams and executable acceptance criteria for these later steps, not implement every future service.
