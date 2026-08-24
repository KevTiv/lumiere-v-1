# Audit, auth, and operation-context integrity plan

**Status:** Proposed — 2026-08-20
**Tracks:** `audit-integrity`, `server-auth`, `operation-context`, `observability`, `admission-control`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [audit-log-cold-by-default.md](./audit-log-cold-by-default.md) · [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Objective

Make reducer execution, authorization evidence, durable audit records, observability correlation, and authenticated admission control share one explicit operation context without trusting client-supplied identity or authorization metadata.

The client may provide correlation and UX-origin metadata only. Security-sensitive context is resolved and enforced server-side from the authenticated SpacetimeDB/session context before reducers execute or authenticated per-user/per-organization admission budgets are applied.

```text
client intent
  + operation_id / correlation_id / surface
        ↓
edge/Kong source controls
        ↓
STDB/server auth boundary
        ├── resolve actor
        ├── resolve organization
        ├── resolve effective roles/capabilities
        ├── resolve auth/session identity
        └── authorize operation
        ↓
TrustedOperationContext
        ├── authenticated admission control
        └── reducer / procedure
              ├── business transition
              ├── durable audit entry
              └── telemetry correlation
```

---

## 2. Trust boundary

### Client-provided context

Only non-authoritative correlation metadata may originate from the client:

```rust
pub struct ClientOperationContext {
    pub operation_id: OperationId,
    pub correlation_id: CorrelationId,
    pub client_surface: ClientSurface,
    pub workflow_id: Option<WorkflowId>,
    pub causation_id: Option<OperationId>,
}
```

These values are useful for tracing and UX correlation but must never grant access or establish identity.

### Server-derived context

```rust
pub struct TrustedOperationContext {
    pub actor_id: UserId,
    pub organization_id: OrganizationId,
    pub auth_session_id: SessionId,
    pub effective_roles: Vec<RoleId>,
    pub permission_set_version: PermissionSetVersion,
    pub contract_operation: OperationName,
}
```

The server/STDB module derives this context from the authenticated session and authoritative membership/permission state.

The client must never be able to supply or override:

- `actor_id`;
- `organization_id` as an authorization or quota source;
- roles or permissions;
- permission-set version;
- auth/session identity;
- tenant/shard/store placement;
- impersonation identity;
- authorization decisions;
- authenticated admission/quota identity or traffic class overrides.

If an operation input contains an organization/resource identifier for business semantics, the reducer must still verify it against the trusted session scope.

---

## 3. Canonical operation envelope

Compose trusted and untrusted metadata explicitly rather than passing large ad-hoc metadata blobs through reducer parameters.

```rust
pub struct OperationContext {
    pub trusted: TrustedOperationContext,
    pub client: ClientOperationContext,
}
```

Prefer constructing this envelope at one server/STDB boundary and passing it internally rather than making every reducer reconstruct authentication state independently.

Generated application contracts may carry the `ClientOperationContext` wire shape, but generated clients must not expose setters for trusted fields.

Authenticated admission control should consume `OperationContext.trusted` plus generated structural operation traffic metadata. It must not accept caller-authored quota keys.

---

## 4. Audit model

Audit is durable business evidence, not a general log sink.

```rust
pub struct AuditMetadata {
    pub operation_id: OperationId,
    pub correlation_id: CorrelationId,
    pub causation_id: Option<OperationId>,
    pub actor_id: UserId,
    pub organization_id: OrganizationId,
    pub auth_session_id: SessionId,
    pub contract_operation: OperationName,
    pub permission_set_version: PermissionSetVersion,
    pub effective_roles: Vec<RoleId>,
    pub client_surface: ClientSurface,
    pub workflow_id: Option<WorkflowId>,
    pub entity_type: ResourceKey,
    pub entity_id: EntityId,
    pub previous_version: Option<u64>,
    pub new_version: Option<u64>,
    pub outcome: AuditOutcome,
}
```

Do not put arbitrary request headers, raw HTTP routes, IP-derived policy decisions, unrestricted JSON blobs, or renderer-specific state into the durable audit schema.

Where sensitive/large role or permission payloads are undesirable, store stable identifiers/version references rather than full policy documents.

---

## 5. Authorization evidence

An audit entry should answer:

- who performed the action;
- which organization scope was active;
- which stable application operation was invoked;
- which effective permission/role version authorized it;
- what entity/version changed;
- what the outcome was;
- which user-visible operation/trace caused it.

This should be sufficient to investigate questions such as "why could this actor approve this record at that time?" without trusting frontend telemetry.

Audit must record the server-derived authorization context actually used at execution time.

---

## 6. Audit vs telemetry

Keep the schemas related but distinct.

### Audit

- durable business/compliance evidence;
- bounded, stable schema;
- server-derived identity/authorization;
- business entity + version transitions;
- long retention according to audit policy.

### Telemetry

- richer diagnostic metadata;
- timings, spans, retry counts, infrastructure identifiers, error stacks;
- gateway/admission outcomes and queue depth;
- PostHog/product analytics and OpenTelemetry/ClickHouse correlation;
- retention/PII policy independent of audit.

Both share stable identifiers:

```text
operation_id
correlation_id
causation_id
organization_id
contract_operation
workflow_id
client_surface
```

Telemetry must never become an authorization source and must not be required to reconstruct the authoritative audit trail.

---

## 7. Reducer/procedure integration

Avoid proliferating new positional metadata arguments across every reducer.

Target one internal execution helper such as:

```rust
pub fn resolve_operation_context(
    ctx: &ReducerContext,
    client: ClientOperationContext,
    operation: OperationName,
) -> Result<OperationContext>;
```

Then reducers/procedures use shared authorization/audit helpers:

```rust
let op = resolve_operation_context(ctx, input.context, operations::SALES_ORDER_APPROVE)?;
authorize_sales_order_approve(ctx, &op.trusted, order_id)?;
let transition = approve_order(ctx, order_id)?;
write_audit(ctx, &op, transition.audit());
```

The exact APIs should fit SpacetimeDB's generated reducer/procedure constraints, but the invariant remains one trusted resolution path.

---

## 8. Admission-control integration

Pre-auth edge controls may use trusted source-network information from the deployment edge. Authenticated budgets are applied only after the trusted operation context is resolved.

Conceptual flow:

```rust
let op = resolve_operation_context(ctx, input.context, operation)?;
let permit = admission.acquire(AdmissionContext {
    actor_id: op.trusted.actor_id,
    organization_id: op.trusted.organization_id,
    operation,
    traffic_class: generated_traffic_class(operation),
    correlation_id: op.client.correlation_id,
})?;
```

Admission telemetry may include:

```text
traffic_class
admission_outcome
queue_depth
retry_after
```

but canonical business audit should only record admission/rate-limit facts when they are relevant security/compliance evidence.

---

## 9. IR/codegen changes

Application-contract IR should describe correlation context and traffic semantics structurally without encoding authorization policy.

Example metadata:

```rust
pub struct GeneratedApplicationOperation {
    pub name: OperationName,
    pub kind: GeneratedOperationKind,
    pub input: GeneratedTypeRef,
    pub output: GeneratedTypeRef,
    pub accepts_client_operation_context: bool,
    pub traffic: GeneratedOperationTrafficPolicy,
}
```

Generated npm/Rust clients may create/propagate:

- operation ID;
- correlation ID;
- client surface;
- workflow ID;
- causation ID.

They may not generate or serialize trusted actor/role/permission/tenant placement/quota fields as caller-controlled operation metadata.

---

## 10. Offline and queued operations

Offline changesets may preserve their original client operation/correlation IDs, but authorization and admission are re-evaluated when the queued operation is reviewed/applied online.

Never treat cached historical roles/permissions or prior quota state from the offline device as authoritative.

Audit should distinguish:

- original proposed operation ID;
- review/approval operation ID where applicable;
- causation chain between proposal, approval, and applied reducer transition.

This is especially important for the planned PR-style offline review workflow.

---

## 11. Migration phases

### Phase A0 — inventory

- [ ] inventory reducer/procedure signatures that currently accept actor/org/audit metadata from callers;
- [ ] inventory all audit writers and metadata shapes;
- [ ] identify client-supplied organization/user identifiers currently treated as authoritative;
- [ ] inventory existing auth/session resolution helpers;
- [ ] inventory existing request/correlation identifiers;
- [ ] inventory authenticated rate/quota keys currently derived from request data.

### Phase A1 — trusted context foundation

- [ ] define `ClientOperationContext`, `TrustedOperationContext`, and `OperationContext`;
- [ ] add one authoritative server/STDB context resolver;
- [ ] derive actor, organization, session, roles/capabilities, and permission version server-side;
- [ ] reject/ignore trusted-field equivalents from clients;
- [ ] add stable operation names from application-contract IR.

### Phase A2 — audit normalization

- [ ] define canonical `AuditMetadata`;
- [ ] migrate audit writers onto shared helpers;
- [ ] include entity previous/new version where meaningful;
- [ ] include authorization snapshot reference/version;
- [ ] retain operation/correlation/causation IDs;
- [ ] remove arbitrary/unbounded client audit blobs.

### Phase A3 — reducer migration

- [ ] migrate reducer families incrementally;
- [ ] avoid business-logic rewrites while changing metadata plumbing;
- [ ] update generated contracts/codemods where reducer input shapes change;
- [ ] add CI checks preventing direct client-authoritative actor/role/org metadata patterns.

### Phase A4 — admission + telemetry bridge

- [ ] make authenticated admission consume trusted actor/org context;
- [ ] emit OpenTelemetry spans/events using the same operation IDs;
- [ ] map product analytics events to correlation/operation IDs where appropriate;
- [ ] ensure telemetry redaction/PII policy differs from durable audit policy;
- [ ] prove one user action can be correlated from frontend analytics through admission/reducer audit and durable projection without trusting analytics as evidence.

---

## 12. Required tests

1. forged `actor_id`, role, permission, shard/store, session, or quota identity fields cannot affect authorization/admission;
2. organization inputs are always verified against authoritative session/membership scope;
3. audit records use server-derived actor/org/auth context;
4. permission/role changes between requests are reflected by the next operation context;
5. audit context remains correct through procedures and durable rehydration flows;
6. offline queued actions are re-authorized and re-admitted at apply/review time;
7. operation/correlation IDs survive web/Expo → admission → STDB → durable gateway tracing;
8. duplicate/retried operations preserve idempotency semantics and useful causation metadata;
9. generated clients cannot construct trusted context fields through supported APIs;
10. audit schema remains usable without PostHog/ClickHouse/telemetry availability;
11. authenticated per-org/actor budgets cannot be bypassed using caller-controlled organization metadata.

---

## 13. Acceptance criteria

This plan is complete when:

- audit identity and authorization evidence are always server-derived;
- clients only contribute correlation/UX-origin metadata;
- reducer/procedure execution uses one canonical trusted operation-context resolution path;
- authenticated admission control uses the same server-derived actor/org identity;
- application-contract IR propagates stable correlation/traffic context without exposing trusted fields;
- durable audit entries can explain actor, organization, operation, permission snapshot, entity/version transition, and outcome;
- audit and telemetry share correlation IDs but remain separate trust/retention domains;
- offline/replayed operations are re-authorized/re-admitted against current authoritative state;
- legacy caller-controlled audit/auth/admission identity paths are removed or explicitly non-authoritative.
