# Repository cohesion, authority, and outcome-ownership remediation

**Status:** MANDATORY PRE-FEATURE FOUNDATION — 2026-09-14  
**Program:** ERP harness coordinated delivery  
**Execution ledger:** [`repository-cohesion-outcome-ownership-ledger.md`](./repository-cohesion-outcome-ownership-ledger.md)  
**Parent coordination:** [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md)

## 1. Objective

Before widening the agent capability surface or building WorkPrograms/sandbox execution, remove the parallel generations of architecture that currently coexist in Lumière and establish one clear owner for each security, contract, execution, persistence, and outcome concern.

The desired repository should read as one system rather than a sequence of migrations left running beside one another.

A reviewer following a request should be able to answer, without hunting through compatibility branches:

```text
where does identity come from?
where is company scope selected?
what grants a capability?
which contract defines the input/output?
which executor owns this operation?
who owns retries/idempotency?
what exact state changed?
what happens if the response is lost?
how is the error represented to the next layer?
where is the audit/evidence record?
```

The target control flow is:

```text
HTTP / BFF intent
      ↓
server-derived TrustedExecutionContext
      ↓
application service / canonical executor
      ↓
generated contract + current authorization
      ↓
capability / domain operation
      ↓
STDB / provider / broker
      ↓
typed operation outcome
      ↓
API outcome/error mapper
      ↓
UI / caller
```

For AI execution:

```text
RunIntent + TrustedExecutionContext
      ↓
GovernedExecutor
      ↓
released immutable skill/program policy
      ↓
authorized generated capability view
      ↓
recorded loop / deterministic step
      ↓
typed evidence + effect outcome
      ↓
answer/action gate
```

No layer beside the named authority may reconstruct, broaden, or guess the same decision.

## 2. Findings this plan closes

Current implementation evidence shows the following overlapping seams:

1. legacy `run_skill_unlocked` execution exists beside the governed executor;
2. legacy monthly-spend checking/`record_ai_spend` exists beside reservation/attempt/settlement;
3. action drafts have both request-correlated creation and create-then-query-latest creation;
4. agent action implication logic exists in multiple functions with different semantics;
5. request DTOs still carry organization/company/token/identity material that should be trusted context;
6. active releases reconstruct part of their runtime policy from compiled Rust instead of consuming the complete immutable released manifest;
7. handwritten harness resource contracts coexist with generated application/capability IR;
8. generated capability schemas, invocation policy, and runtime tool views disagree on company-scope fields;
9. loop persistence can serialize bounded business payloads into step summaries while protected outputs lose structured evidence references;
10. tenant file metadata accepts caller company/residency values before the stronger broker/residency architecture exists;
11. expected domain/control-flow failures are frequently collapsed into `anyhow`/string/internal errors at route boundaries;
12. compatibility helpers and fallbacks have no uniform deletion/expiry contract.

This work is not cosmetic cleanup. These seams are future bug and privilege boundaries because new agents can wire to the wrong generation while still producing locally green tests.

## 3. Cohesion principles

### 3.1 One authority per concept

| Concern | Canonical owner after remediation |
| --- | --- |
| actor/org/session identity | authenticated server context |
| company scope | trusted execution context derived from authorized user intent |
| ERP permission | current Casbin/server policy |
| model-visible capability | current authority ∩ released skill/program declarations ∩ reviewed generated capability |
| ERP structural contract | generated application-contract IR / immutable `lumiere-contracts` release |
| skill/program policy | complete immutable released manifest |
| business state/effects | SpacetimeDB canonical operation/reducer |
| AI execution | canonical governed executor |
| provider spend | reservation → provider attempt → settlement ledger |
| action-draft identity | request/run-correlated durable mapping |
| evidence/audit metadata | typed semantic event/evidence records |
| public error semantics | typed error classification mapped once at transport boundary |

Anything else is an adapter, compatibility reader, or presentation layer. It may narrow or translate; it may not become a second authority.

### 3.2 Compatibility is migration code, not architecture

Every compatibility path must have:

```text
owner
reason
allowed environment
call-site count
removal prerequisite
removal task ID
CI ratchet preventing new call sites
```

No indefinite `legacy`, fallback, bundled overlay, implied permission, latest-row lookup, or alternate spend path is accepted merely because it is useful during migration.

### 3.3 Expected outcomes are typed

Do not use exceptions/string errors as normal business state.

Consequential operations should resolve to an explicit outcome shape equivalent to:

```text
Applied
  stable resource/effect reference
  revision/idempotency reference

AlreadyApplied / NoOpReplay
  same stable effect reference

Rejected
  stable machine code
  reason class

Waiting
  approval / input / external dependency reference

OutcomeUnknown
  reconciliation key
  no permission to blindly retry
```

Exact Rust/TypeScript types may vary by subsystem. The semantic states do not.

A create that commits and then fails to discover the created row is **not** `InternalError`; it is an implementation bug if exact correlation was required, or `OutcomeUnknown` if the provider truly cannot prove the effect.

### 3.4 Errors retain meaning until the transport boundary

Avoid a giant repo-wide error enum. Each cohesive subsystem owns typed errors, but all externally relevant errors classify into a small transport vocabulary:

```text
invalid_input
unauthenticated
forbidden
not_found
conflict
stale_state
precondition_failed
rate_limited
budget_exhausted
dependency_unavailable
timeout
outcome_unknown
internal_invariant
```

Transport mapping additionally supplies:

```text
stable code
safe public message
correlation id
retry advice: never | safe | after-refresh | reconcile
optional resource/reconciliation reference
```

Rules:

- expected authorization/validation/conflict states must not become HTTP 500 because an `anyhow` string lost type information;
- internal implementation/provider details are logged with correlation, not reflected verbatim to clients;
- retry advice is owned by the operation, not guessed by the frontend;
- `outcome_unknown` is distinct from ordinary failure;
- no critical persistence/audit/spend error is discarded with `let _ = ...`;
- `anyhow::Context` remains acceptable at application/infrastructure composition boundaries, not as the semantic type for expected domain outcomes.

## 4. Trusted execution context

Introduce/standardize one server-created context passed to protected AI/application services.

Conceptually:

```rust
struct TrustedExecutionContext {
    organization_id: OrganizationId,
    actor_id: ActorId,
    session_ref: SessionRef,
    company_scope: AuthorizedCompanyScope,
    correlation_id: CorrelationId,
    policy_version: PolicyVersionRef,
    placement_generation: PlacementGeneration,
}
```

The context may later gain HSEC processor/residency constraints. Do not make it a catch-all dependency bag.

Rules:

1. routes authenticate/resolve context; service APIs receive context, not `stdb_token`, `identity_hex`, arbitrary `org_id`, or role strings;
2. model/tool inputs never contain organization authority;
3. company selection happens before tool invocation from an authorized scope;
4. a child context can only narrow the parent scope;
5. actor permissions are rechecked at protected operations; the context identifies authority but does not freeze historical permission forever;
6. service credentials stay inside infrastructure adapters and are never normal request fields.

For P0/P1 AI execution, use one company-scoped run context. If multi-company analysis is needed later, make it an explicit server-resolved scope type rather than allowing a model to send arbitrary company IDs.

## 5. Capability and permission convergence

### Problem

Current `ensure_allowed_action` and tool-registry implication logic encode overlapping but different privilege rules.

### Target

Build one effective capability set once at run/operation admission from:

```text
current actor authorization
∩ agent configuration
∩ immutable released skill/program policy
∩ reviewed generated capability catalog
∩ task/run scope
```

`AiAgent.allowed_actions` is configuration/narrowing metadata, not an authorization authority.

Do not keep runtime rules such as:

```text
chat => live_read\ skill_run => web_search\ skill_run => action_draft
```

scattered in call sites.

If legacy stored agent configs require migration, normalize them through one explicit migration/compatibility function with tests and an expiry task. Runtime authorization then consumes the normalized set without additional implication maps.

## 6. Immutable release as runtime policy truth

The active released skill/program version must carry the complete reviewed policy used by execution.

Target:

```text
load active release
→ load exact immutable version
→ parse canonical manifest
→ validate schema/version/source hash/executor compatibility
→ derive runtime adapter binding
→ execute
```

Compiled Rust functions provide implementation adapters only. They must not independently reconstruct risk, resources, allowed capabilities, limits, output types, privacy rules, or approval requirements that already belong to the released manifest.

Built-in skills may still have compiled adapters; the immutable manifest decides whether and how those adapters are admitted.

Certification and runtime must consume the same canonical manifest representation.

## 7. Generated contract convergence

Application-contract IR owns structural ERP capability semantics:

```text
CapabilityKey
target resource/operation
input/output shape
risk/confirmation
result policy
traffic/idempotency
scope classification
```

The harness may add execution policy such as evidence requirements, model/runtime eligibility, or stricter organization limits. It must not duplicate structural schemas in a handwritten resource registry.

Migration shape:

```text
handwritten ResourceRegistry
        ↓
generated resource/capability adapter
        +
small harness policy overlay keyed by stable CapabilityKey
```

A harness-specific output validator may remain only when it validates a genuinely harness-specific semantic artifact rather than restating the generated ERP contract.

## 8. Scope semantics

Use one model-facing rule:

> Organization and company authority are not model arguments.

For a normal company-scoped tool:

```text
user/BFF selects company from authorized scope
→ TrustedExecutionContext binds company
→ generated tool schema excludes org/company authority fields
→ executor injects trusted scope into the resource adapter
```

For an explicitly multi-company capability, define a separate server-resolved scope contract with an authorized company set; do not overload ordinary tool schemas.

Update codegen, invocation-policy scope checks, and `AuthorizedToolView` together so they enforce the same rule.

## 9. Effect correlation and idempotency

No consequential creation path may identify its result by querying “the latest row”.

Preferred patterns:

1. reducer/operation returns an exact result where the platform supports it;
2. otherwise the caller supplies a stable request/idempotency key and the authoritative write atomically records request → effect mapping;
3. provider operations use attempt IDs and explicit `outcome_unknown` reconciliation.

Apply this to at least:

```text
AI agent run creation
AI action draft creation
provider spend/attempts
future WorkProgram/ProgramRun starts
automation-triggered consequential steps
```

Lookups must validate organization/company/run/request binding and exact cardinality rather than relying on global uniqueness assumptions or `LIMIT 1` as correctness.

## 10. Canonical AI execution and spend

Production AI has one execution authority.

Remove or development-isolate:

```text
run_skill_unlocked production reachability
legacy per-run `ensure_within_budget` as spend admission
best-effort `record_ai_spend`
latest-draft lookup
parallel route-local policy engines that execute work independently
```

Every chargeable governed provider call uses:

```text
admit/reserve
→ create/claim provider attempt
→ dispatch
→ record provider outcome
→ settle exact usage
```

A settlement/audit failure is not silently ignored. If the provider effect may have occurred, preserve the durable state needed for reconciliation.

Every production AI route is classified as either:

```text
governed execution
or
governed platform service
or
administrative service
```

No route becomes a second model/tool authority.

## 11. Semantic event and evidence persistence

Do not store raw tool payloads in generic step-summary strings merely because the payload fits an 8 KiB bound.

Minimum semantic run event:

```text
event kind
run/step/correlation refs
tool/capability key
input hash
output/evidence hash
resource/evidence/artifact refs
row/byte counts
policy decision ref
provider attempt ref when relevant
duration
stable error/outcome code
```

Sensitive/raw evidence stays in the authorized evidence/artifact/data tier under retention policy.

The recorder must preserve useful provenance (including citations/evidence refs) after privacy protection rather than replacing all successful outputs with an anonymous summary.

INTRO may later project these events into a richer causal forensic graph. This remediation establishes a safe semantic source, not the full INTRO platform.

## 12. Tenant file/storage boundary

Before `TenantFileRead/Write` becomes a production agent capability:

1. validate company membership/access at presign, upload, complete, download and OCR boundaries;
2. derive residency/placement server-side from organization policy; a client tag cannot select physical policy;
3. move blocking filesystem operations out of async request execution (`tokio::fs`, bounded blocking adapter, or storage trait);
4. keep paths entirely server-side and expose opaque object/document IDs;
5. validate object metadata binding at every lifecycle step;
6. define exact incomplete/completed/replaced/deleted states;
7. keep a replaceable object-store backend boundary.

The local filesystem backend can remain a development/pilot implementation if it obeys the same logical contract.

## 13. Repository error/outcome architecture

### Application/domain services

Expected failures use typed enums/newtypes. Examples:

```rust
enum DraftCreateError {
    InvalidProposal(...),
    Forbidden(...),
    StaleRun(...),
    Conflict(...),
    DependencyUnavailable(...),
    OutcomeUnknown(ReconciliationRef),
}
```

Do not encode stable machine semantics by parsing error strings.

### Infrastructure adapters

Infrastructure errors retain provider/operation context using `source`/`Context`, then convert to the owning service error at one seam.

### HTTP/API boundary

One mapper per service/crate turns service errors into the standard envelope. Avoid repeated route code such as `map_err(|e| AppError::Internal(e.to_string()))` for expected failures.

Suggested external envelope:

```json
{
  "code": "stale_state",
  "message": "This record changed. Refresh before retrying.",
  "correlationId": "...",
  "retry": "after-refresh"
}
```

Sensitive detail remains server-side.

### Frontend boundary

Frontend client packages parse structured API errors once and expose typed helpers. Components decide presentation, not semantics. Avoid each mutation hook throwing an opaque string and then rediscovering retry behavior ad hoc.

## 14. Defaults, fallbacks, and ignored errors

A cohesive implementation distinguishes optional presentation defaults from required integrity data.

Forbidden for required identifiers/security/effects unless explicitly justified:

```text
unwrap_or(0)
unwrap_or("unknown")
first row / LIMIT 1 without cardinality proof
best-effort discard of persistence error
fallback to broader credential/client
fallback to wider company/org scope
fallback to weaker provider/residency
```

Acceptable defaults are local UX/configuration defaults with no security/state ambiguity, and should be named as defaults.

Introduce focused CI/source ratchets for the deprecated patterns touched by this program; do not add noisy repository-wide grep rules with known false positives.

## 15. Module ownership and meaningful code

Routes should be thin:

```text
parse intent
authenticate/derive trusted context
call one application service
map typed result
```

Application services/executors own use-case sequencing.

Domain/capability code owns business/capability semantics.

Infrastructure adapters own STDB/provider/object-store mechanics.

Presentation/UI owns rendering only.

Avoid generic `utils`, catch-all `manager`, second registries, or abstractions that exist only to reduce line count. A module name should describe a durable responsibility.

When touching a large file, prefer extracting a cohesive owner only if doing so reduces mixed authority/responsibility. Mechanical modularization and behavior correction remain separate reviewable changes where practical.

## 16. Implementation order

The detailed package cards live in the companion ledger. The dependency spine is:

```text
COH-00 authority + compatibility census
   ├── COH-01 trusted context
   ├── COH-02 typed outcome/error contract
   ├── COH-03 capability authority convergence
   └── COH-04 immutable release policy consumption
          ↓
COH-05 generated contract + scope convergence
          ↓
COH-06 correlated effects/drafts/runs
          ↓
COH-07 canonical executor/spend + legacy shutdown
          ↓
COH-08 semantic events/evidence
          ↓
COH-09 tenant file boundary
          ↓
COH-10 frontend/API error convergence
          ↓
COH-11 compatibility removal + CI ratchets
          ↓
COH-12 integrated seam-eradication certification
```

Parallelism:

- COH-01, COH-02, COH-03 and COH-04 may run concurrently after COH-00 with disjoint ownership;
- BASE-03/04 business-defect remediation can run concurrently with COH;
- SEC trusted-envelope design must converge with COH-01 rather than invent a second context type;
- GOV implementation begins only against accepted COH authority semantics; pieces already delivered are adapted rather than reimplemented;
- COH-09 may continue in parallel if no active API-server file owner conflicts.

## 17. Completion gate

The cohesion wave is accepted when all of the following are true:

1. one production AI execution authority remains;
2. protected service APIs receive server-derived context, not caller credentials/identity authority;
3. one effective-capability calculation owns agent/tool authorization narrowing;
4. runtime consumes the complete immutable released policy manifest;
5. generated contracts own structural ERP resource/operation semantics;
6. organization/company scope semantics are consistent from generated schema to runtime adapter;
7. no governed consequential create depends on latest-row discovery;
8. provider spend/drafts/runs have exact idempotency/reconciliation ownership;
9. expected errors/outcomes remain typed through service boundaries and map predictably at HTTP/UI boundaries;
10. no critical ledger/audit/effect persistence failure is silently ignored;
11. run-step persistence is semantic/reference-oriented rather than a shadow raw-data store;
12. tenant file lifecycle validates company scope and uses server-derived placement policy before agent admission;
13. all compatibility paths have explicit remaining owner/removal gate and no new call sites can appear;
14. integrated authorization/idempotency/outcome-unknown tests pass;
15. the coordinator can trace an admitted request from route to effect and back without encountering competing sources of truth.

Only after this gate should the program aggressively expand generated capabilities, WorkPrograms, sandbox execution, HLEARN, or INTRO.