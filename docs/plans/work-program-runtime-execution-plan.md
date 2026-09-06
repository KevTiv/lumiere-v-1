# WorkProgram runtime execution and orchestration plan

**Status:** Proposed — 2026-08-24  
**Tracks:** `work-program`, `runtime`, `orchestration`, `checkpoints`, `resume`, `automation`, `step-engine`, `program-run`, `approvals`, `idempotency`  
**Related:** [work-program-ui-harness-convergence-plan.md](./work-program-ui-harness-convergence-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-sandbox-data-analysis-plan.md](./agent-sandbox-data-analysis-plan.md) · [agent-performance-admission-cost-plan.md](./agent-performance-admission-cost-plan.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Objective

Define one canonical runtime for reusable business work so reports, imports, document/OCR checks, research workflows, sandbox programs, and composed ERP capability sequences do not each grow a separate orchestration engine.

Target model:

```text
WorkProgramVersion
      ↓
validate / compile
      ↓
ExecutableProgramGraph
      ↓
ProgramRun
      ↓
step scheduler
  ├── deterministic step
  ├── model step
  ├── sandbox/code step
  ├── research/document step
  ├── capability/draft step
  └── approval/wait step
      ↓
checkpoint / artifact / evidence / action refs
      ↓
completed / failed / waiting / cancelled
```

The runtime coordinates work. It does **not** become ERP authority. STDB reducers, generated application contracts, Casbin, risk policy, and approval rules remain authoritative.

---

## 2. Non-negotiable invariants

1. Published `WorkProgramVersion`s are immutable.
2. Every run pins one exact program version.
3. Every consequential capability invocation is re-authorized at execution time.
4. Sandbox code cannot mutate ERP state directly.
5. Program state is durable outside the sandbox.
6. Retry ownership is explicit per step; clients must not blindly replay consequential steps.
7. Long-running work is checkpointed and resumable.
8. Raw model chain-of-thought is never persisted as runtime state.
9. Program execution is bounded by model, acquisition, sandbox, artifact, duration, and cost budgets.
10. A failed or unavailable AI runtime must not block ordinary ERP operation.

---

## 3. Core runtime types

```ts
interface ExecutableProgramGraph {
  programVersion: WorkProgramVersionRef
  inputSchema: SchemaRef
  outputSchema: SchemaRef
  steps: readonly ProgramStep[]
  edges: readonly ProgramEdge[]
  requiredCapabilities: readonly CapabilityKey[]
  runtimeProfiles: readonly RuntimeProfileRef[]
}

interface ProgramRun {
  id: ProgramRunId
  organizationId: OrganizationId
  programVersion: WorkProgramVersionRef
  actorContextRef: TrustedContextRef
  status: ProgramRunStatus
  inputArtifact?: ArtifactRef
  completedSteps: readonly ProgramStepRunRef[]
  activeStep?: ProgramStepId
  checkpoint?: ProgramCheckpointRef
  outputs: readonly ArtifactRef[]
  correlationId: CorrelationId
}

type ProgramRunStatus =
  | "queued"
  | "running"
  | "waiting-approval"
  | "waiting-external"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
```

The exact persistence shape may be split across STDB/PG/event storage, but semantics should remain stable.

---

## 4. Step taxonomy

```ts
type ProgramStep =
  | AcquireDatasetStep
  | RunCodeArtifactStep
  | ModelReasoningStep
  | ResearchStep
  | DocumentExtractStep
  | OcrStep
  | RenderArtifactStep
  | InvokeCapabilityStep
  | DraftActionStep
  | WaitForApprovalStep
  | WaitForExternalStep
```

Classify every step by effect:

```text
deterministic
probabilistic
consequential
waiting/external
```

### Deterministic

Examples:

- dataset acquisition contract resolution;
- Python execution against a pinned `CodeArtifact`;
- schema validation;
- rendering a document from known inputs;
- deterministic artifact transforms.

### Probabilistic

Examples:

- model interpretation;
- web research selection/synthesis;
- OCR/document semantic extraction where confidence is non-deterministic;
- anomaly explanation.

### Consequential

Examples:

- draft an ERP mutation;
- invoke an approved generated capability;
- create or update an STDB-backed business record.

Consequential steps always pass through normal generated application contracts and never execute from sandbox privileges.

---

## 5. Graph compilation and validation

A `WorkProgramDraft` is not directly executable. Publication compiles it into an `ExecutableProgramGraph`.

Compile-time validation must resolve:

```text
step ids and graph acyclicity / approved loops
input/output schemas
capability existence
runtime profile existence
CodeArtifact hashes/versions
required approval boundaries
step effect classes
traffic/cost profiles
allowed trigger bindings
presentation output compatibility
```

Do not permit arbitrary runtime strings for reducer names, URLs, raw SQL, or sandbox provider identifiers.

Controlled iteration is allowed only through explicit bounded constructs, for example:

```ts
interface BoundedRepeatPolicy {
  maxIterations: number
  stopCondition: ProgramConditionRef
}
```

No unbounded dynamic loop generated from model output.

---

## 6. ProgramRun state machine

Canonical lifecycle:

```text
created
  ↓
queued
  ↓
running
  ├──→ waiting-input
  │        ↓
  │      running
  ├──→ waiting-approval
  │        ↓
  │      running
  ├──→ waiting-external
  │        ↓
  │      running
  ├──→ paused
  │        ↓
  │      running
  ├──→ failed
  ├──→ cancelled
  └──→ completed
```

A renderer may display progress but never owns program state.

`waiting-input` is distinct from approval. Required question dependencies suspend
their steps; unrelated ready steps can continue, and the run waits only when no
eligible work remains. Persist question/reply versions and respondent identity;
stale replies deny and duplicate replies are idempotent. Steering versions the
objective/decision and invalidates affected checks/approvals. Apply the shared
[harness interactive execution gates](./ai-harness-completion-plan.md#8-interactive-execution-and-recovery).

---

## 7. Checkpoints and resumability

Persist a checkpoint after any step that is expensive, externally visible, consequential, or required for restart safety.

```ts
interface ProgramCheckpoint {
  runId: ProgramRunId
  completedStepIds: readonly ProgramStepId[]
  stepOutputs: readonly ProgramStepOutputRef[]
  artifactRefs: readonly ArtifactRef[]
  evidenceRefs: readonly EvidenceRef[]
  approvalRefs: readonly ApprovalRef[]
  questionRefs: readonly QuestionRequestRef[]
  decisionRefs: readonly DecisionVersionRef[]
  continuationManifestRef: ContinuationManifestRef
  datasetWatermarks: readonly DatasetWatermarkRef[]
  createdAt: string
}
```

Resume semantics:

- deterministic completed steps may reuse immutable outputs when their dependencies remain valid;
- stale dataset handles must be reacquired;
- consequential completed steps are never blindly replayed;
- externally sourced results may require freshness checks;
- model steps may be re-run only when the program policy allows it;
- a resumed run retains one correlation lineage.

The continuation manifest preserves objective/constraint versions, completed
effect references, remaining budget and repair/non-progress state. Validate it
after compaction and before resume against authoritative records, with fresh
access checks; summaries cannot restore permissions or reset budgets. Event
cursors, request versions and idempotency protect multi-client reconnect/resume.
Interrupt stops new scheduling and cancels supported in-flight work; reconcile
uncertain consequential outcomes before allowing further effects. Forked
alternatives retain parent lineage but require fresh execution approval and
admitted budgets. Reverting a candidate is not an ERP business reversal.

---

## 8. Retry and idempotency ownership

Every step declares retry semantics.

```ts
interface StepRetryPolicy {
  class: "never" | "transient-safe" | "idempotency-keyed" | "manual"
  maxAttempts: number
}
```

Rules:

- read-only deterministic acquisition may retry transiently;
- model calls may retry only within budget and provider policy;
- sandbox program execution may retry if inputs and artifact version are unchanged and no consequential side effect occurred;
- consequential steps require the underlying capability's idempotency semantics;
- approval steps are not retried as mutations;
- frontend reconnect must recover state rather than replay the last step.
- structured validator diagnostics bind to candidate/component versions; repairs
  create a new candidate and revalidate within shared attempt/cost limits;
- repeated unchanged results/errors trigger bounded replan/question/stop;
  admitted polling has explicit time/attempt/backoff limits and cannot reset
  the task budget by changing provider.

---

## 9. Simulation, dry-run, preview, and live execution

Support explicit run modes:

```ts
type ProgramExecutionMode =
  | "simulate"
  | "dry-run"
  | "preview"
  | "live"
```

Suggested semantics:

```text
simulate
  fixtures/synthetic or approved historical test inputs

dry-run
  current authorized data, no consequential capability execution

preview
  current data + draft actions / impact summary

live
  consequential steps may proceed under normal approval/risk rules
```

This is especially important for imports, replenishment, bulk corrections, and organization-wide automations.

---

## 10. Automation and trigger binding

An `Automation` is a durable trigger binding to an immutable program version.

```ts
interface AutomationBinding {
  id: AutomationId
  organizationId: OrganizationId
  programVersion: WorkProgramVersionRef
  trigger: TriggerDescriptor
  inputBinding: ProgramInputBinding
  executionPolicy: AutomationExecutionPolicy
  status: "enabled" | "paused" | "disabled"
}
```

Supported trigger families may include:

```text
manual
schedule
domain event
state transition
document upload
```

Triggers start a run; they never grant authority.

Automation policy must define:

```text
deduplication key
misfire behavior
max overlapping runs
backpressure
retry ownership
version pinning
```

Do not bind automations to `latest` WorkProgram versions.

---

## 11. Program execution and UI

The shared frontend renders server-owned state:

```text
ProgramRunForm
ProgramRunProgress
ProgramOutputViewer
ProgramRunHistory
ProgramVersionDiff
```

A module button or dashboard section sends a typed `RunProgramIntent` and observes `ProgramRun` status. It does not execute individual graph steps in the client.

Dashboard rendering must never implicitly trigger an expensive run.

---

## 12. Observability

Record structured events such as:

```text
ProgramRunCreated
ProgramRunQueued
StepReady
StepStarted
StepCompleted
StepFailed
CheckpointCreated
ApprovalRequested
ApprovalResolved
ProgramPaused
ProgramResumed
ProgramCompleted
ProgramFailed
ProgramCancelled
```

Metrics:

```text
run p50/p95/p99 duration
step latency by type
model calls/tokens
sandbox queue/start/runtime
acquisition rows/bytes
artifact bytes
retries
approval wait time
success/failure/cancellation rate
cost per run
```

---

## 13. Performance and admission

Before a run starts, derive its effective `AiExecutionCostProfile` and program-level execution budget from the pinned graph.

Separate pools should remain available for:

```text
interactive program runs
artifact/report generation
bulk import/migration
research/document processing
background automation/evals
```

A program with a valid graph may still be denied/deferred when execution capacity is unavailable.

---

## 14. Persistence split

Suggested authority split:

```text
STDB
  active ProgramRun state where interactive/realtime value is useful
  approvals / authoritative business transitions

Postgres
  durable run/event history
  checkpoints / compatibility history / cost metrics

Object Storage
  code artifacts
  datasets/manifests
  evidence
  reports/docs/spreadsheets
  rendered outputs
```

Exact placement should follow the existing hot/cold architecture rather than create a parallel persistence system.

---

## 15. Implementation phases

### WPR-0 — canonical types and compiler

- [ ] define `WorkProgramVersion`, `ExecutableProgramGraph`, `ProgramRun`, `ProgramStep`, `ProgramCheckpoint`;
- [ ] define step effect classes;
- [ ] compile drafts into validated graphs;
- [ ] reject unresolved capabilities/runtime/artifacts;
- [ ] add graph fixture tests.

### WPR-1 — deterministic run engine

- [ ] implement scheduler for acquire/code/render steps;
- [ ] persist run state/events;
- [ ] support pause/cancel/failure;
- [ ] add checkpoint/resume;
- [ ] enforce task/program budgets.

### WPR-2 — model/research/document integration

- [ ] integrate model/research/OCR/document step adapters;
- [ ] keep provider details outside graph semantics;
- [ ] add bounded retry and freshness rules;
- [ ] persist evidence/provenance refs.

### WPR-3 — consequential capability/approval integration

- [ ] support draft-action and invoke-capability steps;
- [ ] route every consequential call through generated contracts/Casbin;
- [ ] implement approval wait/resume;
- [ ] prove no sandbox path can mutate STDB directly.

### WPR-4 — automation triggers

- [ ] add immutable version-pinned schedule binding;
- [ ] add domain-event/state-transition trigger proof where justified;
- [ ] implement overlap/dedup/misfire policies;
- [ ] prove reconnect/restart does not duplicate runs.

### WPR-5 — simulation and UX proof

- [ ] support simulate/dry-run/preview/live modes;
- [ ] expose shared ProgramRun UI state;
- [ ] prove one report, one import, and one document/OCR program through the same engine.

---

## 16. Acceptance criteria

This plan is successful when:

- all reusable WorkPrograms execute through one durable runtime;
- reports/imports/documents/composed capability sequences do not have separate orchestration engines;
- runs resume from checkpoints without replaying completed consequential steps;
- automations pin immutable program versions;
- simulation/dry-run works for consequential programs;
- UI observes server-owned run state rather than orchestrating execution;
- sandbox/model/provider implementations remain replaceable without changing WorkProgram semantics;
- STDB/Casbin/generated contracts remain the only authority for ERP state changes.
