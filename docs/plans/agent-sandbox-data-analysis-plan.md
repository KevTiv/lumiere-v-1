# Agent sandbox data-analysis, Python runtime, and reusable-work plan

**Status:** Proposed — sandbox execution architecture 2026-08-24
**Tracks:** `dataset-isolation`, `daytona`, `python-sdk`, `ephemeral-sandboxes`, `artifacts`, `evidence`, `recipes`, `skill-promotion`, `warm-pools`, `provenance`, `verification`
**Related:** [agent-generated-erp-tool-surface-plan.md](./agent-generated-erp-tool-surface-plan.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md)

---

## 1. Objective

Make Lumiere's default analytical execution architecture:

```text
LLM = hypothesis + Python program author
Daytona sandbox = isolated execution workspace
Lumiere SDK = scoped data/artifact/evidence interface
Harness = policy + data broker + verifier
STDB = ERP source of truth
Scaleway Object Storage = durable artifact/program authority
```

The model should reason **about organization data without receiving raw organization datasets in normal context**.

For non-trivial ERP work, authorized reads produce opaque dataset handles. The model receives schemas, semantic metadata, prior evidence, and the approved sandbox SDK. It writes Python against those handles. Python executes inside an isolated sandbox over scoped data, and only bounded evidence/artifacts cross back to the model.

The sandbox is normally temporary. Durable value is extracted from it before destruction:

```text
scratch filesystem
Python program
intermediate frames
charts/docs/workbooks
        ↓
persist selected outputs
        ↓
Artifact / AnalysisProgram / Recipe / SkillDraft
        ↓
destroy sandbox
```

Do **not** make a long-lived VM/container the canonical memory of user work.

---

## 2. Core rules

1. **Models reason about data; they do not ingest raw datasets by default.**
2. **Python is the primary flexible analytical language.** Do not build a bespoke analysis language that eventually reimplements Python.
3. **The sandbox has no ERP authority.** It cannot mutate STDB, redefine scope, bypass Casbin, or directly access credentials.
4. **ERP acquisition and sandbox analysis are separate layers.** Generated ERP capabilities acquire datasets; Python transforms them.
5. **Evidence is the model boundary.** Raw rows remain inside scoped data execution; bounded derived evidence can enter model context.
6. **Artifacts outlive sandboxes.** Programs, reports, charts, spreadsheets, templates, evidence, and manifests persist outside the sandbox.
7. **Snapshots are runtime optimization, not business memory.** Skills must never depend on a particular sandbox ID/snapshot as their durable identity.
8. **Successful work may graduate into recipes/skills.** One successful execution does not automatically become a skill.
9. **Common proven behavior should move downward over time.** Repeated sandbox improvisation may become a reusable recipe, then a reviewed skill, then a native deterministic platform capability where justified.

---

## 3. Visibility and trust boundary

```text
Level 0 — Raw authoritative data
STDB rows, durable-history rows, approved uploaded data
Model cannot inspect directly by default.

Level 1 — Sandbox datasets
Opaque DatasetHandle + schema + semantic metadata + policy
Python executes over the underlying rows inside the sandbox/runtime.

Level 2 — Derived evidence
Small aggregates, comparisons, rankings, bounded tables, statistics,
entity references, chart specs, document summaries.
Model may inspect these according to evidence policy.

Level 3 — User artifacts / presentation
Verified facts, charts, DOCX/XLSX/PDF/report artifacts and final response.
```

Every transition is controlled:

```text
raw → dataset
  generated capability + trusted scope + authorization + field/row policy

dataset → sandbox
  task-bound capability grant + dataset manifest + runtime budget

sandbox → evidence/artifact
  output policy + provenance + disclosure/cardinality checks

evidence → model
  redaction/privacy + evidence budget

model → user
  verification + presentation/approval policy
```

---

## 4. Daytona as initial SandboxProvider

Use a provider abstraction even though Daytona is the preferred first implementation.

```rust
#[async_trait]
pub trait SandboxProvider {
    async fn create(&self, spec: SandboxSpec) -> Result<SandboxHandle, SandboxError>;
    async fn execute(
        &self,
        sandbox: &SandboxHandle,
        program: &AnalysisProgramRef,
    ) -> Result<SandboxExecutionResult, SandboxError>;
    async fn snapshot(
        &self,
        sandbox: &SandboxHandle,
    ) -> Result<SandboxSnapshotRef, SandboxError>;
    async fn destroy(&self, sandbox: &SandboxHandle) -> Result<(), SandboxError>;
}
```

Initial implementation:

```text
Agent Control Plane
      ↓
SandboxProvider
      ↓
DaytonaSandboxProvider
```

The application must not spread Daytona-specific IDs/APIs across task, skill, or artifact models.

### Why Daytona first

Prototype Daytona because its sandbox lifecycle, snapshot/fork/warm-pool model and persistent-volume support fit the intended Scaleway-centered architecture. Treat self-hosting/data-residency compatibility with Scaleway as an implementation proof requirement before making Daytona infrastructure mandatory.

### Provider portability

Later implementations may include:

```text
DaytonaSandboxProvider
E2BSandboxProvider
InternalFirecrackerProvider
```

Changing provider must not change ERP capability semantics, skill definitions, dataset contracts, or authorization rules.

---

## 5. Default lifecycle: ephemeral sandbox, durable outputs

Default task lifecycle:

```text
Task scheduled
  ↓
claim warm sandbox or create from approved snapshot
  ↓
attach task-scoped workspace + capability grants
  ↓
load AnalysisProgram / templates if any
  ↓
execute Python iterations
  ↓
write selected outputs to /workspace/output
  ↓
validate + hash + persist durable outputs
  ↓
revoke dataset/object grants
  ↓
destroy sandbox
```

A sandbox may be temporarily paused/resumed for an interactive or long-running task, but the durable task state remains outside it.

### Use snapshots for

- base runtime images;
- pre-installed analytical/document dependencies;
- warm-pool startup optimization;
- temporary debugging/reproduction;
- resuming an expensive environment setup;
- explicitly interactive workspace continuity.

### Do not use snapshots for

- canonical organization data;
- canonical agent memory;
- skill identity;
- durable user report state;
- permissions/authorization state;
- ERP mutation state.

---

## 6. Runtime profiles instead of one mega-image

Define approved versioned runtime profiles:

```text
lumiere-analysis-python
  Python
  Polars
  PyArrow
  NumPy
  SciPy
  statsmodels
  matplotlib
  Lumiere SDK

lumiere-documents-python
  analysis base
  python-docx
  PDF/rendering helpers
  chart/image helpers

lumiere-spreadsheet-python
  analysis base
  openpyxl
  spreadsheet helpers

lumiere-research-python
  analysis base
  approved research/document SDK only
```

Runtime selection belongs to the control plane. Use the smallest profile that can satisfy the requested artifact/work.

Every runtime profile is versioned and reproducible:

```ts
interface SandboxRuntimeProfile {
  key: RuntimeProfileKey
  version: string
  imageRef: string
  pythonVersion: string
  sdkVersion: string
  allowedPackages: readonly string[]
  networkPolicy: SandboxNetworkPolicy
  resourceClass: SandboxResourceClass
}
```

Skills/recipes reference the logical runtime profile + version, not a live sandbox.

---

## 7. Real Python, constrained environment

Phase 1 should use real Python rather than a custom analysis DSL.

The model is expected to author code such as:

```python
from lumiere import datasets, evidence

receivables = datasets.open("ds_receivables_42")

result = (
    receivables
    .filter(payment_state="not_paid")
    .group_by("partner_id")
    .aggregate(amount_residual="sum")
    .sort("amount_residual", descending=True)
    .head(10)
)

evidence.emit(
    "top_overdue_customers",
    result,
    description="Largest overdue receivables by customer",
)
```

The model gets Python flexibility while Lumiere controls data acquisition, handles, output disclosure, runtime resources, and network/secrets.

### Deterministic primitives remain valuable

The existing `AnalysisPlan`/analysis operations should become reusable implementation primitives behind the Python SDK where helpful:

```text
lumiere.datasets
lumiere.analysis
lumiere.evidence
lumiere.artifacts
lumiere.charts
lumiere.documents
lumiere.spreadsheets
```

Do not expose every dataframe transformation as a top-level LLM tool when normal Python composition is clearer and more expressive.

---

## 8. Lumiere Python SDK

Provide an opinionated SDK so the model does not need infrastructure access.

### `lumiere.datasets`

```python
datasets.open(dataset_id)
datasets.describe(dataset_id)
datasets.relationships(dataset_id)
```

Dataset handles are task/org/company scoped and expire. They resolve through the broker/runtime and never contain database credentials.

### `lumiere.evidence`

```python
evidence.emit(name, value, description=...)
evidence.scalar(...)
evidence.table(...)
evidence.chart(...)
```

Every emitted evidence item is validated against disclosure/cardinality policy and receives provenance.

### `lumiere.artifacts`

```python
artifacts.write_report(...)
artifacts.register(path, kind=...)
artifacts.reference(...)
```

Artifacts are copied/uploaded through a broker after validation; the sandbox does not own long-lived object-store credentials.

### Documents/spreadsheets/charts

Provide helpers and templates but retain normal Python package access inside the approved environment:

```python
from lumiere.documents import report
from lumiere.spreadsheets import workbook
from lumiere.charts import chart
```

The SDK should make the safe path easiest, not prevent ordinary Python analysis within the sandbox.

---

## 9. Sandbox security model

Default environment:

```text
network
  DENY by default

ERP access
  only via scoped DatasetHandle/capability broker

Object Storage
  no static credentials
  broker-issued short-lived artifact upload/download grants only when required

filesystem
  sandbox-local scratch + approved workspace paths
  no host filesystem

secrets
  absent by default
  server-side references never rendered into model context

process
  inside isolated sandbox only

resources
  CPU/RAM/disk/runtime bounded

mutations
  prohibited through sandbox data plane
```

Do not place STDB, PG, Scaleway Object Storage, or third-party API credentials in sandbox environment variables merely for convenience.

If external research is required, prefer brokered capabilities such as:

```text
research.search
research.exchange_rate
research.tax_reference
```

rather than opening unrestricted egress.

---

## 10. Dataset acquisition contract

Generated ERP read capabilities classify output:

```ts
type ToolResultPolicy =
  | {
      kind: "direct"
      maxBytes: number
    }
  | {
      kind: "sandbox-dataset"
      schema: DatasetSchemaRef
      maxRows: number
      maxBytes: number
      evidencePolicy: EvidencePolicyRef
      allowedRuntimeProfiles: readonly RuntimeProfileKey[]
    }
  | {
      kind: "aggregate-only"
      allowedShapes: readonly AnalysisShape[]
      maxOutputRows: number
    }
```

`direct` remains for small safe facts. Analytical/multi-row reads should normally produce `DatasetHandle`.

```ts
interface DatasetHandle {
  id: DatasetId
  schemaRef: DatasetSchemaRef
  sourceCapabilities: readonly CapabilityKey[]
  rowCount?: number
  watermark: SourceWatermark
  expiresAt: string
  provenanceRef: ProvenanceRef
  taskBinding: AgentTaskId
}
```

The model can know the schema/semantics and handle ID, but the handle does not expose a storage path, raw serialization URL, SQL connection, or database credentials.

---

## 11. Evidence and artifact boundary

Sandbox stdout/stderr is diagnostic output, not trusted answer evidence.

Only explicit validated emissions become model-visible evidence:

```ts
interface EvidenceArtifact {
  id: EvidenceId
  kind: EvidenceKind
  schemaRef: EvidenceSchemaRef
  valueRef: ArtifactValueRef
  displaySummary: string
  sourceDatasets: readonly DatasetId[]
  programRef: AnalysisProgramRef
  provenanceRef: ProvenanceRef
  disclosureClass: DisclosureClass
  reproducible: boolean
}
```

Artifact outputs include:

```text
AnalysisProgramArtifact
EvidenceArtifact
ChartArtifact
SpreadsheetArtifact
DocumentArtifact
PdfArtifact
PresentationArtifact
TemplateArtifact
```

Persist artifacts to Scaleway Object Storage once the bucket milestone is available. Persist metadata, ownership, hashes, versions, lineage, and task/skill references in STDB/PG according to the existing artifact/file architecture.

---

## 12. Program persistence and reproducibility

Persist model-authored Python separately from the sandbox filesystem.

```ts
interface AnalysisProgramArtifact {
  id: AnalysisProgramId
  contentHash: string
  runtimeProfile: RuntimeProfileRef
  entrypoint: string
  dependencyManifestRef?: ArtifactRef
  inputContract: AnalysisInputContract
  outputContract: AnalysisOutputContract
  sourceTaskId: AgentTaskId
  provenanceRef: ProvenanceRef
}
```

A reusable work definition must be reconstructable from:

```text
runtime profile/version
+ program artifact/hash
+ approved templates/assets
+ capability requirements
+ parameter/input schema
+ output contract
```

and must **not** require:

```text
specific Daytona sandbox ID
specific live filesystem
specific VM snapshot
static credentials
historical authorization grant
```

---

## 13. Reuse progression: run → recipe → skill → native capability

Do not automatically generate skills from every run.

### Stage 1 — ad-hoc run

Persist execution trace, program, evidence, artifacts and user correction/acceptance signals.

### Stage 2 — reusable recipe

When a prior successful program is useful again, store/retrieve a lightweight recipe:

```ts
interface AnalysisRecipe {
  id: RecipeId
  scope: "personal" | "team" | "organization"
  objectiveTags: readonly string[]
  runtimeProfile: RuntimeProfileRef
  programRef: AnalysisProgramRef
  requiredCapabilities: readonly CapabilityKey[]
  inputSchema: JsonSchema
  outputKinds: readonly ArtifactKind[]
  successMetrics: RecipeSuccessMetrics
}
```

A recipe is reusable work, not permission and not authoritative business logic.

### Stage 3 — repeated reuse

Retrieve/fork the recipe for similar objectives using fresh authorized dataset handles and current authorization.

### Stage 4 — SkillDraft

After repeated success, low correction rate, stable dependencies and passing fixtures/evals, offer explicit user/admin promotion to a reviewed skill.

```text
AnalysisRun
   ↓ repeated successful reuse
AnalysisRecipe
   ↓ fixtures/evals/review
SkillDraft
   ↓ approval
SkillVersion
```

### Stage 5 — native Lumiere capability

If many users/organizations repeatedly implement the same stable transformation or workflow, consider moving it into deterministic platform code/IR rather than growing the skill layer indefinitely.

```text
sandbox improvisation
   ↓ usage evidence
recipe
   ↓ stable repeated value
reviewed skill
   ↓ broad/common/stable
native generated capability / ERP feature
```

---

## 14. User-driven product discovery

Use sandbox traces and corrections to discover actual needs rather than guessing feature demand.

Capture privacy-safe product signals such as:

```text
frequently composed ERP capabilities
repeated objective clusters
high-reuse analysis programs
common user corrections
common artifact formats/templates
workarounds caused by missing capabilities
recipes repeatedly promoted by users
```

Use these signals for:

- capability/tool improvement;
- SDK ergonomics;
- new deterministic analysis primitives;
- first-class ERP feature decisions;
- recipe/skill recommendations;
- eval corpus expansion.

Do not mine raw organization data for product analytics. Prefer task/capability/recipe metadata and opt-in or policy-approved aggregate telemetry.

---

## 15. Skill execution in fresh sandboxes

A SkillVersion should reference reusable program/runtime artifacts:

```yaml
runtime:
  profile: lumiere-documents-python
  version: 3

program:
  artifact: analysis-program://sha256/...

inputs:
  period: date_range
  companies: authorized_company_scope

capabilities:
  - accounting.receivables.history
  - sales.revenue.history

outputs:
  - report_document
  - chart

fixtures:
  - fixture://...
```

Execution:

```text
SkillVersion
  ↓
resolve runtime profile
  ↓
claim/create ephemeral sandbox
  ↓
load program/templates
  ↓
acquire fresh authorized datasets
  ↓
execute
  ↓
verify/persist artifacts
  ↓
destroy sandbox
```

No skill stores persistent authorization. Every run re-authorizes capabilities with current trusted context.

---

## 16. Warm pools and scaling

Scale sandbox compute horizontally and independently from STDB.

```text
Agent Control Plane
        ↓
Sandbox Scheduler / admission
        ↓
Daytona warm pool(s)
  ├── analysis-python
  ├── documents-python
  └── spreadsheet-python
        ↓
per-task isolated sandbox
```

Default behavior:

```text
0 active tasks → minimal/no active task sandboxes
N concurrent analytical tasks → approximately N isolated sandboxes
finished task → persist outputs + destroy sandbox
```

Use warm pools for high-frequency runtime profiles to reduce startup latency. Keep rarer profiles cold unless measured demand justifies dedicated warm capacity.

Admission policy must bound:

```text
per organization concurrency
per user concurrency
runtime-profile capacity
CPU/RAM class
queued duration
sandbox startup rate
artifact bytes
model + sandbox combined cost budget
```

Sandbox overload must degrade AI work locally and never starve ordinary ERP/STDB traffic.

---

## 17. Scaleway placement

Target logical topology:

```text
Cloudflare / trusted ingress
        ↓
Agent Control Plane — Scaleway Paris
        ↓
Sandbox Scheduler
        ↓
Daytona sandbox runtime / provider
        ↘
         Scaleway Object Storage (durable artifacts/programs)
        ↓
capability/data broker
        ↓
STDB Paris
        ↓
durable PG convergence/history
```

The exact Daytona deployment topology must be validated. Keep SandboxProvider portable until there is a proven path for the required data residency, networking, isolation and operational model.

---

## 18. Hypothesis-driven execution loop

```text
objective: "Why did margin fall this month?"

ACQUIRE scoped datasets
  ↓
model hypothesis: revenue decreased materially
  ↓
write Python comparison
  ↓
Daytona executes
  ↓
Evidence: revenue -2.1%
  ↓
model hypothesis: COGS increased
  ↓
write Python analysis
  ↓
Evidence: COGS +18.4%
  ↓
model investigates product/supplier contributors
  ↓
Python grouping/ranking
  ↓
bounded evidence
  ↓
verifier confirms lineage/arithmetic
  ↓
model composes answer/report
```

The harness should make this iterative process cheap enough that medium-capability models can succeed by asking good analytical questions rather than mentally processing large raw datasets.

---

## 19. Model capability profiles

Runtime orchestration may tune sandbox interaction according to measured model ability:

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

Use eval-derived values, not hard-coded vendor assumptions.

Smaller/medium models may receive:

```text
fewer capability candidates
more frequent verifier/checkpoints
smaller evidence batches
shorter analysis iterations
```

Stronger models may receive broader discovery and deeper hypothesis chains. Dataset/security semantics remain identical.

---

## 20. Budgets

```ts
interface SandboxBudget {
  maxSandboxes: number
  maxPrograms: number
  maxProgramRuntimeMs: number
  maxInputRows: number
  maxJoinRows: number
  maxEvidenceBytes: number
  maxArtifactBytes: number
  maxCpuMillis: number
  maxMemoryBytes: number
  maxDiskBytes: number
}
```

Budget exhaustion is a typed runtime outcome and can trigger bounded replanning or a partial answer.

---

## 21. Events and provenance

Persist observable execution facts, not hidden chain-of-thought:

```text
SandboxRequested
SandboxClaimed
SandboxCreated
DatasetAcquired
ProgramCreated
ProgramStarted
ProgramCompleted
EvidenceCreated
ArtifactCreated
ArtifactPersisted
RecipeReused
RecipePromoted
SandboxDestroyed
```

Every evidence/artifact should retain lineage:

```text
Artifact/Evidence
  ↓
AnalysisProgram
  ↓
DatasetHandle(s)
  ↓
Generated ERP Capability invocation(s)
  ↓
trusted actor/org/company context
  ↓
STDB source watermark/version
```

---

## 22. Verification and privacy

Evidence policy controls what can cross to the model:

```ts
interface EvidencePolicy {
  maxItems: number
  maxRowsPerTable: number
  maxBytes: number
  allowEntityLabels: boolean
  allowDirectIdentifiers: boolean
  allowSamples: boolean
  masking: MaskingPolicy
  requiredAggregationK?: number
}
```

Verifier requirements include:

- program exited successfully;
- evidence schema valid;
- source dataset/task binding valid;
- provenance complete;
- disclosure/cardinality policy satisfied;
- numeric claims reproducible where practical;
- artifact hash/version registered;
- no mutation side effect occurred through the sandbox path.

---

## 23. Evaluation requirements

Measure both agent quality and sandbox architecture quality:

```text
raw-row exposure rate
valid Python execution rate
sandbox startup latency
warm-pool hit rate
analysis correctness
claim/evidence agreement
program reuse success
recipe correction rate
skill promotion success
artifact reproducibility
sandbox escape/egress denial tests
CPU/RAM/time exhaustion handling
cost per successful task
human correction rate
```

A/B representative tasks:

```text
A: raw rows injected into model context
B: Python sandbox + dataset handles + bounded evidence
C: reused recipe/skill + fresh sandbox/datasets
```

---

## 24. Implementation phases

### SANDBOX0 — provider + contracts

- [ ] define `SandboxProvider`, `SandboxSpec`, `SandboxHandle`, `SandboxRuntimeProfile`;
- [ ] implement a Daytona proof adapter behind the provider interface;
- [ ] define opaque `DatasetHandle`, `EvidenceArtifact`, `AnalysisProgramArtifact`;
- [ ] add `sandbox-dataset` result policy + allowed runtime profiles;
- [ ] prove model-visible APIs cannot reveal dataset storage/credentials;
- [ ] validate Daytona deployment/data-residency/network assumptions for the Scaleway topology.

### SANDBOX1 — Python analysis runtime

- [ ] build `lumiere-analysis-python` runtime profile;
- [ ] add Polars/PyArrow/NumPy/SciPy/statsmodels/matplotlib;
- [ ] implement `lumiere.datasets`, `lumiere.evidence`, `lumiere.artifacts` SDK foundations;
- [ ] execute real Python in the sandbox under CPU/RAM/disk/time limits;
- [ ] disable unrestricted egress by default;
- [ ] prove STDB/PG/Object Storage static credentials are absent from sandbox environment;
- [ ] produce bounded evidence instead of raw stdout/model row dumps.

### SANDBOX2 — document/spreadsheet/artifact profiles

- [ ] add document and spreadsheet runtime profiles;
- [ ] support DOCX/PDF/chart/XLSX artifact generation;
- [ ] broker artifact persistence to Scaleway Object Storage;
- [ ] persist program/runtime/template/output manifests;
- [ ] verify artifacts independently from sandbox lifetime.

### SANDBOX3 — control-plane hypothesis loop

- [ ] implement ACQUIRE → HYPOTHESIZE → SCRIPT → EXECUTE → OBSERVE → VERIFY;
- [ ] support multiple bounded Python iterations;
- [ ] compile model context from schemas + evidence + artifact summaries, not raw datasets;
- [ ] add model capability profiles for candidate-tool/program/evidence sizing;
- [ ] correlate sandbox events with agent and ERP operation/correlation IDs.

### SANDBOX4 — reusable recipes

- [ ] persist successful `AnalysisProgramArtifact` separately from sandbox state;
- [ ] define `AnalysisRecipe` with personal/team/org scope;
- [ ] retrieve/fork prior recipes for semantically similar objectives;
- [ ] require fresh capability authorization and fresh dataset handles on every reuse;
- [ ] record reuse success/correction metrics;
- [ ] do not auto-publish skills.

### SANDBOX5 — skill promotion + product feedback

- [ ] define promotion thresholds/signals for recipe → SkillDraft;
- [ ] add fixture/eval generation from accepted/corrected runs;
- [ ] require explicit user/admin review for promotion;
- [ ] make SkillVersion reference runtime profile + program/template artifacts, never sandbox ID;
- [ ] capture privacy-safe aggregate demand signals for native capability/product decisions;
- [ ] identify repeated sandbox workarounds that should become generated deterministic capabilities.

### SANDBOX6 — scaling and warm pools

- [ ] create versioned Daytona snapshots for common runtime profiles;
- [ ] add warm pools for high-frequency profiles;
- [ ] add per-org/user/runtime concurrency admission;
- [ ] measure cold-start vs warm-start latency/cost;
- [ ] implement task cancellation/TTL cleanup and orphan sandbox reconciliation;
- [ ] prove sandbox overload cannot starve normal ERP execution.

---

## 25. Explicitly out of scope

- permanent sandbox per user by default;
- sandbox filesystem as canonical memory;
- skill definitions that depend on Daytona sandbox IDs/snapshots;
- unrestricted network access;
- direct STDB/PG credentials inside sandboxes;
- static Object Storage credentials inside sandboxes;
- ERP mutations from sandbox Python;
- raw SQL as normal model primitive;
- hidden chain-of-thought persistence;
- automatic skill publication after a single successful run;
- arbitrary third-party package installation at runtime without policy;
- treating model-authored Python as authoritative ERP business logic;
- provider-specific sandbox semantics in application-contract IR.

---

## 26. Acceptance criteria

The sandbox architecture is successful when:

- analytical ERP reads create opaque dataset handles rather than dumping raw rows into model context;
- models can write useful real Python against approved datasets without receiving database/storage credentials;
- Daytona is isolated behind `SandboxProvider` and can be replaced without changing skill/ERP contracts;
- task sandboxes are ephemeral by default and can be safely cleaned up after durable outputs are persisted;
- reports, charts, spreadsheets, Python programs, evidence and templates remain reproducible after sandbox destruction;
- useful prior work can be reused as recipes with fresh authorization/datasets;
- repeated successful recipes can be reviewed/promoted into SkillVersions without persisting runtime authorization;
- warm pools/snapshots improve startup without becoming canonical user state;
- Scaleway Object Storage becomes durable artifact/program storage while STDB/PG carry authoritative metadata/lineage;
- the system can observe actual user work patterns and use them to improve tools/skills/native product features without guessing workflows up front;
- mutations remain entirely in the normal typed draft/approval/reducer path;
- benchmark results show materially lower raw-data exposure with equal or better task quality than direct row injection.
