# Kong local rate limiting and Redis removal plan

**Status:** Proposed — 2026-08-24
**Tracks:** `kong`, `redis-removal`, `rate-limiting`, `admission-control`, `spacetimedb`, `postgres`
**Related:** [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md) · [scaleway-cloudflare-bootstrap-deployment-plan.md](./scaleway-cloudflare-bootstrap-deployment-plan.md) · [regional-stdb-scaleway-durable-foundation.md](./regional-stdb-scaleway-durable-foundation.md)

---

## 1. Decision

Remove Redis from the baseline Lumière deployment and switch Kong's protective ingress rate limits from Redis-backed counters to Kong `local` counters.

Do **not** replace Kong's Redis dependency by making Kong synchronously query SpacetimeDB for every request.

Instead split rate limiting/admission control into three layers:

```text
Layer 1 — edge / ingress protection
Cloudflare + Kong local counters
cheap, fast, approximate across Kong replicas

Layer 2 — application/business admission
SpacetimeDB tables + reducers
precise, tenant-aware, authorization-aware, transactional

Layer 3 — durable usage history
PostgreSQL
billing/audit/analytics/recovery
```

This keeps overload protection outside the application authority while still allowing precise ERP-aware quotas inside STDB.

---

## 2. Current state

Kong currently uses the `rate-limiting` plugin with `policy: redis` on multiple routes, including:

- web root;
- generic query/call endpoints;
- STDB API proxying;
- authentication endpoints;
- domain endpoints;
- realtime endpoint;
- AI endpoint.

Redis is therefore currently an infrastructure dependency primarily for synchronized Kong counters rather than a core Lumière data model.

The removal plan must preserve the intent of those route limits while eliminating the Redis runtime dependency.

---

## 3. Target topology

```text
Internet
   |
Cloudflare
   |  coarse DDoS / edge filtering / optional edge limits
   v
Kong
   |  local rate counters + payload limits
   v
API / SpacetimeDB
   |  exact business admission + quota checks
   v
PostgreSQL
      durable usage/audit projection
```

Baseline persistent services should not include Redis.

---

## 4. Responsibility split

### Kong / Cloudflare own

Protect infrastructure from abusive or accidental request volume:

- per-route request-rate ceilings;
- auth endpoint brute-force throttling;
- coarse API-call throttling;
- AI endpoint ingress protection;
- request-size limits;
- edge/network-level abuse controls.

These limits are defensive. They do not need durable counters or exact cross-node accounting.

### SpacetimeDB owns

Precise product/business rules whose meaning belongs to the application:

- per-organization API/feature quotas;
- AI execution budgets;
- sandbox concurrency/budget limits;
- bulk messaging/payment/import limits;
- plan/subscription entitlements;
- per-user or per-role operation budgets where required;
- concurrent workflow/job admission;
- tenant-level degraded/admission state;
- atomic quota consumption coupled to reducer execution.

These checks should occur in or immediately around reducers so authorization, quota validation, consumption, and state mutation share one authoritative boundary.

### PostgreSQL owns

Durable historical evidence and analysis:

- usage events/history;
- billing/reporting dimensions;
- long-term rate/quota analytics;
- audit evidence;
- recovery/reconciliation records;
- derived operational metrics where retention beyond STDB hot state is required.

Postgres is not on the hot path for Kong's protective request counter.

---

## 5. Why not use STDB as Kong's counter backend

Do not route every incoming request through STDB merely to decide whether Kong should admit it.

That would couple overload protection to the protected application:

```text
attack / traffic spike
      |
Kong
      |
STDB quota lookup
      |
application pressure
```

The ingress layer must remain capable of rejecting traffic without consuming meaningful STDB capacity.

STDB should instead evaluate authenticated, semantically meaningful limits after a request has passed coarse infrastructure protection.

---

## 6. Kong local policy migration

For current Kong route limits, replace Redis-backed policy with local counters while preserving existing numerical limits unless a separate review changes them.

Illustrative change:

```yaml
- name: rate-limiting
  config:
    minute: 240
    policy: local
```

Remove Redis-specific configuration:

```yaml
redis:
  host: redis
  port: 6379
  timeout: 2000
```

Do not add a custom STDB-backed Kong plugin as part of this simplification.

---

## 7. Multi-Kong semantics

Kong local counters are node-local. With multiple Kong replicas, a client may effectively receive more aggregate capacity than the configured per-node limit.

Treat this as acceptable for **defensive ingress limits** as long as:

- Cloudflare provides upstream coarse abuse protection;
- application/business quotas are enforced precisely in STDB;
- route limits are sized conservatively;
- horizontal Kong scale remains modest during early production;
- monitoring can identify whether node-local limits are materially insufficient.

Do not reintroduce Redis merely to obtain mathematically exact gateway counters unless measured production behavior requires it.

If globally synchronized ingress limits become necessary later, evaluate in this order:

1. Cloudflare edge rate limiting/WAF controls;
2. Kong topology and local-limit tuning;
3. whether exactness is actually an application/business concern that belongs in STDB;
4. only then a synchronized gateway counter store such as Redis.

---

## 8. STDB quota/admission model direction

Prefer typed application tables rather than generic infrastructure counters.

Illustrative logical entities:

```text
OrganizationUsage
OrganizationQuota
UserUsage
AiUsageBudget
SandboxBudget
OperationBudget
ConcurrentOperationLease
TenantAdmissionState
```

Exact names and fields must be derived from the application IR/domain model rather than added as disconnected hand-written types.

Reducer pattern:

```text
authenticate actor
      |
authorize capability
      |
read applicable quota/admission state
      |
atomically reserve/consume allowance
      |
perform business mutation
      |
emit durable usage/audit event
```

Important constraints:

- avoid generic counters where domain-specific semantics are required;
- quota mutation must be idempotent where request retry is possible;
- use operation/request IDs for replay protection where applicable;
- do not count failed operations as successful consumption unless the product rule explicitly requires attempted-use accounting;
- organization scope is mandatory;
- permission and quota checks remain separate concepts.

---

## 9. Durable Postgres usage history

Project relevant usage events into Postgres for reporting, billing, audit and trend analysis.

Illustrative shape:

```sql
usage_event
-----------
id
organization_id
actor_id
operation_id
capability
usage_kind
units
status
occurred_at
metadata
```

This table is historical evidence, not the synchronous Kong rate-limit counter.

Retention and aggregation may later support:

- billing summaries;
- quota-change analysis;
- anomaly detection;
- capacity planning;
- product analytics;
- support/audit investigations.

---

## 10. Migration tasks

### R0 — inventory Redis use

- [ ] inventory every Redis reference in compose, Kong configuration, environment files, docs and application code;
- [ ] classify each reference as Kong rate limiting, obsolete scaffolding, or another real dependency;
- [ ] prove whether any non-Kong production code still requires Redis;
- [ ] explicitly record any exception before removal.

### R1 — migrate Kong to local counters

- [ ] replace `policy: redis` with `policy: local` for all current Kong rate-limiting plugins;
- [ ] remove `redis.host`, `redis.port`, `redis.timeout` configuration;
- [ ] retain existing per-route thresholds initially;
- [ ] keep request-size limiting unchanged;
- [ ] add tests/config validation proving Kong starts without Redis;
- [ ] verify rate-limit headers/429 behavior for representative routes.

### R2 — remove Redis infrastructure

- [ ] remove Redis service/volume from development and production compose/config;
- [ ] remove Redis environment variables/secrets;
- [ ] remove Redis health checks and deployment dependencies;
- [ ] update local-development docs and production runbooks;
- [ ] prove clean bootstrap with Redis absent.

### R3 — formalize STDB business admission controls

- [ ] inventory existing quota/admission/rate concepts in reducers and plans;
- [ ] define organization-scoped usage/quota entities through the canonical IR/domain model;
- [ ] define which operations require exact tenant/user quotas;
- [ ] implement atomic reducer-side reserve/consume semantics;
- [ ] add idempotency/retry handling;
- [ ] project durable usage events to Postgres;
- [ ] prove business quotas remain correct across client retries and offline/replayed operations.

### R4 — Cloudflare + horizontal scaling validation

- [ ] document Cloudflare's role as upstream coarse protection;
- [ ] test expected behavior with multiple Kong replicas when production topology reaches that point;
- [ ] measure whether node-local multiplication materially weakens protection;
- [ ] tune Kong/Cloudflare limits before considering Redis reintroduction;
- [ ] document explicit evidence threshold for adding synchronized gateway counters later.

---

## 11. Failure behavior

### Kong local counter reset

A Kong restart resets local counters. This is acceptable because they are transient protective limits, not billing/accounting truth.

### STDB unavailable

Kong still performs coarse ingress protection. Requests that require application authority fail according to normal service availability behavior; Kong does not need STDB merely to maintain its defensive counters.

### Postgres unavailable

Hot business admission in STDB can continue only within the already-defined durable-convergence safety rules. Durable usage projection must queue/reconcile according to the existing STDB-to-Postgres architecture rather than silently dropping billing/audit evidence.

---

## 12. Criteria for reintroducing Redis

Redis must not return because it is conventional infrastructure.

Require measured evidence such as:

- multiple Kong nodes require globally synchronized gateway counters;
- Cloudflare/Kong-local protection cannot meet the required abuse-control semantics;
- a new workload genuinely needs low-latency shared ephemeral coordination and does not fit STDB/Postgres cleanly;
- the operational value of Redis exceeds the deployment, monitoring, backup/security and failure-domain complexity it adds.

If Redis returns, keep it non-authoritative and narrowly scoped.

---

## 13. Acceptance criteria

- Kong starts and enforces representative route limits without Redis;
- all baseline Kong rate-limit policies use local counters;
- Redis is absent from baseline development/production infrastructure unless an explicitly documented non-Kong dependency remains;
- STDB is not called by Kong for coarse per-request admission;
- precise organization/user/product quotas are enforced in STDB where required;
- durable usage/audit evidence is projected to Postgres;
- Cloudflare/Kong/STDB responsibilities are documented as distinct layers;
- multi-Kong local-counter behavior is understood and tested before horizontal scaling;
- Redis reintroduction requires measured evidence rather than architectural assumption.
