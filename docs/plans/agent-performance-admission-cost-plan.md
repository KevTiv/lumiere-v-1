# Agent performance, admission, and cost-shaping plan

**Status:** Proposed — 2026-08-24
**Tracks:** `agent-performance`, `ai-admission`, `model-routing`, `sandbox-capacity`, `dataset-cost`, `artifact-cost`, `recipe-reuse`, `scaleway-ai`, `daytona`, `observability`
**Related:** [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-sandbox-data-analysis-plan.md](./agent-sandbox-data-analysis-plan.md) · [agent-generated-erp-tool-surface-plan.md](./agent-generated-erp-tool-surface-plan.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md) · [stdb-index-access-path-optimization-plan.md](./stdb-index-access-path-optimization-plan.md) · [stdb-write-contention-fanout-performance-plan.md](./stdb-write-contention-fanout-performance-plan.md)

---

## 1. Objective

Apply the same explicit performance-contract discipline used for STDB reads, writes, transactions, fanout, and admission to the AI harness.

A valid agent path is not necessarily a cheap path. The harness must therefore understand and budget the physical cost of the reasoning path selected by the model.

Target cost dimensions:

```text
MODEL       model calls / tokens / provider concurrency
DISCOVERY   capability/entity search / context compilation
ACQUISITION STDB reads / durable reads / dataset materialization
SANDBOX     queue / cold start / CPU / RAM / execution duration
EVIDENCE    shaping / serialization / context bytes
ARTIFACT    rendering / object storage / export size
REUSE       recipe/program/artifact reuse
FAIRNESS    org/user/class admission / queue isolation / load shedding
```

The runtime should remain reasoning-first, but reasoning must occur inside bounded operational envelopes.

---

## 2. Core rules

1. **Reasoning freedom does not imply unbounded execution.** Models may choose hypotheses and programs, while the harness bounds cost.
2. **Cost class is structural runtime metadata, not authorization.** Casbin/STDB remain permission/business authorities.
3. **Interactive AI must not compete directly with bulk imports, large reports, or background/eval workloads.**
4. **Sandbox creation is conditional.** Use direct facts, reusable artifacts, or reusable programs before allocating a fresh sandbox where possible.
5. **Dataset acquisition has a budget distinct from tool-call count.** A single tool call may be physically expensive.
6. **Per-organization fairness applies across model, sandbox, durable-read, renderer, and import pools.**
7. **Provider limits must be modeled locally.** Do not wait for Scaleway/Daytona rate-limit errors to become the scheduler.
8. **Recipes are a performance feature.** Reuse should reduce model calls, regenerated Python, sandbox retries, and repeated acquisition.
9. **Performance decisions are measured by phase.** Do not optimize only total latency.
10. **Bulk work is bounded, chunked, checkpointed, and resumable.**

---

## 3. `AiExecutionCostProfile`

Introduce a structural runtime cost profile for agent task classes or generated capability combinations.

```ts
interface AiExecutionCostProfile {
  class:
    | "direct"
    | "light-analysis"
    | "interactive-analysis"
    | "artifact-generation"
    | "bulk-import"
    | "background-research"
    | "evaluation"

  model: {
    expectedCalls: "none" | "one" | "few" | "iterative"
    reasoningClass: ReasoningClass
  }

  acquisition: {
    expectedDatasets: "none" | "one" | "few" | "many"
    expectedRows: "none" | "few" | "bounded" | "large"
    durableHistory: boolean
  }

  sandbox: {
    required: boolean
    runtimeProfile?: RuntimeProfileKey
    resourceClass?: "small" | "medium" | "large"
    expectedDuration?: "short" | "medium" | "long"
  }

  output: {
    evidenceClass: "none" | "scalar" | "small" | "artifact"
    artifactClass?: ArtifactKind
  }
}
```

This metadata is descriptive and used for routing/admission defaults. Runtime measurements remain authoritative.

---

## 4. Latency / workload classes

### 4.1 Direct / near-instant

```text
small bounded lookup
→ no sandbox
→ zero or one model call
```

Examples:

- invoice/order status;
- configured threshold;
- already materialized authoritative summary.

### 4.2 Interactive investigation

```text
discover
→ acquire dataset
→ warm sandbox
→ 1–3 bounded Python/evidence iterations
→ verify
→ present
```

### 4.3 Artifact generation

```text
analysis
→ artifact preparation
→ document/spreadsheet/chart renderer
→ persisted artifact
```

Artifact rendering may use a different capacity pool from analysis.

### 4.4 Bulk import / migration

```text
inspect/sample
→ infer recipe
→ chunk transform
→ validate batches
→ bounded ImportProposal batches
→ checkpointed STDB ingestion
```

Bulk work must not share the interactive AI concurrency pool.

### 4.5 Background / evaluation

Examples:

- skill/recipe regression evals;
- semantic metadata enrichment;
- scheduled noninteractive summaries;
- offline research/enrichment.

Prefer batch inference/provider paths where cost-effective and available.

---

## 5. Admission pools

Split expensive AI work into independently bounded pools:

```text
interactive-ai
interactive-sandbox
artifact-render
bulk-import
background-research
evaluation
```

Each pool should support:

```text
per-org active permits
per-user active permits where useful
global concurrency
bounded queue depth
queue timeout
resource reservations
load shedding
```

Saturated bulk/import/report work must not starve direct ERP traffic or interactive AI.

---

## 6. Model admission and routing

Maintain provider-neutral model classes while tracking deployment-provider limits explicitly in runtime config.

Model scheduler should track:

```text
requests/minute
tokens/minute
concurrent requests
per-model availability
estimated queued tokens
per-org active model calls
```

Routing preference:

```text
Fast
→ classification / discovery ranking / trivial synthesis

Standard
→ normal hypothesis planning / Python generation / report composition

Deep
→ unresolved ambiguity / repeated validation failure / difficult cross-domain reasoning / verifier disagreement
```

Do not route all accounting or all AI requests to `Deep` by domain name alone.

### Batch model path

Support a separate noninteractive provider path conceptually:

```text
InteractiveModelProvider
BatchModelProvider
```

Use batch inference for evals/enrichment/background work when supported and economically beneficial.

---

## 7. Acquisition budget

A tool-count budget is insufficient because one acquisition may read many rows.

```ts
interface AcquisitionBudget {
  maxDatasetCount: number
  maxHotRowsRead: number
  maxHistoricalRowsRead: number
  maxDistinctResources: number
  maxConcurrentReads: number
  maxDatasetBytes: number
}
```

Generated capability metadata should classify acquisition shape using existing application-contract read/access-path metadata where possible:

```text
point
few
bounded-page
historical-bounded
historical-large
```

The model may compose operations, but the executor must reject or replan paths that exceed the task's physical data budget.

---

## 8. Dataset reuse

Within one task, avoid reacquiring equivalent data when authoritative scope/input/watermark are unchanged.

Conceptual cache identity:

```ts
interface DatasetCacheKey {
  organizationId: OrganizationId
  companyScope: readonly CompanyId[]
  capability: CapabilityKey
  normalizedInputHash: string
  sourceWatermark: SourceWatermark
}
```

Rules:

- reuse is task/session scoped by default;
- never weaken current authorization because a dataset already exists;
- preserve source watermark/provenance;
- invalidate/reacquire when freshness requirements are no longer satisfied;
- the model sees the same opaque handle semantics whether the dataset was reused or freshly acquired.

Primary gain:

```text
one acquisition
→ many sandbox hypotheses
```

instead of repeated STDB/history reads.

---

## 9. Context budget

Formalize model-context composition by category.

```ts
interface ContextBudget {
  maxCapabilityDescriptors: number
  maxEntityDescriptors: number
  maxEvidenceItems: number
  maxEvidenceBytes: number
  maxArtifactSummaryBytes: number
  maxRetrievedRecipes: number
}
```

Measure tokens/bytes attributable to:

```text
system/runtime policy
capability descriptions
schemas/entity graph
session summary
recipe/few-shot retrieval
evidence
artifact summaries
user input
```

This must make it possible to identify why a model call became expensive instead of treating input-token count as one opaque metric.

---

## 10. Sandbox fleet / Daytona tuning

Treat sandboxes as horizontally scalable task execution units, not durable per-org machines.

```text
AgentTask
  ↓
AiAdmissionController
  ↓
SandboxScheduler
  ├── claim warm sandbox
  ├── cold-create sandbox
  ├── queue
  └── deny/defer
```

Track at minimum:

```text
active sandboxes
queued sandbox tasks
sandbox starts/sec
warm-hit rate
cold-start latency
reserved vCPU
reserved RAM
runtime-profile utilization
per-org active sandbox count
sandbox failures/retries
```

### Profile-specific warm pools

Tune pools separately:

```text
analysis-python       larger warm pool
spreadsheet-python    smaller pool
documents-python      smaller pool
import-python         zero/small pool initially
```

Warm-pool size must be benchmark/traffic driven because prewarmed instances consume quota/capacity even when idle.

---

## 11. Sandbox execution efficiency

The Lumiere Python SDK should encourage columnar/native execution rather than row-by-row Python loops.

Preferred substrate:

```text
Arrow / Parquet / IPC
Polars lazy execution
native library kernels
bounded collect/materialization
```

Avoid giant JSON serialization between acquisition and sandbox.

Measure:

```text
dataset materialization bytes
transfer bytes
serialization/deserialization ms
peak sandbox memory
Python execution ms
number of eager materializations
```

Repeated/high-value operations may later be promoted into native Rust/Mojo/WASM primitives only after measurement justifies it.

---

## 12. Recipe/program reuse as performance optimization

Before exploratory execution, check in order:

```text
1. direct capability/fact
2. valid existing artifact/evidence
3. matching reusable AnalysisRecipe / SkillVersion
4. fresh exploratory sandbox work
```

A reusable recipe should allow:

```text
load known program
→ bind fresh authorized datasets
→ execute
→ verify
→ optionally use model only for interpretation/presentation
```

Track:

```text
recipe hit rate
sandbox iterations avoided
model calls avoided
program regeneration avoided
latency reduction
cost reduction
correction-rate delta
```

Stable recurring workflows may eventually become deterministic/native capabilities.

---

## 13. Artifact/render separation

Do not assume analysis and presentation need the same runtime/resource class.

Conceptual split:

```text
Analysis sandbox
→ AnalysisArtifact / EvidenceArtifact

Renderer
→ DOCX / XLSX / PDF / chart / presentation artifact
```

PDF/browser-heavy rendering should have separate concurrency/admission from lightweight Python analysis.

Persist artifacts to Scaleway Object Storage and keep only references/metadata in the control-plane state.

---

## 14. Import / historical-data throughput

Large onboarding imports must use the same bounded-batch discipline as STDB migration/maintenance work.

Rules:

- inspect/sample before full transformation;
- stream/chunk where practical;
- avoid loading an entire very large workbook/CSV into one in-memory frame if unnecessary;
- persist normalized staging artifacts when this avoids repeated transformation;
- produce bounded ImportProposal batches;
- use deterministic checkpoints/idempotency for STDB ingestion;
- support resumable validation/import after failure;
- keep bulk import sandbox + model capacity separate from interactive pools.

Measure:

```text
source bytes
rows/sec transformed
peak memory
validation throughput
proposal batch size
STDB ingest rows/sec
checkpoint interval
retry/replay cost
```

---

## 15. Performance observability / SLO matrix

Define benchmark classes rather than one global AI latency target.

| Class | Sandbox | Typical model calls | UX |
| --- | --- | --- | --- |
| direct | no | 0–1 | near-instant |
| light analysis | optional | 1–2 | interactive |
| investigation | yes | 2–5 | streamed progress |
| artifact | yes | 2–6 | task progress |
| bulk import | yes | variable | long-running task UI |
| background/eval | optional | many | noninteractive |

Record phase timings:

```text
discovery_ms
authorization_ms
acquisition_ms
dataset_materialization_ms
sandbox_queue_ms
sandbox_start_ms
python_exec_ms
evidence_shape_ms
model_queue_ms
model_first_token_ms
model_complete_ms
verification_ms
artifact_render_ms
artifact_persist_ms
total_task_ms
```

Also record:

```text
model input/output tokens
model calls
capability calls
datasets acquired/reused
rows/bytes acquired
evidence bytes
artifact bytes
sandbox cpu/memory/runtime
recipe hit/miss
org/user/pool admission outcome
```

Use p50/p95/p99 by `AiExecutionCostProfile.class` and runtime/model class.

---

## 16. Static validation / plan gates

Where metadata is generated or statically known, fail/warn for:

### Fail candidates

- analytical generated capability with no result/cost classification;
- bulk-import path routed through interactive-only traffic class;
- model-visible operation able to return an unbounded raw dataset;
- sandbox runtime profile with unrestricted network/credentials;
- task class with no admission pool mapping;
- historical-large acquisition with no explicit row/byte budget;
- import execution with no checkpoint/batch strategy.

### Warning / benchmark-required

- task expected to require many model iterations;
- operation introducing another historical-large acquisition into a common interactive workflow;
- runtime profile image becoming materially larger/slower to cold start;
- warm-pool growth without measured warm-hit/cold-start benefit;
- recipe frequently bypassed by fresh exploratory work;
- artifact pipeline sharing a scarce interactive sandbox pool.

---

## 17. Implementation phases

### AIP-0 — cost model and metrics

- [ ] define `AiExecutionCostProfile`;
- [ ] define model/acquisition/context/sandbox budget structs;
- [ ] classify representative direct, investigation, report, import and background tasks;
- [ ] add phase-level timing/token/dataset/sandbox metrics;
- [ ] correlate all measurements with task/correlation/org identifiers.

### AIP-1 — admission pools and provider limits

- [ ] create independent interactive/artifact/import/background/eval pools;
- [ ] enforce per-org fairness + bounded queues;
- [ ] track model TPM/QPM/concurrency locally;
- [ ] enforce sandbox concurrency/resource-class limits;
- [ ] load-shed with typed outcomes rather than unbounded waits/retries.

### AIP-2 — dataset/context efficiency

- [ ] add task-scoped dataset reuse by capability/input/watermark;
- [ ] enforce acquisition rows/bytes/resources budgets;
- [ ] instrument context tokens by category;
- [ ] prove equivalent hypothesis iterations reuse existing datasets;
- [ ] replace large JSON dataset transfer with Arrow/Parquet/IPC where practical.

### AIP-3 — Daytona fleet tuning

- [ ] measure cold-start latency by runtime profile;
- [ ] add profile-specific warm pools only where measurements justify them;
- [ ] record warm-hit rate and idle capacity cost;
- [ ] tune resource classes for analysis/doc/spreadsheet/import workloads;
- [ ] test provider outage/quota exhaustion and fallback/queue behavior.

### AIP-4 — recipe/artifact optimization

- [ ] retrieve suitable recipes before exploratory Python generation;
- [ ] quantify calls/iterations saved by recipe reuse;
- [ ] separate artifact rendering capacity where needed;
- [ ] allow stable scheduled skills to execute deterministic programs without planner calls when safe;
- [ ] benchmark program/artifact cache strategies with freshness/provenance constraints.

### AIP-5 — import/background throughput

- [ ] enforce chunk/checkpoint import transformations + proposal batches;
- [ ] isolate bulk capacity from interactive traffic;
- [ ] use batch model path for eligible background/eval work;
- [ ] benchmark source-size scaling and recovery from partial failure;
- [ ] verify AI/import load cannot materially degrade normal ERP reducers/subscriptions.

---

## 18. Acceptance criteria

The performance scope is successful when:

- every major agent workload class has explicit cost/admission semantics;
- interactive work remains responsive under simultaneous bulk import/report/eval load;
- model-provider and sandbox-provider quotas are represented by local admission rather than discovered through repeated failures;
- equivalent multi-hypothesis tasks reuse acquired datasets rather than repeatedly reading STDB/history;
- model context is bounded by explicit capability/evidence/recipe budgets;
- Daytona warm pools are profile-specific and benchmark justified;
- Python data transport uses efficient columnar/native formats for large datasets rather than giant JSON payloads;
- repeated successful work measurably reduces cost/latency through recipe/program reuse;
- bulk imports use bounded/chunked/checkpointed transformations and ingestion;
- p50/p95/p99 phase telemetry can identify whether model, acquisition, sandbox, evidence, renderer, or queueing is the limiting dimension;
- AI/sandbox workload cannot monopolize shared organization or backend capacity;
- the AI performance program aligns with the STDB read/write/fanout and global admission-control plans rather than becoming a parallel unbounded execution path.
