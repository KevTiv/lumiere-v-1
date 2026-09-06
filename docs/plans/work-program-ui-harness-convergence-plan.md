# WorkProgram, reusable-code, UI, and harness convergence plan

**Status:** Proposed — 2026-08-24
**Tracks:** `work-programs`, `code-artifacts`, `frontend-ir`, `presentation-ir`, `agent-harness`, `runtime-extensions`, `reports`, `imports`, `documents`, `automation`, `program-registry`
**Related:** [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-sandbox-data-analysis-plan.md](./agent-sandbox-data-analysis-plan.md) · [agent-sandbox-import-onboarding-plan.md](./agent-sandbox-import-onboarding-plan.md) · [agent-generated-erp-tool-surface-plan.md](./agent-generated-erp-tool-surface-plan.md) · [agent-performance-admission-cost-plan.md](./agent-performance-admission-cost-plan.md)

---

## 1. Objective

Converge Lumiere's planned renderer-neutral frontend architecture and AI harness around one reusable unit of user work:

```text
CodeArtifact
    ↓
reusable executable implementation

WorkProgram
    ↓
typed composition of:
  generated ERP capabilities
  sandbox code
  research/document/OCR capabilities
  model reasoning slots
  action drafts / approval boundaries
  output artifacts

Skill
    ↓
agent-facing discovery/instruction packaging around WorkPrograms

Automation
    ↓
trigger/schedule binding to a published WorkProgram
```

The goal is for successful AI-assisted work to graduate from chat into ordinary ERP UI without creating a second frontend architecture.

Examples:

```text
farm feed manufacturing report
supplier contract review
historical Excel importer
month-end management pack
stock replenishment recommendation
customer-credit review
```

A user should be able to create one of these interactively with the assistant, test it, save it, and later encounter it as a normal module tool/report/button/scheduled workflow on web or mobile.

Core ERP state transitions remain STDB reducer-owned. WorkPrograms compose existing capabilities; they do not become an alternate database-authority layer.

---

## 2. Architectural boundary

Keep three layers distinct:

```text
Application-contract IR
  = what Lumiere can authoritatively read/do

Workflow / Presentation IR
  = how authoritative ERP work is presented across surfaces

WorkProgram registry/contract
  = versioned user/team/system compositions of permitted capabilities,
    reusable code artifacts, model steps, and outputs
```

Do not inject organization-created program logic into the canonical application IR.

Application IR remains build-time/platform truth. WorkPrograms are runtime versioned extension metadata validated against the current application-contract version.

```text
Application IR
      ↓ exposes
CapabilityKey / EntityKey / Schema / Risk / Traffic / ResultPolicy
      ↓ referenced by
WorkProgramVersion
      ↓ presented through
PresentationDefinition / ProgramPresentation
      ↓ rendered by
web / native / future renderer
```

---

## 3. Core primitives

### 3.1 `CodeArtifact`

Use a first-class durable executable artifact below skills/recipes:

```ts
interface CodeArtifact {
  id: CodeArtifactId
  version: number
  scope: "personal" | "organization" | "system"
  language: "python" | "declarative" | "wasm"
  runtimeProfile: RuntimeProfileRef
  sourceRef: ArtifactRef
  dependencyLockRef?: ArtifactRef
  inputSchema: SchemaRef
  outputSchema: SchemaRef
  requiredCapabilities: readonly CapabilityKey[]
  effectClass: "read-only" | "artifact-producing" | "draft-producing"
  provenanceRef: ProvenanceRef
  status: "draft" | "tested" | "approved" | "deprecated"
}
```

Python remains the first exploratory/reusable implementation language. WASM/declarative promotion may be evaluated later for stable deterministic extensions.

### 3.2 `WorkProgramVersion`

```ts
interface WorkProgramVersion {
  id: WorkProgramId
  version: number
  scope: "personal" | "organization" | "system"

  title: string
  description?: string
  intentTags: readonly string[]

  inputSchema: SchemaRef
  steps: readonly WorkProgramStep[]
  outputs: readonly WorkProgramOutput[]

  presentation: ProgramPresentation
  requiredCapabilities: readonly CapabilityKey[]
  runtimeProfiles: readonly RuntimeProfileRef[]

  contractVersion: ContractVersion
  status: "draft" | "testing" | "published" | "deprecated"
  provenanceRef: ProvenanceRef
}
```

### 3.3 Step kinds

```ts
type WorkProgramStep =
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
```

Classify every step as one of:

```text
deterministic
probabilistic
consequential
```

This classification drives retry, verification, audit, and presentation behavior.

---

## 4. Example: farm feed manufacturing executive report

A user asks:

> Produce our monthly feed-manufacturing output report, compare input/output efficiency, include current feed commodity prices, and explain material changes.

First run:

```text
agent discovers manufacturing/inventory/purchasing capabilities
      ↓
authorized ERP datasets
      ↓
Python sandbox computes yield/cost/waste trends
      ↓
research capability retrieves current market prices
      ↓
model reasoning slot explains material variance
      ↓
renderer creates ReportArtifact + charts
      ↓
user accepts result
```

Promoted WorkProgram:

```text
Farm Feed Manufacturing Report v1
  acquire manufacturing output dataset
  acquire consumed feed/input dataset
  acquire purchasing cost dataset
  run code-artifact://feed-efficiency/v1
  research current commodity prices
  run bounded executive-commentary model step
  render report://farm-feed-management/v1
```

On later runs, the harness reuses the fixed program skeleton and code artifact with fresh authorized data. The model is only used where reasoning/research remains useful.

The UI can expose this same program as:

```text
Manufacturing → Reports → Feed production review
Dashboard → Generate current review
Command palette → Run Feed Manufacturing Report
```

No new React page or STDB reducer is required.

---

## 5. Program presentation contract

Add a renderer-neutral presentation contract specifically for executable work:

```ts
interface ProgramPresentation {
  title: string
  description?: string
  icon?: SemanticIconKey

  input: ProgramInputPresentation
  run: ProgramRunPresentation
  outputs: readonly ProgramOutputPresentation[]

  placements?: readonly ProgramPlacementIntent[]
  allowManualRun: boolean
  allowSchedule: boolean
  allowFork: boolean
}
```

Input UI should primarily derive from the program input schema plus semantic presentation hints:

```ts
interface ProgramInputPresentation {
  groups?: readonly FieldGroupPresentation[]
  submitLabel?: string
  expectedDurationClass?: "instant" | "interactive" | "task"
}
```

Do not store React component names or CSS layout in this contract.

### Output presentation

Output kinds should map naturally onto existing presentation primitives:

```text
EvidenceArtifact      → metric/small-table/evidence renderer
ChartArtifact         → chart renderer
SpreadsheetArtifact   → workbook/file viewer
DocumentArtifact      → document viewer
PdfArtifact           → PDF viewer
ReportArtifact        → report presentation
ImportProposal        → import review workflow
ActionDraft           → action preview/approval
ProgramRunTrace       → progress/trace panel
```

Platform renderers remain free to choose the UX.

All answer/report and component renderers must support the shared
[harness source/decision inspector and gates](./ai-harness-completion-plan.md#milestones-and-acceptance-criteria).
From a material claim or workflow/formula/code component, an authorized reviewer
must reach its exact versioned passage, original author, discussion contributor,
interpretation/adaptation, validation and review history. Display unresolved,
superseded and unavailable-source states; reauthorize excerpt reads and exports.
Candidate prose is not a validated final answer until M2; trace events alone do
not satisfy M3, and publication/reuse requires applicable M4/M5 checks.

M3 also requires typed question/answer, interrupt/resume and compare/fork controls
from the [interactive execution contract](./ai-harness-completion-plan.md#8-interactive-execution-and-recovery).
Recover pending inputs and progress from durable events on reconnect; distinguish
waiting for input, approval and in-flight effect reconciliation. Show candidate
diagnostics/repair history and source/decision/component differences between
alternatives. Selecting a mode, replying to a question or choosing a candidate
cannot grant execution approval. Specialist/extension controls appear only after
their separate M8/M9 admission.

---

## 6. Program placement instead of bespoke page creation

Introduce renderer-neutral extension slots:

```ts
interface ProgramPlacementIntent {
  surface:
    | "module-tool"
    | "module-report"
    | "entity-action"
    | "dashboard-section"
    | "command-palette"
    | "workspace-tool"

  module?: DomainKey
  entity?: EntityKey
  priority?: number
}
```

Examples:

```text
supplier contract review
→ Purchasing / Contacts document tool

feed manufacturing report
→ Manufacturing report

historical invoice importer
→ Accounting import tool

weekly pipeline brief
→ CRM dashboard section + scheduled automation
```

Placement is presentation metadata only. It does not grant capabilities.

The frontend resolves visible published programs for the current actor/org/context, then the server re-authorizes every run and consequential step.

---

## 7. Frontend package convergence

Extend the planned frontend package layout:

```text
packages/
  workflow-core/
  presentation-core/
  work-program-core/       NEW
  design-tokens/
  ui-web/
  ui-native/
```

`work-program-core` owns renderer-neutral types/helpers only:

```text
WorkProgramDescriptor
ProgramPresentation
ProgramPlacementIntent
ProgramRunState
ProgramOutputRef
ProgramVersionSummary
```

It must not import:

```text
React
Next.js
React Native
Daytona SDK
model-provider SDKs
raw STDB bindings
```

The renderer packages implement:

```text
ProgramCatalog
ProgramRunForm
ProgramRunProgress
ProgramOutputViewer
ProgramVersionHistory
ProgramPublishReview
ProgramPlacementPicker
AutomationBindingEditor
```

---

## 8. Generated UI and runtime metadata division

Do not make WorkProgram UI entirely free-form.

Generated application contracts already know:

```text
field type
entity type
semantic format
risk
confirmation
traffic class
result policy
```

Program input/output contracts should reuse these stable descriptors where possible.

Example:

```text
Program input references CompanyId
→ renderer gets canonical company selector intent

Program step references accounting.invoice.create.draft
→ preview uses generated action/result descriptors
```

But the application IR must not generate tenant WorkPrograms.

Correct dependency direction:

```text
Application IR metadata
        ↓
WorkProgram validator / presentation compiler
        ↓
Program UI contract
```

not:

```text
user WorkProgram
        ↓
mutate/redefine application IR
```

---

## 9. Harness execution convergence

The Agent Control Plane should execute both exploratory tasks and published WorkPrograms through the same primitives.

Exploratory:

```text
objective
→ discover
→ acquire
→ model plans/scripts
→ sandbox
→ evidence/artifact
```

Published program:

```text
WorkProgramVersion
→ validate contract compatibility
→ bind typed inputs
→ authorize required capabilities
→ execute known steps
→ invoke model only for declared model steps
→ sandbox only for declared code steps
→ verify
→ produce typed outputs
```

This is a major performance feature: repeatable work does not require replanning every run.

### Runtime events

Extend execution events conceptually with:

```text
WorkProgramRunStarted
WorkProgramStepStarted
WorkProgramStepCompleted
WorkProgramPausedForApproval
WorkProgramOutputCreated
WorkProgramRunCompleted
WorkProgramRunFailed
WorkProgramVersionForked
WorkProgramPublished
```

A run is resumable from durable step/output/checkpoint state, not from sandbox process memory.

---

## 10. Program creation/editing UX

Support two creation paths sharing the same underlying object.

### Conversational creation

```text
user asks assistant to perform work
        ↓
exploratory successful run
        ↓
"Save as reusable tool"
        ↓
WorkProgramDraft generated from actual run
        ↓
test / inspect / rename / choose placement
        ↓
publish
```

### Structured editing

Advanced/admin UI can expose:

```text
metadata
inputs
ordered step graph
outputs
capability requirements
runtime profiles
fixtures/evals
placements
schedule/trigger bindings
version diff
```

Do not make a generic visual-programming canvas a Phase 1 requirement. A simple ordered step/section editor plus conversational editing is enough initially.

---

## 11. Versioning, fork, publish, rollback

Published programs are immutable versions.

```text
Draft
 ↓ test
Testing
 ↓ publish
Published v1
 ↓ edit/fork
Draft v2
```

Required operations:

```text
create
fork
edit draft
run test fixture
compare versions
publish
rollback active binding
archive/deprecate
```

A user request such as:

> Separate Nairobi and Mombasa in this report.

must create/fork a new draft version rather than silently mutating the published program used by scheduled runs.

---

## 12. Skill becomes discovery packaging, not executable authority

Refine `SkillVersion` so it may reference one or more WorkPrograms:

```ts
interface SkillVersion {
  id: SkillId
  intentMetadata: SkillIntentMetadata
  workPrograms: readonly WorkProgramRef[]
  guidance?: ArtifactRef
  evals: readonly EvalRef[]
}
```

The skill helps the agent decide:

```text
when this reusable work is useful
what inputs it needs
which WorkProgram to invoke
how to interpret/present its output
```

The executable semantics live in WorkProgram/CodeArtifact contracts.

Avoid duplicating Python/program definitions inside skill markdown.

---

## 13. Automations/triggers

Automation is a binding, not another workflow implementation:

```ts
interface WorkProgramAutomation {
  id: AutomationId
  program: WorkProgramVersionRef
  trigger: TriggerDescriptor
  boundInputs: TypedInputBinding
  ownerScope: OrganizationId
  enabled: boolean
}
```

Candidate trigger families:

```text
manual
schedule
domain event
state transition
document uploaded
import file received
```

Phase 1 may support manual + schedule first. Event/state triggers require explicit authoritative event contracts before enabling them.

Trigger execution never carries stored permission grants. Actor/service identity and current authorization are resolved at runtime.

---

## 14. Consequential steps and STDB boundary

WorkPrograms may compose reducer calls, but never bypass reducer authority.

Example:

```text
Excel workbook
→ sandbox normalize
→ validation/import proposal
→ user approves
→ customer.import.batch reducer
→ invoice.import.batch reducer
→ checkpoint
```

Each consequential step must specify one of:

```text
draft-only
approval-required
automation-eligible capability
```

The harness still performs:

```text
schema validation
trusted actor/org/company resolution
Casbin
risk/confirmation
admission
idempotency
STDB business validation
```

A WorkProgram does not receive a generic `call_reducer(name, args)` primitive.

---

## 15. Document/OCR/research integration

Treat external/unstructured operations as provider-neutral step semantics.

Example document step:

```text
extract:
  contract.parties
  contract.effective_date
  contract.expiry_date
  contract.payment_terms
  contract.price_schedule
```

Runtime resolves this through `DocumentProcessor` / `OCRProvider`.

Example research step:

```text
research objective:
  current animal-feed commodity prices
region:
  East Africa
freshness:
  current
required_sources:
  2
```

Runtime resolves through `ResearchProvider`.

Program definitions must not hard-code a search engine, OCR vendor, or model provider unless a provider-specific feature is explicitly required.

All external evidence carries provenance and trust classification.

---

## 16. Dashboard/report convergence

Extend dashboard/report definitions so sections may reference published WorkProgram outputs/runs in addition to direct generated queries.

Example:

```ts
type DashboardSection =
  | MetricGroupSection
  | WorkflowQueueSection
  | TimeSeriesSection
  | ReportTableSection
  | WorkProgramSection
```

`WorkProgramSection` can represent:

```text
last successful output
run-now action
scheduled output freshness
program status
artifact drill-down
```

Do not automatically execute expensive programs on every dashboard render.

The section must obey the AI performance/admission cost plan and may display the last verified artifact with an explicit freshness timestamp.

---

## 17. Offline/mobile behavior

The WorkProgram UI must distinguish:

```text
view cached/persisted output
start online program run
resume program status
approve queued consequential step
```

from actually executing the cloud sandbox offline.

Initial rule:

- previously persisted report/document outputs may be available offline through normal artifact caching policy;
- WorkProgram definitions/catalog can be cached;
- cloud/model/research/sandbox steps require connectivity;
- offline mutation intentions use the existing offline changeset/review architecture, not hidden WorkProgram replay;
- app reconnect must query authoritative ProgramRun state rather than blindly replaying the last step.

---

## 18. Registry/storage model

Use one Extension/Work registry rather than separate stores per feature family.

```text
STDB / hot operational metadata
  active published program bindings
  org/user ownership
  placements
  run status
  approval state
  automation bindings

Postgres / durable metadata/history
  immutable version history
  execution history
  eval results
  long-term run metrics

Object Storage
  CodeArtifact source
  dependency locks
  templates/assets
  reports/docs/spreadsheets
  large evidence/program outputs

Qdrant
  derived semantic discovery over
    program descriptions
    skill descriptions
    successful prior work
```

STDB remains authority for active ERP-facing state; object storage is canonical for artifact bytes.

---

## 19. Program compatibility and contract evolution

Every published WorkProgram records the application contract version and referenced capability/schema versions.

On deployment/codegen changes:

```text
current contract
  ↓
compatibility validator
  ↓
program remains compatible
OR
program requires migration/retest
```

Never discover breakage only when a scheduled program runs in production.

CI/runtime checks should identify:

- missing capability;
- incompatible input/output schema;
- changed risk/confirmation requirement;
- unavailable runtime profile;
- deprecated entity/field refs;
- changed traffic/result policy requiring retest.

---

## 20. Performance/admission integration

Published programs should have a measured/declared execution cost profile.

```ts
interface WorkProgramCostProfile {
  executionClass: AiExecutionClass
  expectedModelCalls: "none" | "one" | "few" | "iterative"
  expectedSandboxRuns: number
  expectedDatasets: number
  expectedArtifactClass: ArtifactCostClass
  canRunInteractive: boolean
}
```

Use the existing AI performance/admission plan for actual dynamic limits.

Key rules:

- reused deterministic programs should avoid planner/model calls;
- dashboards reuse last artifacts unless explicit rerun policy says otherwise;
- bulk imports do not compete with interactive report/chat capacity;
- identical program runs with identical authoritative inputs may only reuse results when freshness/provenance policy permits;
- program version metrics measure model calls, sandbox time, acquisition cost, corrections and user acceptance.

---

## 21. Implementation phases

### WPUI0 — contracts and package boundary

- [ ] define `CodeArtifact`, `WorkProgramVersion`, `WorkProgramStep`, `ProgramPresentation`;
- [ ] create renderer-neutral `work-program-core` package boundary;
- [ ] define immutable version/fork/publish lifecycle;
- [ ] define program compatibility references to application-contract versions;
- [ ] ensure programs cannot embed authorization grants or raw reducer names.

**Exit:** one hand-authored fixture can be serialized and consumed without React/Daytona/model-provider dependencies.

### WPUI1 — harness execution proof

- [ ] allow control plane to execute a known `WorkProgramVersion` without replanning the fixed steps;
- [ ] bind typed inputs and fresh current authorization;
- [ ] execute code/model/research/document steps through existing provider seams;
- [ ] persist step/run/output events and resumable state;
- [ ] return typed artifact/output refs;
- [ ] apply AI cost/admission profiles.

**Exit:** a repeat run of the same program performs less planning/model work than the exploratory creation run.

### WPUI2 — web program renderer

- [ ] implement ProgramCatalog;
- [ ] implement schema-driven ProgramRunForm;
- [ ] implement progress/step-status view from durable run events;
- [ ] implement output renderer using existing presentation/artifact components;
- [ ] implement version history + fork/publish controls;
- [ ] implement module/report/command-palette placement resolution.

**Exit:** a published WorkProgram can appear and run as a normal Next.js ERP tool without a bespoke page.

### WPUI3 — reporting proof

Use the farm/manufacturing-style management report as a representative composite proof:

- [ ] generated ERP dataset acquisition;
- [ ] Python KPI/trend computation;
- [ ] external price research with provenance;
- [ ] bounded model commentary;
- [ ] report/chart artifact output;
- [ ] save/publish as reusable program;
- [ ] pin to Manufacturing Reports and optionally Overview Dashboard;
- [ ] rerun with fresh data without rediscovering the workflow.

### WPUI4 — import/document proofs

- [ ] expose an existing historical Excel/CSV import recipe as a WorkProgram;
- [ ] render import validation/proposal as a workflow/approval surface;
- [ ] expose a contract/document review program using DocumentProcessor/OCRProvider;
- [ ] prove both use the same ProgramRun/Artifact/Version UI primitives;
- [ ] keep consequential import/update mutations in normal STDB action paths.

### WPUI5 — Expo renderer

- [ ] consume same WorkProgram descriptors and placements;
- [ ] implement native run form/progress/output surfaces;
- [ ] support camera/document input where program input contract allows it;
- [ ] render durable existing outputs offline where policy permits;
- [ ] recover authoritative run state after reconnect;
- [ ] do not execute cloud sandbox/model steps locally by accident.

### WPUI6 — automation binding

- [ ] support manual + scheduled WorkProgram automation bindings;
- [ ] show schedule/last-run/next-run/status in UI;
- [ ] require published immutable version refs;
- [ ] provide explicit version-upgrade flow for automations;
- [ ] add event/state triggers only after authoritative event contracts exist.

### WPUI7 — user-driven promotion loop

- [ ] offer `save as reusable tool` after successful eligible exploratory work;
- [ ] generate WorkProgramDraft from actual execution artifacts/steps rather than only prose;
- [ ] retrieve/fork existing programs for similar work;
- [ ] track reuse, correction and acceptance metrics;
- [ ] identify high-use stable programs as candidates for reviewed skills/native capabilities.

---

## 22. Required tests

1. WorkProgram descriptors contain no React/DOM/native imports.
2. Programs reference CapabilityKeys, not raw reducer/transport names.
3. Published versions are immutable.
4. Every consequential step re-authorizes at execution time.
5. Program placement visibility cannot bypass backend authorization.
6. Web/native renderers consume the same ProgramPresentation.
7. A repeated program run can execute fixed deterministic steps without replanning them with an LLM.
8. Model steps are invoked only where declared/required.
9. ProgramRun resume reads durable authoritative run state.
10. Dashboard WorkProgram sections do not rerun expensive programs simply because the UI renders.
11. Program compatibility validation catches removed/changed capabilities before scheduled execution where possible.
12. Import programs cannot mutate STDB from sandbox code.
13. Document/OCR/research evidence retains provenance/trust metadata.
14. Saved program/skill artifacts carry no persistent permission grants.
15. 429/503/admission saturation is rendered as bounded task state, not immediate retry loops.

---

## 23. Acceptance criteria

This convergence is successful when:

- an exploratory AI task can graduate into a versioned reusable WorkProgram;
- a published WorkProgram can surface in normal ERP UI without bespoke feature-page code;
- the same program can be invoked manually, by the assistant, from module UI, or by an automation binding;
- reports, imports, document/OCR reviews and composed action workflows share the same run/version/artifact infrastructure;
- Python/research/model/provider details stay behind runtime seams;
- STDB/Casbin remain authoritative for consequential ERP operations;
- frontend workflow/presentation IR and the AI harness converge on the same typed intents/artifacts rather than duplicating models;
- web and mobile can render the same program semantics differently;
- repeated successful work becomes cheaper/more deterministic over time;
- program usage provides evidence for which organization-specific behavior should become a reviewed skill or native Lumiere capability/module later.
