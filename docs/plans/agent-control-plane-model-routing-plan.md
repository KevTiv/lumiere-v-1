# Agent control plane, model routing, and sandbox orchestration plan

**Status:** Proposed — future runtime plan 2026-08-24
**Tracks:** `agent-control-plane`, `model-routing`, `planner-executor`, `sandbox-orchestration`, `verification`, `artifacts`, `recipes`, `skills`, `small-model-ux`, `execution-tracing`
**Related:** [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [agent-generated-erp-tool-surface-plan.md](./agent-generated-erp-tool-surface-plan.md) · [agent-sandbox-data-analysis-plan.md](./agent-sandbox-data-analysis-plan.md) · [scaleway-cloudflare-bootstrap-deployment-plan.md](./scaleway-cloudflare-bootstrap-deployment-plan.md)

---

## 1. Objective

Define the runtime architecture that turns generated ERP capabilities into a reliable provider-neutral assistant where:

- the model owns hypothesis formation and reasoning;
- generated capabilities own discovery/acquisition contracts;
- Python sandboxes own flexible analytical/document execution;
- the harness owns policy, budgets, provenance and verification;
- STDB/Casbin remain business/authorization authority;
- successful user work can be reused as recipes and later promoted into reviewed skills.

Target architecture:

```text
User
  ↓
Agent Control Plane
  ├── objective/session state
  ├── capability/entity discovery
  ├── model router
  ├── planner/hypothesis loop
  ├── ERP acquisition executor
  ├── SandboxProvider / Daytona scheduler
  ├── verifier
  ├── artifact + recipe store
  ├── execution event log
  └── presentation composer
        ↓
Generated capability registry
        ↓
server auth + Casbin
        ↓
STDB / bounded durable contracts

Sandbox side path:
DatasetHandle(s)
   ↓
Python program
   ↓
Daytona sandbox
   ↓
EvidenceArtifact / report / workbook / chart
```

---

## 2. Non-negotiable invariants

1. **Control plane is not authorization authority.** Every ERP capability invocation is re-authorized server-side.
2. **Models do not receive raw database/storage credentials or unrestricted infrastructure access.**
3. **Multi-row analytical data does not enter model context by default.** It becomes scoped dataset handles.
4. **Python executes in isolated sandboxes, not in the control-plane process.**
5. **Sandbox code cannot mutate ERP state.** Consequential changes stay in typed action-draft/approval/reducer paths.
6. **Planner/model and executor/sandbox are separate concerns.** Model-authored programs are proposals executed under policy.
7. **Models see the smallest useful capability set.** Discovery narrows generated operations before schema loading.
8. **Every task has bounded model/tool/sandbox/token/time/data/artifact budgets.**
9. **Material claims are tied to evidence/provenance and verified where practical.**
10. **Conversation transcript and sandbox filesystem are not canonical memory.**
11. **Durable programs/artifacts/recipes outlive sandboxes.**
12. **Sandbox snapshots/warm pools are runtime optimization, not skill/user state.**
13. **Provider seams are replaceable only where they cannot redefine ERP authority.**
14. **Execution is append-only traceable without persisting hidden chain-of-thought.**
15. **AI/sandbox outage degrades AI only; ordinary ERP usage continues.**

---

## 3. Core runtime primitives

```ts
interface AgentTask {
  id: AgentTaskId
  objective: string
  actorContextRef: TrustedContextRef
  budget: AgentBudget
  status: AgentTaskStatus
  activeArtifacts: readonly ArtifactRef[]
  activeEvidence: readonly EvidenceRef[]
}

interface AgentPlan {
  taskId: AgentTaskId
  requiredCapabilities: readonly CapabilityKey[]
  requiredRuntimeProfile?: RuntimeProfileKey
  reasoningClass: ReasoningClass
}

interface AgentBudget {
  maxModelCalls: number
  maxToolCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  maxDatasetRows: number
  maxSandboxPrograms: number
  maxSandboxRuntimeMs: number
  maxEvidenceBytes: number
  maxArtifactBytes: number
  maxExternalCalls: number
  maxDurationMs: number
}
```

Effective budget is runtime policy. IR may provide hints but never commercial/provider quotas.

---

## 4. Model capability profiles

Model routing should account for measured ability, not vendor labels in ERP contracts.

```ts
interface ModelCapabilityProfile {
  reasoning: "low" | "medium" | "high"
  toolSelection: "low" | "medium" | "high"
  structuredOutputReliability: number
  maxRecommendedTools: number
  maxRecommendedProgramIterations: number
  maxRecommendedEvidenceItems: number
}
```

Use eval-derived values.

Medium models may receive:

```text
fewer candidate capabilities
shorter hypothesis cycles
smaller evidence batches
more verifier checkpoints
```

Deep models may receive broader discovery/deeper hypothesis chains. Authorization, dataset isolation, sandbox rules and ERP semantics remain identical.

---

## 5. Capability discovery instead of giant tool prompts

```text
user objective
   ↓
intent/domain/entity classification
   ↓
generated CapabilityIndex search
   ↓
Casbin-filtered candidate set
   ↓
3–10 relevant operations
   ↓
full schemas loaded lazily
```

Discovery may combine deterministic tags, lexical search and semantic retrieval. Discovery filtering is not authorization proof.

Measure:

```text
candidate count
discovery precision/recall
tool-description tokens
hallucinated tool attempts
failed selection rate
```

---

## 6. Primary reasoning/execution loop

Replace a generic tool-result loop with a data-isolated analytical loop:

```text
UNDERSTAND
    ↓
DISCOVER
    ↓
PLAN ACQUISITION
    ↓
AUTHORIZE / ACQUIRE
    ↓
small direct fact? ── yes → VERIFY/PRESENT
    ↓ no
DatasetHandle(s)
    ↓
HYPOTHESIZE
    ↓
SCRIPT PYTHON
    ↓
VALIDATE / SCHEDULE SANDBOX
    ↓
EXECUTE
    ↓
OBSERVE EVIDENCE/ARTIFACTS
    ↓
VERIFY
    ↓
insufficient? ── yes → bounded HYPOTHESIZE/SCRIPT again
    ↓ no
PRESENT
```

Hard iteration/budget limits prevent wandering.

---

## 7. ERP acquisition execution pipeline

```text
CapabilityRequested
      ↓
input/schema validation
      ↓
trusted actor/org/company resolution
      ↓
Casbin authorization
      ↓
risk/confirmation
      ↓
admission/budget
      ↓
STDB/read-model operation
      ↓
ToolResultPolicy
      ├── direct → bounded evidence
      ├── sandbox-dataset → DatasetHandle
      └── aggregate-only → bounded aggregate artifact
      ↓
provenance
```

No generic model-provided SQL or reducer dispatch.

---

## 8. SandboxProvider seam

Safe replacement seam:

```rust
trait SandboxProvider {
    async fn create(&self, spec: SandboxSpec) -> Result<SandboxHandle>;
    async fn execute(
        &self,
        sandbox: &SandboxHandle,
        program: &AnalysisProgramRef,
    ) -> Result<SandboxExecutionResult>;
    async fn snapshot(&self, sandbox: &SandboxHandle) -> Result<SandboxSnapshotRef>;
    async fn destroy(&self, sandbox: &SandboxHandle) -> Result<()>;
}
```

Initial implementation:

```text
SandboxProvider
      ↓
DaytonaSandboxProvider
```

Keep Daytona-specific identifiers/configuration outside application-contract IR, skill definitions, recipes and durable artifacts.

Other safe provider seams remain:

```text
ModelProvider
EmbeddingProvider
SemanticIndexProvider
ResearchProvider
DocumentProcessor
OCRProvider
AgentPersistence
ContextRetriever
TelemetrySink
PresentationRenderer
```

Intentionally non-pluggable authority remains:

```text
Casbin authorization semantics
STDB reducer/business invariants
OrganizationPlacement ownership
ERP application-contract semantics
confirmation/risk enforcement
```

---

## 9. Sandbox scheduling and runtime profiles

The control plane chooses a versioned runtime profile based on the task/artifact requirement:

```text
lumiere-analysis-python
lumiere-documents-python
lumiere-spreadsheet-python
lumiere-research-python
```

Scheduling flow:

```text
AgentTask
  ↓
resolve RuntimeProfile + SandboxBudget
  ↓
admission
  ↓
claim Daytona warm sandbox if available
  └── otherwise create from approved snapshot/image
  ↓
bind task-scoped datasets/workspace
  ↓
execute Python
  ↓
persist outputs
  ↓
revoke grants
  ↓
destroy sandbox
```

Persistent/pause-resume sandboxes are exceptional runtime behavior for interactive/long-running tasks, not default user state.

---

## 10. Python program lifecycle

Model-authored Python should be persisted when useful:

```ts
interface AnalysisProgramArtifact {
  id: AnalysisProgramId
  contentHash: string
  runtimeProfile: RuntimeProfileRef
  entrypoint: string
  inputContract: AnalysisInputContract
  outputContract: AnalysisOutputContract
  sourceTaskId: AgentTaskId
  provenanceRef: ProvenanceRef
}
```

Programs may produce:

```text
EvidenceArtifact
ChartArtifact
SpreadsheetArtifact
DocumentArtifact
PdfArtifact
PresentationArtifact
TemplateArtifact
```

The sandbox filesystem is scratch; durable outputs go to artifact storage.

---

## 11. Append-only agent execution event model

Candidate events:

```ts
type AgentExecutionEvent =
  | TaskStarted
  | CapabilitySelected
  | CapabilityRequested
  | CapabilityAuthorized
  | CapabilityDenied
  | DatasetAcquired
  | HypothesisCycleStarted
  | ProgramCreated
  | SandboxRequested
  | SandboxClaimed
  | SandboxStarted
  | ProgramStarted
  | ProgramCompleted
  | EvidenceCreated
  | ArtifactCreated
  | VerificationCompleted
  | RecipeReused
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

Persist observable decisions/actions/evidence references, not hidden reasoning traces.

---

## 12. Artifact-first memory

Persist useful outputs as typed durable artifacts. Session state references them rather than replaying raw transcripts or preserving sandbox disks.

```text
AnalysisProgramArtifact
EvidenceArtifact
DatasetArtifact/manifest
ChartArtifact
SpreadsheetArtifact
DocumentArtifact
ResearchArtifact
ReportArtifact
TemplateArtifact
```

Canonical content lives in the authoritative artifact/file system (Scaleway Object Storage once bucket-ready); STDB/PG retain ownership/version/provenance/task/skill metadata.

Qdrant remains a derived semantic index over artifact/recipe/skill descriptions and references.

---

## 13. Context compiler

```ts
interface AgentSessionState {
  objective?: string
  activeArtifacts: readonly ArtifactRef[]
  activeEvidence: readonly EvidenceRef[]
  completedSteps: readonly CompletedStepRef[]
  summary: string
}
```

Compile model context from:

```text
current objective
small capability set
dataset schemas/metadata
prior bounded evidence
artifact summaries
recipe/skill summaries when retrieved
approval state
```

Do not inject raw sandbox datasets or full sandbox filesystem contents into model context.

---

## 14. Verification layer

Start deterministic:

- schema validity;
- evidence provenance completeness;
- dataset/task/scope binding;
- numeric claim/evidence matching;
- disclosure/cardinality limits;
- artifact hash/version registration;
- entity existence/reference validity;
- action risk/confirmation enforcement;
- sandbox produced no ERP mutation side effect.

Material prose claims require support checking before final presentation, under
the shared [harness evidence contract](./ai-harness-completion-plan.md#7-evidence-intellectual-provenance-and-knowledge-contract)
and M2 gate. Record deterministic, model-assisted and human review separately;
semantic model checks are fallible and do not confer domain approval. Missing or
ambiguous support triggers bounded retrieval, qualification, abstention or
required review; provider fallback and streaming cannot bypass this gate.

The context compiler must retain versioned source, contribution, claim and
decision references through compaction/resume. Artifact memory also includes
reviewed non-executable knowledge entries. Component-level lineage, source-change
invalidation and authorized source/decision inspection follow M1 and M3–M5 of
the same plan; execution traces or recipe reuse alone do not satisfy them.

---

## 15. Recipe and skill lifecycle

The default learning mechanism is not immediate skill creation.

```text
ad-hoc successful run
   ↓
persist program/artifacts/evidence
   ↓
reusable AnalysisRecipe
   ↓
repeated successful reuse + low correction
   ↓
SkillDraft
   ↓
fixtures/evals/review
   ↓
SkillVersion
```

Recipes/skills contain:

```text
objective/intent metadata
runtime profile/version
AnalysisProgramArtifact ref
required CapabilityKeys
input schema
output artifact kinds
templates/assets
evals/fixtures
```

They never contain persistent permission grants or live sandbox IDs.

Every reuse acquires fresh current datasets under fresh authorization.

---

## 16. User-driven product feedback

Use privacy-safe metadata from real work to identify:

```text
frequently combined capabilities
repeated objective clusters
high-reuse recipes/programs
common corrections
missing tools causing workarounds
common document/report/spreadsheet outputs
```

Possible progression:

```text
sandbox improvisation
→ repeated user value
→ recipe
→ reviewed skill
→ native deterministic capability/ERP feature
```

This should guide product investment before manually building speculative user workflows.

---

## 17. Replay/resume/fork semantics

Basic interrupt/reconnect/resume and checkpoint-based alternative comparison are
required for base harness M3/M6, under the
[interactive execution contract](./ai-harness-completion-plan.md#8-interactive-execution-and-recovery).
Advanced provider/sandbox replay may follow separately. The shared primitives are:

```text
resume task from durable artifacts/events
re-run Python program on fresh/current datasets
fork an AnalysisProgram/Recipe
retry failed model/program step with another model/provider
compare alternative presentations
```

Rules:

- historical business mutations are never replayed through sandbox replay;
- re-execution requires current authorization;
- stale dataset handles cannot silently be reused;
- forks get new task/correlation roots;
- sandbox snapshot reuse is runtime implementation detail, not semantic replay.

Persist required questions and user steering as versioned decision inputs;
independent authorized steps may proceed while dependent work waits. Checked
compaction restores objective, constraints, source/decision refs, unresolved
questions, effect state and budgets from durable records. Structured diagnostics
drive bounded candidate repair, and non-progress detection stops repeated failed
approaches before budget exhaustion. Interruption reconciles uncertain in-flight
effects before resuming; a fork never inherits execution approval.

Investigate/Design/Draft/Review mode profiles restrict capabilities within server
authorization. Delegated specialists and lifecycle extensions require separate
harness M8/M9 admission, including parent budget reservations, cancellation,
typed outputs and required/optional extension failure policy. Base admission
must not depend on enabling either capability.

---

## 18. Initial Scaleway/Daytona topology

```text
Cloudflare
   ↓ HTTPS/SSE
Agent API / Control Plane — Scaleway Paris
   ↓
Capability discovery + Casbin/STDB
   ↓
Dataset broker
   ↓
Sandbox Scheduler
   ↓
Daytona SandboxProvider
   ↓
Python runtimes
   ↘
    Scaleway Object Storage — programs/artifacts/templates
```

Keep Daytona deployment/data-residency assumptions behind the provider seam until validated.

AI/sandbox traffic must have separate admission so sandbox spikes cannot starve normal ERP/STDB traffic.

---

## 19. Phases

### ACP0 — control-plane skeleton

- [ ] define `AgentTask`, `AgentPlan`, `AgentBudget`, session/evidence/artifact refs;
- [ ] implement generated capability/entity discovery + Casbin candidate filtering;
- [ ] implement provider-neutral model router + `ModelCapabilityProfile`;
- [ ] implement `SandboxProvider` seam;
- [ ] separate acquisition executor from sandbox executor;
- [ ] enforce model/tool/data/sandbox/time budgets;
- [ ] add structured SSE status events.
- [ ] integrate harness AIH-20–24 durable questions, bounded repair/non-progress,
  checked compaction and session controls before base M6 admission.

### ACP1 — Daytona + Python orchestration

- [ ] integrate Daytona behind `SandboxProvider`;
- [ ] implement runtime-profile resolution;
- [ ] schedule ephemeral sandboxes and cleanup/TTL;
- [ ] connect task-scoped DatasetHandles to sandbox runtime;
- [ ] persist `AnalysisProgramArtifact` before/after execution as appropriate;
- [ ] return only bounded evidence/artifact refs to the model.

### ACP2 — execution trace + verification + artifact foundation

- [ ] persist typed append-only execution events;
- [ ] correlate agent/sandbox events with ERP operation/correlation IDs;
- [ ] persist evidence/program/document/chart/spreadsheet metadata;
- [ ] build context compiler from objective + schemas + evidence + artifacts;
- [ ] add deterministic claim/evidence verification;
- [ ] satisfy harness M1–M3 source/decision capture, prose support and inspection
  gates before final-answer admission;
- [ ] add action-trace/debug UI sourced from durable events;
- [ ] measure model-context reduction against raw-result baseline.

### ACP3 — recipe reuse and skill promotion

- [ ] define `AnalysisRecipe` + personal/team/org scope;
- [ ] retrieve/fork reusable programs for similar objectives;
- [ ] record reuse success/correction metrics;
- [ ] define reviewed SkillDraft/SkillVersion format over program/runtime/capability refs;
- [ ] require fresh authorization/dataset acquisition per reuse;
- [ ] satisfy harness M4/M5 knowledge review and source-change gates before
  knowledge/recipe publication; repeated success is not domain approval;
- [ ] prove sandbox state/snapshots are not required for skill execution.

### ACP4 — scaling and model economics

- [ ] evaluate Fast/Standard/Deep routing on representative corpus;
- [ ] tune `ModelCapabilityProfile` from measured performance;
- [ ] add Daytona snapshots/warm pools for common runtime profiles;
- [ ] measure cold/warm startup, sandbox cost and task success;
- [ ] add escalation based on objective/verifier/program failures;
- [ ] validate SandboxProvider/ModelProvider replacement without ERP contract changes.

---

## 20. Required evaluation corpus

Maintain representative tasks for:

```text
invoice/order lookup
receivables/margin analysis
audit-history summarization
uploaded dataset mapping
DOCX/PDF report creation
spreadsheet creation
research synthesis
consequential mutation proposals
reused recurring management reports
```

Include tests for:

```text
raw-row exposure
sandbox egress/credential denial
trace reconstruction
provider failure
sandbox cancellation/TTL cleanup
recipe reuse with fresh authorization
replay without duplicate side effects
medium vs deep model routing
Daytona warm-pool behavior
```

---

## 21. Explicitly deferred

- unrestricted autonomous agents;
- permanent sandbox per user by default;
- sandbox filesystem as canonical memory;
- direct LLM access to PG/STDB/Object Storage;
- static infrastructure credentials in sandboxes;
- ERP mutations from Python sandbox;
- provider/model names in application-contract IR;
- raw transcript as canonical memory;
- autonomous skill publication from one successful run;
- making Casbin/STDB/business authority pluggable;
- skill definitions tied to Daytona sandbox/snapshot IDs.

---

## 22. Acceptance criteria

The control plane is successful when:

- smaller and stronger models can complete representative ERP tasks through the same generated capabilities/dataset/sandbox contracts;
- raw multi-row organization data remains outside normal model context;
- models can write Python inside isolated sandboxes and receive bounded verified evidence;
- Daytona is replaceable behind `SandboxProvider`;
- task sandboxes are ephemeral by default while programs/artifacts/recipes are durable;
- model/provider/runtime changes require deployment configuration, not ERP contract regeneration;
- sessions continue from artifacts/evidence without preserving sandbox filesystems or replaying raw transcripts;
- repeated successful user work can become reusable recipes and reviewed skills under explicit promotion/review;
- product telemetry can identify repeated sandbox workarounds that deserve native deterministic capabilities;
- durable execution events reconstruct the user-visible action/evidence trace;
- sandbox overload/provider failure cannot block ordinary ERP use;
- Casbin/STDB remain authorization/business authorities.
