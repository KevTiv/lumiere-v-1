# Traffic resilience, Kong hardening, and admission control plan

**Status:** Proposed — 2026-08-20
**Tracks:** `kong`, `traffic-resilience`, `admission-control`, `operation-budgets`, `ddos`, `backpressure`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [audit-auth-operation-context-plan.md](./audit-auth-operation-context-plan.md) · [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md)

---

## 1. Objective

Make ingress and downstream execution resilient against both hostile traffic and self-inflicted traffic storms.

The design must bound blast radius when any of these happen:

- volumetric or application-layer DDoS;
- a generated frontend hook enters a retry/refetch loop;
- Expo clients reconnect simultaneously after a network outage;
- a dashboard fans out many expensive historical/reporting queries;
- a durable Postgres path becomes slow;
- STDB procedures begin queueing behind external I/O;
- AI/report-generation/import operations consume disproportionate capacity;
- multiple retry layers amplify one failing request;
- one tenant monopolizes shared backend capacity.

The resilience model is layered:

```text
Internet
  ↓
CDN / WAF / volumetric DDoS protection
  ↓
Kong
  ├── burst + sustained rate limits
  ├── auth/IP limits
  ├── request bounds
  ├── upstream health / circuit breaking
  └── strict timeouts
  ↓
application admission control
  ├── tenant/user/operation budgets
  ├── concurrency limits
  ├── bounded queues
  ├── idempotency
  └── load shedding
  ↓
STDB / Postgres / workers / AI / report renderer
```

Kong protects ingress and upstream capacity. It must not be the only resilience layer.

---

## 2. Current baseline

Keep the existing useful baseline:

- DB-less declarative Kong configuration;
- Redis-backed rate limiting;
- per-route limits rather than one global limit;
- request-size limiting on mutation/AI-facing routes;
- Kong Admin API bound to loopback only;
- explicit CORS configuration.

The current minute-only limits are not sufficient for production because they do not strongly bound short bursts, expensive operations, reconnect storms, or concurrency.

The current production target also must not remain pinned indefinitely to an unsupported Kong release. Move production deployment to a supported LTS/current supported line and treat gateway upgrades as ordinary security maintenance.

---

## 3. Non-negotiable invariants

1. **Volumetric DDoS protection sits in front of Kong.** Kong is not the public volumetric attack absorber.
2. **Every externally reachable operation has bounded request rate, payload size, execution time, and downstream concurrency.**
3. **Rate limits are layered:** unauthenticated source/IP limits before auth and authenticated actor/organization/operation limits after auth.
4. **No client may select its own quota identity, organization budget, or traffic class.** Trusted identity comes from server-derived auth context.
5. **Expensive operations have lower concurrency/budgets than cheap interactive reads.**
6. **Retries are bounded and ownership is explicit.** Multiple layers must not independently retry the same mutation.
7. **Mutation retries require idempotency/operation identity rather than transparent replay.**
8. **Queues are bounded.** Saturated work sheds load with explicit 429/503 responses rather than growing memory without limit.
9. **Realtime/reconnect behavior is budgeted independently from ordinary HTTP query traffic.**
10. **A single organization cannot exhaust shared durable-query, AI, report, or worker capacity.**
11. **Gateway telemetry and admission decisions carry the same operation/correlation IDs used by audit/telemetry.**
12. **Health checks and circuit breaking fail fast when upstreams degrade.**

---

## 4. Traffic classes in application-contract IR

Extend application-contract metadata with structural traffic policy classification. This remains operational metadata, not business policy.

Example:

```rust
pub enum GeneratedTrafficClass {
    InteractiveRead,
    InteractiveCommand,
    RealtimeConnect,
    DurableRead,
    BulkOperation,
    ReportGeneration,
    AiExecution,
    AuthSensitive,
}

pub struct GeneratedOperationTrafficPolicy {
    pub class: GeneratedTrafficClass,
    pub idempotent: bool,
    pub max_payload_bytes: Option<u64>,
    pub timeout_ms: u64,
    pub max_page_size: Option<u32>,
}
```

Do not encode mutable infrastructure values such as current replica counts or PG hostnames into IR. The IR identifies operation cost/semantics; deployment policy maps traffic classes to environment-specific limits.

Generated clients may use the metadata to avoid dangerous behavior such as unbounded retries, but the server/gateway remains authoritative.

---

## 5. Kong hardening

### 5.1 Edge placement

Production topology:

```text
Internet
  ↓
CDN/WAF/DDoS service
  ↓
private or origin-restricted Kong
```

Requirements:

- [ ] only the edge/CDN should be able to reach the Kong public listener where infrastructure permits;
- [ ] origin IP must not be casually exposed in public DNS/docs;
- [ ] configure trusted proxy/source IP handling explicitly so rate-limit identity cannot be spoofed through forwarded headers;
- [ ] preserve correlation/request IDs from the trusted edge while rejecting untrusted overrides where necessary.

### 5.2 Burst + sustained limits

Replace minute-only thinking with at least two windows where supported:

```text
small burst window
    +
sustained minute/hour budget
```

Examples by class, to be benchmarked rather than copied blindly:

```text
auth-sensitive       very low burst, low sustained
interactive command  low burst, moderate sustained
interactive read     moderate burst, higher sustained
durable read         low burst, low concurrency
AI/report             very low burst, explicit concurrency
```

Limits must be calibrated from load tests and expected user workflows.

### 5.3 Auth-sensitive routes

Stop sharing one generic auth-rate-limit profile for all auth actions.

Separate policies for:

- sign-in;
- forgot password;
- reset password;
- invite creation;
- invite acceptance.

Password reset/forgot-password must have stricter abuse controls than ordinary authenticated API traffic.

### 5.4 Upstreams, health checks, and circuit breaking

Move critical services behind explicit Kong upstream definitions where useful.

- [ ] active/passive health checking for api-server/web upstreams;
- [ ] short connection/read/write timeouts appropriate to each class;
- [ ] fail fast on known-unhealthy targets;
- [ ] do not let Kong queue indefinitely waiting on a degraded upstream;
- [ ] expose health state to operational monitoring.

### 5.5 Request bounds

Apply structural request limits before expensive work:

- [ ] allowed methods by route;
- [ ] content-type checks;
- [ ] route-specific payload limits;
- [ ] maximum query/page size;
- [ ] maximum filter/order list sizes where applicable;
- [ ] bounded report/export request shapes;
- [ ] no arbitrary caller-controlled durable SQL/filter language.

Where Kong OSS cannot validate generated contracts richly enough, enforce the same generated structural contract immediately inside the API/STDB boundary.

### 5.6 Realtime/reconnect protection

Treat realtime separately from request-response traffic.

- [ ] bound connection/reconnect attempts per actor/org/source;
- [ ] bound concurrent realtime connections/subscriptions per actor/org;
- [ ] add reconnect jitter/backoff in generated clients;
- [ ] prevent every dashboard/widget from opening independent redundant subscriptions;
- [ ] test synchronized reconnect after simulated regional/mobile outage.

---

## 6. Application-level admission control

Kong cannot determine true operation cost after authentication and business routing, so add a trusted admission layer keyed from server-derived context.

Conceptual API:

```rust
pub struct AdmissionContext {
    pub actor_id: ActorId,
    pub organization_id: OrganizationId,
    pub operation: OperationName,
    pub traffic_class: TrafficClass,
    pub correlation_id: CorrelationId,
}

pub trait AdmissionController {
    fn acquire(&self, context: &AdmissionContext) -> Result<AdmissionPermit, AdmissionError>;
}
```

The caller never constructs trusted actor/org identity.

### 6.1 Per-organization fairness

At minimum, expensive shared pools must enforce organization-aware fairness:

- durable PG historical queries;
- report rendering / Chromium;
- AI execution;
- bulk imports/exports;
- background reconciliation;
- expensive analytics.

A noisy organization may consume its allocation but must not starve all other tenants.

### 6.2 Concurrency limits

Use bounded semaphores/worker concurrency by class, not only request-rate counters.

Examples:

```text
durable_read_pool
report_render_pool
ai_execution_pool
bulk_operation_pool
```

Each pool has:

- global maximum;
- optional per-org maximum;
- bounded waiting capacity;
- explicit rejection/load-shed behavior.

### 6.3 Load shedding

When capacity is exhausted:

- return `429 Too Many Requests` for quota/budget exhaustion;
- return `503 Service Unavailable` for temporary shared-capacity saturation/degraded dependencies;
- include bounded `Retry-After` guidance where safe;
- never hold requests indefinitely in memory.

Generated clients should surface these as normal recoverable states rather than entering immediate retry loops.

---

## 7. Retry and idempotency policy

Define retry ownership per operation class.

### Queries

May use bounded retries only when:

- the operation is declared idempotent/read-only;
- exponential backoff + jitter is used;
- retry count/time budget is capped;
- 4xx validation/auth failures are not retried;
- 429/503 honor server guidance.

### Commands/mutations

Do not transparently retry arbitrary commands.

Use:

```text
operation_id
idempotency semantics
server-side duplicate detection where required
```

A mutation may be safely retried only if its contract declares the behavior and the reducer implements the required idempotency/deduplication invariant.

### Layer ownership

Document which layer retries:

```text
client OR gateway OR service
```

not all three.

Kong must not automatically amplify non-idempotent command failures.

---

## 8. Frontend footgun prevention

Generated hooks/services should make dangerous traffic patterns hard to express.

- [ ] centralized retry defaults by operation traffic class;
- [ ] reconnect exponential backoff + jitter;
- [ ] request deduplication through stable query keys;
- [ ] no automatic refetch loops on deterministic 4xx failures;
- [ ] dashboard composition must coalesce identical data dependencies;
- [ ] expensive sections should lazy-load or stage execution rather than fan out simultaneously where appropriate;
- [ ] background/mobile focus refetch policies must be deliberate;
- [ ] offline replay uses bounded batches and server-side admission rather than blasting queued operations simultaneously.

Add tests specifically for accidental client storms.

---

## 9. Durable Postgres protection

The durable gateway is a constrained executor, not an unlimited query proxy.

- [ ] bounded page sizes from STDB-owned durable contracts;
- [ ] statement/query timeout;
- [ ] connection-pool maximums;
- [ ] per-org durable concurrency budget;
- [ ] maximum durable-query result size;
- [ ] no caller-selected shard/store;
- [ ] cancellation propagation where supported;
- [ ] projection/drainer jobs use separate capacity from interactive durable reads where practical.

Protect PG from an STDB/client storm and protect interactive traffic from drainers/reporting workloads.

---

## 10. Worker and external-service resilience

### Report renderer

- bounded concurrent Chromium jobs;
- hard render timeout;
- maximum artifact/request size;
- job deduplication/idempotency;
- queue depth telemetry.

### AI gateway

- per-org/user quotas;
- concurrent request limits;
- upstream provider timeouts;
- cost/token limits where applicable;
- circuit breaking around degraded providers;
- no unbounded automatic provider retry cascade.

### Workflow/offline workers

- bounded batch sizes;
- exponential backoff on repeated failures;
- poison-job/dead-letter handling where needed;
- lease/idempotency semantics so restart does not duplicate side effects.

---

## 11. Observability and audit integration

Every admission/rate-limit/load-shed decision should carry:

```text
operation_id
correlation_id
organization_id (server-derived)
actor_id (server-derived where authenticated)
contract_operation
traffic_class
client_surface
admission_outcome
retry_after
```

Do not put raw secrets/tokens into logs.

Telemetry should answer:

- which operation is saturating capacity;
- which organization is consuming a shared pool;
- whether failures originate at edge, Kong, app admission, STDB, PG, AI, or worker;
- whether clients are retrying too aggressively;
- realtime connection/reconnect rates;
- queue depth and shed counts.

Audit records should only contain business-relevant security/outcome evidence; operational rate-limit details primarily belong in telemetry unless they matter to a security audit.

---

## 12. Test plan

### DDoS/application-abuse tests

1. burst traffic is rejected before api-server saturation;
2. spoofed forwarding headers cannot bypass source-IP policy;
3. auth endpoints have independent limits;
4. one organization cannot consume all expensive-operation capacity;
5. request-size/method/content-type limits reject before downstream work.

### Self-inflicted storm tests

6. 100+ clients reconnecting simultaneously use jitter and remain within realtime admission limits;
7. a React Query/refetch bug cannot create unbounded backend concurrency;
8. Overview Dashboard does not create duplicate identical requests/subscriptions;
9. offline replay batches are bounded and back off on 429/503;
10. a slow PG durable query causes load shedding rather than request buildup.

### Failure/cascade tests

11. unhealthy api-server target is removed/fails fast through Kong health policy;
12. PG degradation does not exhaust all API worker capacity;
13. report renderer saturation does not block ordinary ERP queries;
14. AI-provider degradation does not generate retry storms;
15. retry behavior for mutations is idempotency-safe and not duplicated across layers.

---

## 13. Implementation phases

### Phase R0 — inventory and supported Kong baseline

- [ ] inventory every public route and classify traffic cost;
- [ ] move production Kong image/config to a supported release line;
- [ ] document trusted edge/proxy topology;
- [ ] identify routes currently bypassing Kong or application-contract policy;
- [ ] define traffic classes in application-contract IR.

**Exit gate:** every external operation has a named traffic class and supported gateway target.

### Phase R1 — gateway hardening

- [ ] separate auth endpoint policies;
- [ ] add burst + sustained rate limits;
- [ ] add/verify request bounds;
- [ ] configure trusted proxy/source IP behavior;
- [ ] define upstream health checks/circuit breaking/timeouts;
- [ ] instrument rate-limit and upstream failures.

### Phase R2 — application admission control

- [ ] add server-derived `AdmissionContext`;
- [ ] add global + per-org concurrency pools for expensive classes;
- [ ] bounded queues + 429/503 shedding;
- [ ] durable PG statement/pool/result limits;
- [ ] report/AI capacity isolation.

### Phase R3 — generated-client resilience defaults

- [ ] traffic-class-driven retry policy;
- [ ] jittered realtime reconnect;
- [ ] dashboard dependency deduplication;
- [ ] bounded offline replay;
- [ ] explicit mutation idempotency metadata/handling.

### Phase R4 — chaos/load proof

- [ ] load-test normal and burst scenarios;
- [ ] simulate PG latency/failure;
- [ ] simulate STDB/API degradation;
- [ ] simulate mobile reconnect storm;
- [ ] simulate dashboard fanout;
- [ ] document measured safe limits and tune configuration.

---

## 14. Acceptance criteria

This plan is successful when:

- Kong is on a supported production release and sits behind edge DDoS/WAF protection;
- burst and sustained limits exist for public traffic classes;
- trusted identity, not caller metadata, determines authenticated budgets;
- expensive operations are concurrency-limited and tenant-fair;
- queues are bounded and overload sheds quickly;
- durable PG, reports, AI, and workers cannot exhaust ordinary interactive capacity;
- realtime reconnect storms are bounded;
- generated clients use safe retry/reconnect defaults;
- mutations are not transparently retried without idempotency guarantees;
- traffic/admission telemetry correlates with the existing operation context;
- load/chaos tests prove that one bad client, one noisy tenant, or one degraded dependency does not cause an ecosystem-wide failure.
