# Agent sandbox data-analysis and evidence-isolation plan

**Status:** Proposed — reasoning-over-data sandbox architecture 2026-08-24
**Tracks:** `dataset-isolation`, `analysis-sandbox`, `model-authored-programs`, `evidence-boundary`, `provenance`, `verification`, `privacy`
**Related:** [agent-generated-erp-tool-surface-plan.md](./agent-generated-erp-tool-surface-plan.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md)

---

## 1. Objective

Make the default analytical architecture for Lumiere:

```text
LLM = hypothesis + program author
Sandbox = data analyst
Harness = policy + scoped data broker
STDB = ERP source of truth
```

The model should reason **about data without ingesting raw organization data by default**.

For non-trivial ERP analysis, authorized reads produce opaque server-side dataset/artifact handles. The model receives schemas, metadata, available transformations, and prior derived evidence; it writes bounded analysis programs against those handles. The sandbox executes those programs over organization data and returns only minimal derived evidence needed for further reasoning or presentation.

Target flow:

```text
user objective
  ↓
UNDERSTAND / DISCOVER
  ↓
ACQUIRE authorized dataset(s)
  ↓
HYPOTHESIZE
  ↓
SCRIPT bounded analysis
  ↓
EXECUTE in isolated sandbox
  ↓
OBSERVE minimal derived evidence
  ↓
VERIFY
  ↓
need more evidence? ── yes → HYPOTHESIZE / SCRIPT again
  ↓ no
PRESENT
```

Raw ERP rows remain outside normal model context.

---

## 2. Core architectural rule

> Models should reason about organization data, not ingest organization data.

Visibility levels:

```text
Level 0 — Raw authoritative data
STDB rows, durable-history rows, uploaded source documents
Model cannot inspect directly by default.

Level 1 — Sandbox datasets
Capability-scoped dataset handles + schema + allowed analysis operations
Model can author programs against them but cannot read underlying records directly.

Level 2 — Derived evidence
Small aggregates, comparisons, samples only when policy allows, anomaly summaries,
entity references, statistics, charts/tables with bounded cardinality.
Model may inspect these for reasoning.

Level 3 — Presentation evidence
Verified user-authorized facts selected for the final response/artifact.
```

Every transition is controlled:

```text
raw → dataset
  authorization + scope + query contract + row/field policy

dataset → evidence
  sandbox execution + disclosure/cardinality policy + provenance

evidence → model
  privacy/redaction + evidence budget

model → user
  verification + presentation policy
```

---

## 3. Acquisition tools produce handles, not row dumps

Generated ERP read capabilities should prefer one of:

```ts
type ToolResultPolicy =
  | {
      kind: "direct"
      maxBytes: number
    }
  | {
      kind: "sandbox-dataset"
      schema: DatasetSchemaRef
      allowedOperations: readonly AnalysisOperation[]
      maxRows: number
      maxBytes: number
      evidencePolicy: EvidencePolicyRef
    }
  | {
      kind: "aggregate-only"
      allowedShapes: readonly AnalysisShape[]
      maxOutputRows: number
    }
```

`direct` is reserved for small scalar/single-entity facts where model visibility is explicitly safe and useful.

Examples:

```text
invoice.get_status
→ direct

invoice.search
→ sandbox-dataset

accounting.transactions.history
→ sandbox-dataset / aggregate-only

inventory.stock_movements.history
→ sandbox-dataset
```

A dataset result returns metadata such as:

```ts
interface DatasetHandle {
  id: DatasetId
  schemaRef: DatasetSchemaRef
  sourceCapabilities: readonly CapabilityKey[]
  rowCount?: number
  watermark: SourceWatermark
  allowedOperations: readonly AnalysisOperation[]
  expiresAt: string
  provenanceRef: ProvenanceRef
}
```

The handle is opaque to the model. It does not expose a storage path, SQL connection, raw serialization URL, or database credential.

---

## 4. Sandbox execution model

The model may author a bounded analysis program against dataset handles.

The first implementation should prefer a constrained analysis SDK/DSL with familiar Python-like or SQL-like ergonomics, not unrestricted process execution.

Conceptual API:

```python
ds = dataset("ds_receivables_42")

result = (
    ds.filter(payment_state="not_paid")
      .group_by("customer_id")
      .aggregate(amount_residual="sum")
      .order_by("amount_residual", descending=True)
      .limit(10)
)

emit_evidence("top_overdue_customers", result)
```

Supported operations can include:

```text
describe
filter
project
group_by
aggregate
join (only explicitly compatible datasets)
compare_periods
top_n
histogram
timeseries
window/statistical transforms where reviewed
sample only when evidence policy permits
```

The model chooses what computation to perform. Trusted runtime code executes it.

---

## 5. Sandbox restrictions

The sandbox must not expose:

```text
filesystem paths
process spawning
arbitrary network access
STDB/PG credentials
Object Storage credentials
arbitrary SQL
arbitrary reducer dispatch
secret/environment access
unbounded CPU/memory/time
raw dataset export back to model context
```

If Python/JavaScript/WASM execution is used later, it must be capability-restricted and isolated so equivalent restrictions hold.

The preferred Phase 1 implementation is an interpreted/compiled analysis plan over trusted dataframe/query primitives rather than a general-purpose OS sandbox.

---

## 6. Model-authored program contract

Represent executable analysis as a typed plan so it can be validated before touching data:

```ts
interface SandboxAnalysisProgram {
  id: AnalysisProgramId
  datasetRefs: readonly DatasetId[]
  operations: readonly AnalysisInstruction[]
  requestedEvidence: readonly EvidenceRequest[]
}
```

Validation must confirm:

- each dataset belongs to the current trusted task/org/company scope;
- dataset handles are unexpired and source watermarks are valid enough for the task;
- every operation is allowed by all relevant dataset contracts;
- referenced fields exist and are permitted;
- joins are declared compatible and scoped;
- requested output cardinality is within evidence policy;
- CPU/memory/row/time budgets are bounded;
- no instruction represents raw export or unrestricted execution.

Model-authored code is therefore a proposal for deterministic computation, not authority.

---

## 7. Evidence contract

Sandbox execution returns `EvidenceArtifact` objects, not arbitrary raw stdout.

```ts
interface EvidenceArtifact {
  id: EvidenceId
  kind: EvidenceKind
  schemaRef: EvidenceSchemaRef
  valueRef: ArtifactValueRef
  displaySummary: string
  sourceDatasets: readonly DatasetId[]
  analysisProgramId: AnalysisProgramId
  provenanceRef: ProvenanceRef
  rowCount?: number
  disclosureClass: DisclosureClass
  reproducible: boolean
}
```

Evidence kinds can include:

```text
scalar
small_table
comparison
ranking
histogram
timeseries
anomaly_summary
entity_reference_set
chart_spec
```

The model normally receives only the bounded evidence payload + schema + provenance summary.

---

## 8. Provenance and reproducibility

Every evidence item must retain lineage sufficient for independent verification/reproduction:

```text
EvidenceArtifact
  ↓ derived from
SandboxAnalysisProgram
  ↓ executed over
DatasetHandle(s)
  ↓ created by
Generated ERP Capability invocation(s)
  ↓ authorized under
Trusted actor/org/company context
  ↓ read from
STDB authoritative state / versioned durable source
```

Representative provenance:

```json
{
  "evidence_id": "ev_42",
  "source_datasets": ["ds_receivables_918"],
  "source_watermarks": ["stdb:company-8:91821"],
  "analysis_program": "ap_11",
  "operations": ["filter", "group_by", "aggregate", "top_n"],
  "input_rows": 12843,
  "output_rows": 10,
  "correlation_id": "corr_..."
}
```

The verifier should be able to replay deterministic programs against the same versioned dataset/artifact where retained, or re-run against current data while explicitly marking freshness differences.

---

## 9. Hypothesis-driven reasoning loop

The control plane should support the model acting like an analyst:

```text
objective: "Why did margin fall this month?"

model hypothesis:
  revenue decreased materially

sandbox program:
  compare current vs previous revenue

observation:
  revenue -2.1%

model:
  insufficient; test COGS

sandbox program:
  compare current vs previous COGS

observation:
  COGS +18.4%

model:
  identify product/supplier contributors

sandbox program:
  group COGS delta by product and supplier, top 10

observation:
  bounded evidence

verifier:
  confirm arithmetic/provenance

model:
  compose explanation
```

The harness must not require the model to calculate totals, joins, rankings, or period deltas from raw rows.

---

## 10. Smaller-model compatibility

This architecture is intentionally favorable to medium/smaller models.

They need to perform:

```text
hypothesis selection
analysis-operation selection
program composition
interpretation of bounded evidence
```

They do not need to:

```text
retain thousands of rows
perform reliable large arithmetic
mentally join tables
sort/group raw records
carry organization datasets in context
```

Runtime model profiles may adjust:

```text
candidate tool count
analysis program depth
number of hypotheses per iteration
replan checkpoints
maximum evidence items per model call
```

The ERP contract and sandbox semantics remain identical across models.

---

## 11. Evidence minimization and privacy

Evidence policy determines what may cross from sandbox to model.

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

Examples:

- internal financial totals may be visible while underlying invoice rows remain hidden;
- phone/account/payment identifiers may be masked before evidence enters model context;
- high-cardinality customer lists become top-N or grouped summaries;
- sensitive exports remain separate approved artifacts and are not surfaced merely because the model asks.

---

## 12. Direct facts remain possible

Do not route every trivial lookup through the sandbox.

Examples eligible for `direct` under policy:

```text
invoice status
order lifecycle state
single non-sensitive configured threshold
count already computed by authoritative read model
```

The rule is:

```text
small bounded fact → direct when safe
multi-row analytical data → sandbox dataset by default
large/history data → sandbox/aggregate-only mandatory
```

This prevents unnecessary orchestration overhead while retaining the raw-data isolation principle.

---

## 13. Mutations stay outside the analysis sandbox

The sandbox is analytical and read-only.

It may produce evidence or typed proposal inputs, but cannot execute ERP mutations.

```text
sandbox evidence
  ↓
model proposes typed action draft
  ↓
normal action-draft policy
  ↓
diff/preview
  ↓
human approval / SoD where required
  ↓
STDB reducer
```

No generated analysis program may smuggle side effects through file/network/database access.

---

## 14. Execution budgets

Add sandbox-specific limits to the task budget:

```ts
interface SandboxBudget {
  maxPrograms: number
  maxProgramSteps: number
  maxInputRows: number
  maxJoinRows: number
  maxOutputRows: number
  maxEvidenceBytes: number
  maxCpuMs: number
  maxMemoryBytes: number
}
```

Budget exhaustion produces a typed result and may trigger bounded replanning or a partial answer.

---

## 15. Event/audit model

Persist observable execution facts, not hidden chain-of-thought:

```text
DatasetAcquired
AnalysisProgramProposed
AnalysisProgramValidated
AnalysisProgramDenied
AnalysisProgramStarted
AnalysisProgramCompleted
EvidenceCreated
EvidenceVerified
EvidencePresented
```

Events reference hashes/artifact IDs where sensitive payloads should not be duplicated into logs.

---

## 16. Evaluation requirements

Add benchmark dimensions specifically for the sandbox design:

```text
raw-row exposure rate (target: zero for sandbox-class datasets)
correct hypothesis progression
valid program rate
sandbox denial rate
analysis correctness
claim/evidence agreement
unnecessary analysis operations
number of model-visible evidence bytes
reproducibility rate
latency/cost
human correction rate
```

A/B representative tasks:

```text
A: raw rows injected into model context
B: sandbox dataset + model-authored analysis + bounded evidence
```

The sandbox design should be preferred when it improves privacy/context efficiency without materially reducing task success.

---

## 17. Implementation phases

### SANDBOX0 — dataset/evidence contracts

- [ ] add `sandbox-dataset` to generated `ToolResultPolicy`;
- [ ] define opaque `DatasetHandle` + source watermark/provenance;
- [ ] define `EvidenceArtifact` + `EvidencePolicy`;
- [ ] classify representative ERP reads as direct vs sandbox-dataset vs aggregate-only;
- [ ] prohibit generated adapters from serializing sandbox datasets into model context.

### SANDBOX1 — constrained analysis engine

- [ ] define typed `SandboxAnalysisProgram` / `AnalysisInstruction`;
- [ ] implement filter/project/group/aggregate/top-N/compare-periods/timeseries;
- [ ] validate schemas, fields, operation compatibility, scope, budgets and output cardinality;
- [ ] execute against server-side dataset handles;
- [ ] produce bounded evidence artifacts rather than raw stdout.

### SANDBOX2 — hypothesis/replan integration

- [ ] update control-plane loop to ACQUIRE → HYPOTHESIZE → SCRIPT → EXECUTE → OBSERVE → VERIFY;
- [ ] support multiple bounded hypothesis/analysis iterations;
- [ ] compile model context from schemas + prior evidence, not raw datasets;
- [ ] tune program depth/evidence count from model capability profiles;
- [ ] preserve the same trusted actor/org/company context across all iterations.

### SANDBOX3 — provenance/privacy/verification

- [ ] attach source capability, dataset watermark and analysis-program lineage to evidence;
- [ ] implement evidence disclosure/masking/cardinality enforcement;
- [ ] add deterministic evidence replay/verification;
- [ ] require authoritative evidence for material ERP claims where practical;
- [ ] add injection tests proving dataset contents cannot become runtime instructions.

### SANDBOX4 — benchmark and hardening

- [ ] compare raw-context vs sandbox-evidence approaches on representative ERP corpus;
- [ ] measure model-visible organization-data volume;
- [ ] test medium and deep model profiles against the same sandbox contracts;
- [ ] test CPU/memory/time/row exhaustion paths;
- [ ] prove no filesystem/network/credential/reducer side effect is reachable;
- [ ] gate expansion to general-purpose code execution on measured need rather than convenience.

---

## 18. Explicitly out of scope

- unrestricted Python/Node shell access in Phase 1;
- direct model access to raw STDB/PG rows for analytical datasets;
- arbitrary SQL generated by the model;
- filesystem/network access from analysis programs;
- mutations from the sandbox;
- storing hidden chain-of-thought;
- treating sandbox code as reviewed business logic;
- allowing model code to redefine organization/company scope;
- raw organization datasets as long-term agent memory.

---

## 19. Acceptance criteria

The sandbox architecture is successful when:

- analytical ERP tools produce opaque server-side dataset handles rather than raw model-visible rows by default;
- the model can discover schemas and author bounded analysis programs without seeing underlying records;
- trusted code performs calculations, joins and transformations deterministically;
- only policy-bounded derived evidence enters model context;
- every evidence item carries reproducible source/analysis provenance;
- raw ERP data cannot become runtime instructions or leak through generic output channels;
- smaller and larger models can use the same contracts while differing only in orchestration depth/tool breadth;
- final material claims can be checked against evidence artifacts;
- mutations remain entirely in the normal typed draft/approval/reducer path;
- benchmark results demonstrate equal or better task quality with materially lower raw-data exposure/context use than direct row injection.
