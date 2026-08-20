# Agent control plane and model-routing plan

**Status:** Proposed — future runtime plan 2026-08-20
**Tracks:** `agent-control-plane`, `model-routing`, `planner-executor`, `verification`, `artifacts`, `skills`, `small-model-ux`, `plugin-seams`, `execution-tracing`
**Related:** [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [scaleway-cloudflare-bootstrap-deployment-plan.md](./scaleway-cloudflare-bootstrap-deployment-plan.md)

---

## 1. Objective

Define the runtime architecture that turns generated ERP capabilities into a reliable, provider-neutral assistant experience, with particular emphasis on making smaller/cheaper models useful through strong orchestration rather than relying on one frontier model and a large prompt.

The control plane owns reasoning workflow; the application-contract IR owns stable operations and structural safety metadata.

```text
User
  ↓
Agent Control Plane
  ├── session/objective state
  ├── intent router
  ├── capability + skill discovery
  ├── model router
  ├── planner
  ├── executor
  ├── deterministic analysis engine
  ├── verifier
  ├── artifact store
  ├── execution event log
  └── presentation composer
        ↓
Generated capability registry
        ↓
server auth + Casbin
        ↓
STDB / bounded durable contracts
```

---

## 2. Non-negotiable invariants

1. **The control plane never becomes an authorization source.** Every capability invocation is re-authorized server-side through Casbin with trusted actor/org context.
2. **Models never receive raw database credentials, arbitrary SQL, reducer dispatch, Object Storage credentials, or unrestricted network/filesystem access.**
3. **Planner and executor are separate concerns.** Plans are typed/validated before execution where practical.
4. **Bulk computation is deterministic by default.** Models choose goals/plans; trusted code performs filtering, aggregation, joins, statistics, and shaping.
5. **The model sees the smallest useful tool set.** Capability discovery narrows hundreds of generated operations to a task-specific subset.
6. **Model/provider choice is deployment policy, not ERP contract semantics.**
7. **Every task has bounded model/tool/token/time/data budgets.**
8. **Analytical claims are verified against structured results before presentation where practical.**
9. **Conversation transcript is not the long-term memory model.** Sessions reference compact state and durable artifacts.
10. **Specialist sub-agents are narrowly scoped workers, not unrestricted clones.**
11. **AI/provider outage degrades AI only; ordinary ERP continues operating.**
12. **Replaceable provider seams are allowed only where replacement cannot redefine ERP authority.**
13. **Agent execution is append-only traceable.** Durable task/tool/model/artifact events can reconstruct what the harness did without exposing hidden chain-of-thought.
14. **ERP history and agent execution history remain distinct.** They correlate through `operation_id`, `correlation_id`, and artifact references rather than sharing one authority log.

---

## 3. Agent control-plane primitives

Introduce provider-neutral runtime concepts:

```ts
interface AgentTask {
  id: AgentTaskId
  objective: string
  actorContextRef: TrustedContextRef
  budget: AgentBudget
  status: AgentTaskStatus
  activeArtifacts: readonly ArtifactRef[]
}

interface AgentPlan {
  taskId: AgentTaskId
  steps: readonly AgentPlanStep[]
  requiredCapabilities: readonly CapabilityKey[]
  reasoningClass: ReasoningClass
}

interface AgentBudget {
  maxModelCalls: number
  maxToolCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  maxDatasetRows: number
  maxDurationMs: number
}
```

The effective budget is runtime policy. IR may provide hints but must not hard-code commercial/model-provider limits.

---

## 4. Capability discovery instead of giant tool prompts

Do not expose the complete generated ERP tool registry to each model call.

```text
user objective
   ↓
intent/domain classification
   ↓
generated CapabilityIndex search
   ↓
Casbin-filtered candidates
   ↓
3–10 task-relevant tools
   ↓
planner/model context
```

Discovery may combine deterministic tags, lexical search, embeddings, and skill metadata. Security remains invocation-time authorization, not discovery filtering.

Measure tool count per call, discovery precision/recall, tool-description tokens, and failed tool-selection rate.

---

## 5. Model router

```ts
interface ModelRouter {
  resolve(policy: ModelExecutionPolicy): ModelProviderRef
}

interface ModelExecutionPolicy {
  reasoningClass: ReasoningClass
  contextClass: ContextClass
  requiresTools: boolean
  latencyClass: LatencyClass
  taskRisk: OperationRisk
}
```

Logical classes remain `Fast`, `Standard`, and `Deep`. Deployment config maps those classes to Scaleway-hosted models initially. Provider/model names stay outside IR.

Escalation should happen only after objective failures such as plan validation failure, unresolved ambiguity, or verifier failure.

---

## 6. Replaceable seams / plugin architecture

Borrow the useful seam discipline from plugin-oriented harnesses, but do not make ERP authority pluggable.

### Safe replacement seams

```text
ModelProvider
EmbeddingProvider
SemanticIndexProvider
SandboxProvider
ResearchProvider
DocumentProcessor
OCRProvider
AgentPersistence
ContextRetriever
TelemetrySink
PresentationRenderer
```

Each seam follows a narrow contract:

```text
definition
   ↓
provider implementation
   ↓
consumer
```

Providers must not receive broader credentials/capabilities than their contract requires.

### Intentionally non-pluggable authority

```text
Casbin authorization semantics
STDB reducer/business invariants
OrganizationPlacement ownership
ordered durable sequencing
ERP application-contract semantics
confirmation/risk enforcement
```

A plugin/provider may help execute, retrieve, render, index, or infer. It may not redefine whether an ERP action is allowed or valid.

### Provider registration requirements

Every provider should expose structural metadata such as:

```ts
interface AgentProviderDescriptor {
  id: ProviderId
  kind: ProviderKind
  version: string
  capabilities: readonly ProviderCapability[]
  healthCheck: HealthCheckPolicy
}
```

Runtime registration is deployment configuration, not generated ERP contract metadata.

---

## 7. Planner → executor → verifier loop

```text
UNDERSTAND
    ↓
DISCOVER
    ↓
PLAN
    ↓
AUTHORIZE
    ↓
EXECUTE
    ↓
SHAPE
    ↓
VERIFY
    ↓
insufficient? ──→ bounded REPLAN
    ↓
PRESENT
```

Hard iteration limits prevent agent wandering. Planner output should prefer typed plans over prose.

Execution validates schemas, capability availability, risk/confirmation requirements, admission policy, budget, and trusted actor/org context before invocation.

---

## 8. Guarded capability execution pipeline

Use one common execution lifecycle for generated ERP capabilities:

```text
CapabilityRequested
      ↓
input/schema validation
      ↓
trusted actor/org resolution
      ↓
Casbin authorization
      ↓
risk / confirmation
      ↓
admission / budget
      ↓
STDB operation
      ↓
result shaping
      ↓
verification / provenance
      ↓
CapabilityResult
```

Support explicit pre/post execution middleware for timeout, retry policy where safe, metrics, redaction, and tracing. Middleware cannot bypass authorization or change business semantics.

Mutations never gain transparent retry unless the generated operation explicitly declares idempotency semantics.

---

## 9. Append-only agent execution event model

Persist a typed append-only event stream for agent execution. This is the source for replay/debugging/session reconstruction, but **not** canonical ERP history.

Candidate events:

```ts
type AgentExecutionEvent =
  | TaskStarted
  | PlanCreated
  | ModelRequestStarted
  | ModelResponseReceived
  | CapabilitySelected
  | CapabilityRequested
  | CapabilityAuthorized
  | CapabilityDenied
  | CapabilityStarted
  | CapabilityCompleted
  | ArtifactCreated
  | VerificationCompleted
  | ReplanRequested
  | TaskCompleted
  | TaskFailed
```

Envelope:

```ts
interface AgentEventEnvelope<T> {
  sessionId: AgentSessionId
  taskId: AgentTaskId
  seq: number
  occurredAt: string
  operationId?: OperationId
  correlationId: CorrelationId
  parentEventSeq?: number
  payload: T
}
```

Requirements:

- monotonically ordered per task/session;
- append-only durable persistence;
- enough information to reconstruct user-visible task state and tool/action lineage;
- model-visible context must be reconstructable from durable refs/events plus authoritative artifacts;
- no hidden chain-of-thought storage requirement;
- sensitive prompt/result content may be redacted or referenced by artifact/hash according to policy.

### Traceability model

The UI/debugger should be able to render a causal tree:

```text
Task
 ├─ Plan
 ├─ Capability call
 │   ├─ authorization
 │   ├─ execution
 │   ├─ shaping
 │   └─ artifact
 ├─ Verification
 └─ Presentation
```

This provides a stack-trace-like explanation of **actions and evidence**, not private reasoning.

---

## 10. Replay, resume, and fork semantics

Plan for replayable agent sessions from stable event boundaries.

Support later:

```text
resume task
replay trace without re-executing side effects
fork from stable step
retry a failed model step with another provider
compare alternative interpretation/presentation
```

Rules:

- historical business mutations are never replayed merely because an agent trace is replayed;
- read-only capability results may reuse versioned artifacts when still valid;
- re-execution of live capabilities requires current authorization/admission checks;
- forks get new task IDs/correlation roots while retaining parent trace references;
- expired/stale artifacts must be detected rather than silently reused.

---

## 11. Deterministic analytical execution

Use the existing `AnalysisPlan`/`AnalysisResult` foundation as the default data-analysis substrate. The model should not calculate financial totals from raw rows when deterministic code can do so.

---

## 12. Verification layer

Start deterministic: schema validity, numeric evidence matching, entity existence, authorized provenance, disclosure/cardinality limits, and normal reducer/confirmation enforcement for mutations. A cheap semantic verifier may later check prose-to-evidence consistency.

---

## 13. Artifact-first memory

Persist useful outputs as typed artifacts:

```text
AnalysisArtifact
DatasetArtifact
PresentationArtifact
DraftDocumentArtifact
ResearchArtifact
ImportProposal
ReportArtifact
```

Each artifact carries task/operation/source provenance. Session context references artifact IDs and concise summaries; large raw data remains server-side.

---

## 14. Session/context compiler

Maintain structured session state:

```ts
interface AgentSessionState {
  objective?: string
  activeArtifacts: readonly ArtifactRef[]
  workingFacts: readonly FactRef[]
  completedSteps: readonly CompletedStepRef[]
  summary: string
}
```

Compile model context from current objective, selected skill, small tool set, compact artifact summaries, evidence excerpts, and approval state rather than replaying full transcript history.

---

## 15. Skills

Skills remain reviewed workflow/reasoning compositions over generated capabilities. They never retain permissions and every capability step re-authorizes at runtime.

---

## 16. Specialist sub-agents

Prefer narrowly scoped specialists such as accounting analysis, research, document, import mapping, presentation, and verification agents. Specialists receive only the capabilities/artifacts/budget needed for their delegated task.

---

## 17. Durable vs runtime vs telemetry events

Keep three event concerns separate:

```text
Durable AgentExecutionEvent
→ what happened / replay / trace

Runtime progress event
→ what is happening now / SSE UI

Telemetry span/metric/log
→ operational performance/cost
```

OpenTelemetry/PostHog projections must not become canonical agent memory. Durable agent events can carry trace/span IDs for correlation.

ERP audit/change history remains separate and links through operation/correlation IDs.

---

## 18. User experience

The system may use several small model calls internally but present one coherent assistant. SSE may expose useful statuses such as checking receivables, comparing periods, verifying findings, or preparing visualization.

The UI should also support an inspectable action trace showing tools/capabilities, authorization result, artifacts, evidence, verification, and outcomes without exposing low-level chain-of-thought.

---

## 19. Initial Scaleway implementation

Deploy the control-plane runtime near the trusted backend in Paris.

```text
Cloudflare
   ↓ HTTPS/SSE
Agent API / control plane — Scaleway Paris
   ↓
Capability + skill discovery
   ↓
Casbin / STDB / analysis engine
   ↓
ModelRouter
   ↓
Scaleway Generative APIs
```

Prefer serverless/pay-per-use inference initially. Instrument model calls/tokens/class/provider, capability calls, shaping cardinality, phase latency, retries/replans, verifier failures, estimated inference cost, and event-log persistence health.

---

## 20. Phases

### ACP0 — control-plane skeleton

- [ ] define `AgentTask`, `AgentPlan`, `AgentBudget`, session state, and artifact refs;
- [ ] implement generated capability-index search + Casbin filtering;
- [ ] implement provider-neutral model router interface;
- [ ] define safe provider/plugin seam registry and mark ERP authority surfaces non-pluggable;
- [ ] separate planner and executor interfaces;
- [ ] enforce task/tool/model budgets;
- [ ] use deterministic analysis engine for large tabular results;
- [ ] add guarded capability execution middleware;
- [ ] add structured SSE task-status events.

### ACP1 — execution trace + artifact + verification foundation

- [ ] persist typed append-only `AgentExecutionEvent` records;
- [ ] correlate agent events with ERP `operation_id` / `correlation_id`;
- [ ] persist analysis/presentation/draft/research artifact metadata;
- [ ] build context compiler from objective + artifacts + selected tools/skills;
- [ ] add deterministic claim/evidence verification;
- [ ] add action-trace/debug view sourced from durable events;
- [ ] measure context/token reduction against transcript/raw-result baseline;
- [ ] add bounded replan after verifier/plan failure.

### ACP2 — replay/fork + skills + specialists

- [ ] define stable replay boundaries and no-side-effect replay semantics;
- [ ] support resume/fork metadata without re-executing historical mutations;
- [ ] define reviewed skill format and registry;
- [ ] add capability/skill discovery integration;
- [ ] add one accounting specialist and one document/research specialist;
- [ ] prove delegated agents receive narrower capability sets and budgets.

### ACP3 — model-quality/economics tuning

- [ ] evaluate Fast/Standard/Deep routing against representative task corpus;
- [ ] record quality, latency, token and cost metrics per class;
- [ ] add escalation rules based on objective failures rather than user-tier hardcoding;
- [ ] choose Scaleway model mapping from measured results;
- [ ] validate provider swaps through the seam contracts without ERP code changes.

---

## 21. Required evaluation corpus

Maintain representative tasks for invoice/order lookup, receivables analysis, audit-history summarization, uploaded dataset mapping, document drafting, research synthesis, and consequential mutation proposals. Add harness tests for trace reconstruction, denied capability calls, provider failure, replay without duplicate side effects, and provider replacement.

---

## 22. Explicitly deferred

- unrestricted autonomous agents;
- arbitrary model-generated code execution;
- persistent permissions inside skills;
- provider/model names in application-contract IR;
- raw transcript as canonical memory;
- direct LLM access to PG/STDB/Object Storage;
- automatic execution of financial mutations;
- autonomous skill publication from observed behavior;
- making Casbin/STDB/business authority replaceable plugins;
- full event-sourced ERP state inside the agent log.

---

## 23. Acceptance criteria

The control plane is successful when:

- smaller models can complete representative ERP tasks reliably because discovery, execution, analysis, verification, and memory are handled structurally;
- the model sees a bounded relevant capability set rather than the entire ERP API;
- model/provider changes require deployment configuration, not application-contract regeneration;
- provider/plugin seams can be replaced without changing ERP authority semantics;
- task budgets prevent unbounded recursive/tool/token usage;
- large data stays server-side and reaches models through compact evidence/artifacts;
- analytical claims are tied to structured provenance/evidence;
- sessions can continue from artifacts without replaying full historical transcripts;
- durable append-only execution events can reconstruct the user-visible action trace;
- replay/fork never duplicates historical business mutations;
- agent events correlate cleanly with ERP audit/change operations;
- specialists receive narrower capabilities than their parent task;
- Casbin/STDB remain authorization/business authorities;
- the UX presents one coherent assistant despite multi-model/sub-agent execution internally.
