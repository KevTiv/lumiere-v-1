# Generated ERP agent tool surface plan

**Status:** Proposed — reasoning-first harness/tool-surface extension 2026-08-24
**Tracks:** `generated-tools`, `runtime-discovery`, `entity-introspection`, `bounded-query`, `dataset-acquisition`, `python-sandbox`, `draft-actions`, `provenance`, `agent-evals`
**Related:** [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-sandbox-data-analysis-plan.md](./agent-sandbox-data-analysis-plan.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md)

---

## 1. Goal

Make Lumiere's ERP harness follow a reasoning-first model while keeping raw organization data outside normal model context:

```text
reasoning model
        +
rich discoverable ERP capabilities
        +
scoped dataset acquisition
        +
Python sandbox execution
        +
deterministic authorization/scope/risk guardrails
        +
minimal derived evidence
        +
evidence verification
```

The harness should not require a bespoke procedural skill for every useful ERP task.

The model decides:

```text
what ERP concepts matter
what hypothesis to test
what data to acquire
what Python to write
whether more evidence is needed
how to communicate the verified result
```

The harness determines:

```text
what capabilities exist
what data may be acquired
what org/company/user scope applies
what sandbox profile/budget is allowed
what evidence may cross to model context
what action may only be drafted
```

---

## 2. Design principles

1. **Reasoning belongs to the model.** Do not encode fixed task procedures in tool metadata.
2. **Business truth belongs to STDB.** Generated tools call authoritative application operations/read models.
3. **Authority belongs to the server/harness.** Scope, Casbin, risk, confirmation and admission are re-evaluated on every invocation.
4. **Discovery is cheap; schemas are lazy.** Search compact indexes before loading full tool schemas.
5. **Generated tools acquire/describe ERP data; they do not become a second analytics language.**
6. **Python is the primary flexible analytical/document substrate.** Multi-step data work happens in the sandbox through the Lumiere SDK.
7. **Models do not ingest raw multi-row organization data by default.** Acquisition returns `DatasetHandle`.
8. **Evidence is minimal and policy-bounded.** The model sees derived evidence, not raw dataset dumps.
9. **Mutations remain typed drafts/approvals.** Sandbox code cannot execute ERP mutations.
10. **Every observation/artifact has provenance.**
11. **Repeated user-created work may become recipes/skills only after measured reuse and review.**

---

## 3. Model-facing tool families

Keep the model-facing tool set small and structural.

### 3.1 Discovery / introspection

```text
capabilities.search
capabilities.describe
entities.search
entities.describe
entities.relationships
domains.list
domains.describe
```

These operate on generated IR metadata, not business data.

### 3.2 ERP acquisition

```text
entity.get
entity.search
entity.related
entity.aggregate
```

At runtime these resolve to generated typed per-entity/read-model contracts.

Result policy decides whether the model receives:

```text
small safe fact
→ direct bounded evidence

multi-row analytical result
→ opaque DatasetHandle

large/history operation
→ sandbox-dataset or aggregate-only output
```

Example:

```text
entity.search(
  entity="account_move",
  filter={payment_state: "not_paid"},
  projection=["id", "partner_id", "amount_residual"],
  limit=5000
)

→ DatasetHandle + schema + provenance
```

The model does not receive 5,000 invoice rows.

### 3.3 Sandbox lifecycle / program execution

Do **not** expose `analysis.group_by`, `analysis.top_n`, etc. as the primary model-facing analysis API.

Prefer a small sandbox surface:

```text
sandbox.runtime.describe
sandbox.program.run
sandbox.program.resume   # later/optional
sandbox.artifacts.list
```

The actual analysis is Python authored by the model and executed inside Daytona through the approved runtime profile.

The model gets a documented Python SDK:

```text
lumiere.datasets
lumiere.analysis
lumiere.evidence
lumiere.artifacts
lumiere.charts
lumiere.documents
lumiere.spreadsheets
```

Deterministic operations such as group-by/aggregate/compare-periods remain reusable SDK/runtime primitives, not dozens of top-level LLM tools.

### 3.4 Draft actions

```text
actions.search
actions.describe
actions.draft
actions.preview
```

`actions.draft` accepts only generated draft-eligible capability keys and typed parameters.

There is no model-visible generic reducer dispatch.

### 3.5 External/research capabilities

Handwritten brokered provider tools may complement the generated ERP surface:

```text
research.search
research.exchange_rate
research.tax_reference
files.search
files.read
```

They remain separately permissioned/audited and use explicit provenance/trust classes. Unrestricted sandbox egress is not the substitute for these capabilities.

---

## 4. Discovery → acquisition → Python flow

```text
user objective
    ↓
UNDERSTAND
    ↓
search compact domain/entity/capability indexes
    ↓
load structural relationships
    ↓
select 3–10 likely ERP capabilities
    ↓
load full schemas lazily
    ↓
PLAN ACQUISITION
    ↓
AUTHORIZE + ACQUIRE
    ↓
direct fact OR DatasetHandle
    ↓
HYPOTHESIZE
    ↓
write Python using Lumiere SDK
    ↓
execute in sandbox
    ↓
observe bounded EvidenceArtifact / output artifact
    ↓
VERIFY
    ↓
replan if needed
```

Example:

```text
"Why has SO-481 not been invoiced?"

1. discover sale_order + invoice/delivery relationships
2. acquire bounded order facts and related datasets
3. if data is multi-row, write Python to test the relevant hypothesis
4. inspect evidence, not raw rows
5. verify explanation against provenance
```

No `sales_order_not_invoiced` procedural skill is required.

---

## 5. Result policy

Generated operations must classify output:

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

Generated adapters fail closed if an analytical agent-visible operation lacks explicit result policy.

`direct` must not become a convenience escape hatch for large JSON.

---

## 6. Bounded generic acquisition contracts

Avoid one handwritten agent wrapper per reducer/read combination while also avoiding raw SQL.

For eligible entities/read models, codegen may emit:

```ts
interface EntityQuery<TFilter, TProjection, TOrderBy> {
  filter?: TFilter
  projection?: readonly TProjection[]
  orderBy?: readonly TOrderBy[]
  limit?: number
  cursor?: string
}
```

Generated metadata constrains:

```text
queryable entity/read model
allowed fields/operators
allowed projections/orderings
max rows/page size
org/company scope injection
permission capability
result policy
runtime-profile compatibility
provenance contract
```

The runtime translates this through generated typed read services; it never constructs arbitrary model-provided SQL.

---

## 7. Python SDK contract

The model should normally use Python inside the approved runtime profile:

```python
from lumiere import datasets, evidence

orders = datasets.open("ds_orders_42")

summary = (
    orders
    .filter(state="open")
    .group_by("customer_id")
    .aggregate(amount="sum")
    .sort("amount", descending=True)
    .head(10)
)

evidence.emit("top_open_orders", summary)
```

The safe path should be ergonomic enough that the model does not need infrastructure access.

The SDK/runtime may use Polars/Arrow and existing deterministic analysis primitives internally.

---

## 8. Authorization pipelines

ERP acquisition:

```text
CapabilityRequested
  ↓
trusted actor/org/company context
  ↓
generated schema validation
  ↓
Casbin
  ↓
risk/confirmation/admission/budget
  ↓
STDB/read-model operation
  ↓
result policy
  ↓
direct evidence OR DatasetHandle
  ↓
provenance
```

Sandbox execution:

```text
ProgramProposed
  ↓
validate task/runtime/dataset bindings
  ↓
sandbox budget/admission
  ↓
execute Python in Daytona
  ↓
validate evidence/artifact outputs
  ↓
privacy/cardinality policy
  ↓
EvidenceArtifact / ArtifactRef
  ↓
verification
```

Discovery filtering is never authorization proof.

---

## 9. Provenance model

```ts
type ContextProvenance =
  | { kind: "erp_record"; authoritative: true; entity: EntityKey; version?: string }
  | { kind: "erp_dataset"; authoritative: true; datasetId: DatasetId; watermark: string }
  | { kind: "evidence"; evidenceId: EvidenceId; programId: AnalysisProgramId; assessmentRef: EvidenceAssessmentRef }
  | { kind: "artifact"; artifactId: ArtifactId; assessmentRef: EvidenceAssessmentRef }
  | { kind: "user_input"; authoritative: false }
  | { kind: "external_research"; authoritative: false; sourceRef: string }
  | { kind: "model_generated"; authoritative: false }
```

Preserve source operation/dataset/watermark/program/correlation lineage wherever practical.

`EvidenceAssessmentRef` resolves the separate source-origin, verification,
domain-approval and applicability dimensions defined by the
[harness evidence contract](./ai-harness-completion-plan.md#7-evidence-intellectual-provenance-and-knowledge-contract).
An authoritative ERP record identifies business state; it does not make an
arbitrary derived interpretation authoritative. Generated results and artifacts
retain claim/decision/component lineage and pass the applicable harness M1–M5
gates before final presentation, publication or reuse.

---

## 10. Mutation behavior

Sandbox analysis remains read-only.

```text
verified sandbox evidence
  ↓
model composes typed action parameters
  ↓
actions.draft
  ↓
policy/permission/risk validation
  ↓
AiActionDraft
  ↓
diff/preview + evidence refs
  ↓
human approval / SoD where required
  ↓
normal ERP reducer
```

No Python code can call arbitrary reducers or mutate ERP state through dataset/object APIs.

---

## 11. Avoiding tool explosion

A correctly annotated ERP operation should normally require:

```text
1. implement authoritative STDB/application operation
2. annotate application-contract IR metadata
3. regenerate contracts
```

and automatically update:

```text
frontend service/hook contract
offline operation contract
agent capability descriptor
discovery index
JSON schema
risk/result/provenance metadata
dataset/runtime compatibility metadata
```

The sandbox Python SDK is handwritten platform/runtime code and should not require per-operation AI wrappers.

---

## 12. Reusable work and skills

Persist successful/corrected runs as durable program/artifact/evidence metadata.

Use this progression:

```text
ad-hoc run
  ↓
AnalysisProgramArtifact
  ↓ repeated useful reuse
AnalysisRecipe
  ↓ fixtures/evals/review
SkillDraft
  ↓ approval
SkillVersion
```

Do not automatically convert successful sequences into procedural `A → B → C` instructions.

Recipes/skills reference:

```text
runtime profile/version
program artifact
required CapabilityKeys
parameter/input schema
output artifact kinds
templates/assets
fixtures/evals
```

They do not carry permissions or sandbox IDs.

---

## 13. Evaluation strategy

Initial corpus target:

```text
100 representative tasks
  25 accounting
  20 sales/CRM
  20 inventory
  15 purchasing
  10 expenses
  10 cross-domain/research
```

Measure:

```text
task success
capability discovery quality
raw-row exposure
valid Python execution
sandbox denial/escape attempts
claim/evidence agreement
unnecessary acquisition/program iterations
model-visible evidence bytes
recipe reuse success
human correction rate
latency
sandbox + model cost
```

A/B at minimum:

```text
A: raw-row model context
B: generated acquisition + Python sandbox + bounded evidence
C: reused recipe/skill + fresh datasets
```

---

## 14. Implementation phases

### TOOL0 — discovery metadata

- [ ] generate entity/domain/capability indexes;
- [ ] implement `capabilities.*`, `entities.*`, `domains.*` introspection;
- [ ] lazy-load full schemas;
- [ ] add Casbin-filtered candidate helper without treating it as authorization.

### TOOL1 — bounded acquisition

- [ ] define queryable/filterable/projectable metadata;
- [ ] generate typed entity-query schemas;
- [ ] expose `entity.get/search/related/aggregate` through generated adapters;
- [ ] pin trusted org/company context;
- [ ] return `DatasetHandle` for analytical/multi-row results;
- [ ] prove arbitrary SQL impossible through model-facing contracts.

### TOOL2 — sandbox integration

- [ ] expose minimal sandbox runtime/program invocation surface;
- [ ] publish Python SDK docs/schema/context appropriate for model use;
- [ ] move filter/group/aggregate/compare/etc. from top-level model tools into SDK/runtime primitives;
- [ ] connect generated dataset schemas to `lumiere.datasets`;
- [ ] preserve provenance from acquisition through evidence/artifact outputs.

### TOOL3 — generated draft actions

- [ ] generate draft-action descriptors for explicitly eligible mutations;
- [ ] expose `actions.search/describe/draft/preview`;
- [ ] bind source evidence refs where applicable;
- [ ] reuse `AiActionDraft`, reducer allowlist and approval controls;
- [ ] prove no generic reducer dispatch is reachable.

### TOOL4 — reasoning/runtime integration

- [ ] support DISCOVER → ACQUIRE → HYPOTHESIZE → SCRIPT → EXECUTE → OBSERVE → VERIFY;
- [ ] enforce model/tool/data/sandbox/evidence budgets;
- [ ] keep one trusted execution context throughout task;
- [ ] emit durable capability/dataset/program/evidence trace events;
- [ ] keep hidden reasoning out of persisted traces.

### TOOL5 — recipe/eval feedback

- [ ] persist accepted/corrected program/artifact metadata;
- [ ] measure reuse and corrections;
- [ ] retrieve prior recipes for similar objectives;
- [ ] compare reasoning-first baseline vs recipe/skill baselines;
- [ ] identify repeated workarounds that should become native deterministic capabilities.

---

## 15. Explicitly out of scope

- procedural task workflows generated into IR;
- bespoke top-level analysis tool for every dataframe operation;
- raw SQL as normal agent primitive;
- generic reducer dispatch;
- raw organization datasets in model context by default;
- unrestricted sandbox egress/credentials;
- ERP mutations from Python sandbox;
- automatic skill publication from successful traces;
- permissions stored in model prompts/skills;
- provider-specific sandbox semantics in generated ERP contracts.

---

## 16. Acceptance criteria

This plan is complete when:

- a general agent can discover ERP concepts/capabilities without a matching procedural skill;
- generated reads acquire direct facts or opaque dataset handles under explicit result policy;
- analytical/document work is primarily expressed as Python in the approved sandbox runtime rather than a growing model-facing analysis DSL;
- raw multi-row organization data remains outside normal model context;
- every ERP invocation is re-authorized with trusted context;
- Python results become bounded provenance-carrying evidence/artifacts;
- mutations use typed draft/action contracts rather than arbitrary reducers;
- adding an annotated ERP operation updates human/offline/agent acquisition contracts from the same IR/codegen source;
- reusable user-created programs can become recipes/skills without depending on a live sandbox or persistent permission;
- evals can demonstrate whether general reasoning, recipe reuse or reviewed skills give the best quality/cost for each task class.
