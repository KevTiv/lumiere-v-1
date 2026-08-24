# Agent IR and codegen extension plan

**Status:** Proposed — contract-generation extension 2026-08-24
**Tracks:** `application-contract-ir`, `codegen`, `capability-discovery`, `entity-discovery`, `generated-agent-tools`, `dataset-result-policy`, `sandbox-runtime-hints`, `provenance`, `model-hints`
**Related:** [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-generated-erp-tool-surface-plan.md](./agent-generated-erp-tool-surface-plan.md) · [agent-sandbox-data-analysis-plan.md](./agent-sandbox-data-analysis-plan.md) · [sliding-window-cold-tier.md](./sliding-window-cold-tier.md)

---

## 1. Objective

Extend application-contract IR/codegen so generated operations serve human clients, offline clients and reasoning-first agent runtimes without turning IR into an orchestration or programming language.

The target architecture is:

```text
STDB / Rust domain truth
        ↓
application-contract IR
        ↓
@lumiere/contracts
  ├── typed services/hooks/subscriptions
  ├── capability/tool descriptors
  ├── entity/domain descriptors
  ├── compact discovery indexes
  ├── JSON-schema-compatible operation schemas
  ├── bounded acquisition/query contracts
  ├── draft-action descriptors
  ├── result/dataset/provenance metadata
  └── abstract model/runtime hints
        ↓
Agent Control Plane
  DISCOVER → ACQUIRE → HYPOTHESIZE → SCRIPT PYTHON
  → SANDBOX EXECUTE → OBSERVE EVIDENCE → VERIFY → PRESENT
```

IR describes **what exists and how it may safely be consumed**.

IR must not describe:

```text
how to solve a user task
what hypothesis to form
what Python to write
what sequence of operations to execute
what model/provider to use
how to promote a run into a skill
```

---

## 2. Generated capability metadata

```rust
pub struct GeneratedCapabilityDescriptor {
    pub operation: OperationName,
    pub capability: CapabilityKey,
    pub input: GeneratedTypeRef,
    pub output: GeneratedTypeRef,
    pub domain: DomainKey,
    pub entities: Vec<EntityKey>,
    pub intents: Vec<IntentTag>,
    pub keywords: Vec<String>,
    pub kind: GeneratedToolKind,
    pub risk: GeneratedOperationRisk,
    pub confirmation: GeneratedConfirmationPolicy,
    pub traffic: GeneratedOperationTrafficPolicy,
    pub idempotency: GeneratedIdempotencyPolicy,
    pub result_policy: GeneratedToolResultPolicy,
    pub provenance: GeneratedProvenancePolicy,
    pub related_capabilities: Vec<CapabilityKey>,
    pub model_hint: GeneratedModelPolicyHint,
    pub presentation: Option<GeneratedPresentationCapability>,
}

pub enum GeneratedToolKind {
    Read,
    Inspect,
    Aggregate,
    DraftAction,
    ExecuteAction,
}
```

These fields are structural metadata only. They do not grant access or encode business validation.

---

## 3. Entity/domain graph

Generate structural metadata so the model can inspect the ERP before choosing operations.

```rust
pub struct GeneratedEntityDescriptor {
    pub entity: EntityKey,
    pub domain: DomainKey,
    pub display_name: String,
    pub keywords: Vec<String>,
    pub relationships: Vec<GeneratedEntityRelationship>,
    pub lifecycle: Option<GeneratedLifecycleDescriptor>,
    pub primary_capabilities: Vec<CapabilityKey>,
}
```

Representative metadata:

```text
sale_order
  domain: sales
  relationships:
    customer -> partner
    lines -> sale_order_line
    invoices -> account_move
    deliveries -> stock_picking
  primary capabilities:
    sales.order.get
    sales.order.search
```

Lifecycle/relationship metadata may only reflect authoritative domain/schema facts. It must not duplicate reducer logic.

---

## 4. Compact discovery indexes

```ts
export interface CapabilityIndexEntry {
  operation: OperationName
  capability: CapabilityKey
  domain: DomainKey
  entities: readonly EntityKey[]
  intents: readonly IntentTag[]
  keywords: readonly string[]
  kind: ToolKind
  risk: OperationRisk
  reasoningHint: ReasoningClass
  resultPolicyKind: ToolResultPolicy["kind"]
  relatedCapabilities: readonly CapabilityKey[]
}
```

Flow:

```text
hundreds/thousands of operations
        ↓
compact capability/entity indexes
        ↓
intent/domain/entity filtering
        ↓
small candidate set
        ↓
full schemas loaded lazily
```

The index answers what exists, not what sequence to follow.

---

## 5. Generated introspection surface

Generate deterministic metadata operations:

```text
capabilities.search
capabilities.describe
entities.search
entities.describe
entities.relationships
domains.list
domains.describe
```

These query generated metadata, not ERP business rows.

---

## 6. Bounded acquisition/query contracts

For eligible read models/entities:

```ts
export interface EntityQuery<TFilter, TProjection, TOrderBy> {
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
allowed filters/operators
allowed projections/orderings
maximum rows/page size
organization/company scope injection
permission capability
result policy
provenance contract
allowed sandbox runtime profiles when dataset-backed
```

The runtime translates this through generated typed services/read models. It must never construct arbitrary model-provided SQL.

---

## 7. ToolResultPolicy: direct vs sandbox dataset vs aggregate-only

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

Examples:

```text
invoice.get_status
→ direct

invoice.search
→ sandbox-dataset

accounting.transactions.history
→ sandbox-dataset or aggregate-only
```

`sandbox-dataset` means the generated operation returns an opaque dataset contract/handle to the control plane. It does **not** mean the generated package contains Python execution logic.

`aggregate-only` remains useful when policy or performance should prevent general row-level sandbox access entirely.

---

## 8. Dataset schema/runtime metadata

For `sandbox-dataset` operations, emit stable schema metadata suitable for the Lumiere Python SDK:

```ts
export interface GeneratedDatasetDescriptor {
  schema: DatasetSchemaRef
  fields: readonly GeneratedDatasetField[]
  relationships: readonly DatasetRelationship[]
  maxRows: number
  evidencePolicy: EvidencePolicyRef
  allowedRuntimeProfiles: readonly RuntimeProfileKey[]
  provenance: ProvenanceDescriptor
}
```

Field metadata may include structural traits such as:

```text
numeric
datetime
entity_reference
categorical
sensitive_identifier
```

This metadata enables SDK/schema introspection and policy enforcement. It must not generate Python programs or business conclusions.

---

## 9. Analysis-shape metadata becomes supporting metadata

Keep `AnalysisShape` where it helps deterministic validation/aggregate-only paths:

```rust
pub enum GeneratedAnalysisShape {
    Filter,
    Project,
    GroupBy,
    Aggregate,
    ComparePeriods,
    TopN,
    Histogram,
    Timeseries,
}
```

But it is no longer the primary model-facing analysis language.

For ordinary `sandbox-dataset` work:

```text
IR emits schema + traits + result/evidence/runtime policy
        ↓
Lumiere Python SDK exposes safe dataset interface
        ↓
model writes Python
```

Do not grow IR into an exhaustive dataframe DSL.

---

## 10. Generated draft-action exposure

Mutation metadata may generate draft capabilities where explicitly allowed:

```text
sales.order.create
        ↓ generated agent descriptor
sales.order.create.draft
```

Descriptor carries:

```text
CapabilityKey
input schema
risk
confirmation
permission mapping
idempotency
source/version expectations when applicable
diff/presentation metadata
correction/compensation reference when defined
```

Runtime:

```text
model proposes typed draft
→ server scope
→ Casbin + reducer allowlist + risk
→ AiActionDraft
→ diff/preview + evidence refs
→ approval where required
→ normal STDB reducer
```

No mutation becomes directly executable merely because it exists in IR.

---

## 11. Provenance metadata

```ts
export type ProvenanceKind =
  | "erp_record"
  | "erp_dataset"
  | "erp_aggregate"
  | "artifact"
  | "user_input"
  | "external_research"
  | "model_generated"

export interface ProvenanceDescriptor {
  kind: ProvenanceKind
  authoritative: boolean
  sourceType?: EntityKey | ArtifactKind
  versioned: boolean
  correlationRequired: boolean
}
```

Generated ERP operations should default to authoritative provenance and preserve stable source/version/watermark references where possible.

Program/evidence provenance belongs to the sandbox/control-plane runtime, not application IR.

---

## 12. Abstract model/runtime hints

IR may emit only abstract hints:

```rust
pub enum GeneratedReasoningClass {
    Fast,
    Standard,
    Deep,
}

pub struct GeneratedModelPolicyHint {
    pub reasoning: GeneratedReasoningClass,
    pub context: GeneratedContextClass,
    pub requires_tools: bool,
}
```

For datasets, IR may declare compatible logical runtime profiles:

```text
analysis-python
documents-python
spreadsheet-python
```

Do **not** emit:

```text
Mistral/GLM/OpenAI IDs
Daytona sandbox IDs
Daytona snapshot IDs
provider endpoints
runtime package-install scripts
```

Deployment/runtime maps logical classes to concrete providers/images.

---

## 13. Skills and recipes are outside IR

IR may emit capability compatibility metadata, but must not generate complete skills/recipes.

```text
IR/codegen
  → capability primitives
  → entity graph
  → dataset schemas
  → result/provenance/runtime compatibility

Control plane
  → reasoning/planning
  → Python execution
  → artifacts/evidence
  → recipe reuse
  → skill promotion/review
```

A reusable Python program references generated capabilities/schema contracts, but the IR does not own the program.

---

## 14. Generated package artifacts

```text
@lumiere/contracts
  ├── services/hooks
  ├── full capability descriptors
  ├── compact capability index
  ├── entity/domain descriptors
  ├── JSON schemas
  ├── bounded query schemas/adapters
  ├── dataset schema descriptors
  ├── draft-action descriptors
  ├── result-policy metadata
  ├── provenance metadata
  ├── abstract model/runtime hints
  └── stable artifact/presentation refs
```

Suggested entrypoints:

```text
@lumiere/contracts
@lumiere/contracts/react-query
@lumiere/contracts/agent
@lumiere/contracts/agent/discovery
@lumiere/contracts/agent/query
@lumiere/contracts/agent/datasets
```

Do not force the full agent registry into normal frontend bundles.

---

## 15. Codegen validation

Fail generation for unsafe/incomplete agent exposure:

- missing `CapabilityKey`;
- missing domain/entity tags where required;
- analytical operation missing explicit result policy;
- `sandbox-dataset` missing dataset schema/evidence policy/runtime compatibility;
- unbounded opaque model-visible output;
- mutation missing risk/confirmation/idempotency metadata;
- draftable mutation missing input schema/permission mapping;
- duplicate capability/entity identifiers;
- invalid entity relationships;
- unsupported filter/projection fields;
- authoritative ERP result missing provenance contract;
- provider-specific sandbox/model identifiers inside application IR.

Generated metadata should fail closed.

---

## 16. Drift and compatibility

Contract-significant changes include:

```text
CapabilityKey
EntityKey / relationship
input/output schema
DatasetSchemaRef / field schema
operation risk
confirmation/idempotency semantics
ToolResultPolicy
EvidencePolicyRef
allowed logical runtime profiles
queryable/filterable/projectable fields
provenance contract
stable operation name
```

Do not treat these as contract-significant:

```text
concrete model mapping
Daytona deployment config
warm-pool size
sandbox image digest behind a stable runtime profile version policy
runtime token/sandbox budgets
recipe/skill content
Python program artifacts
discovery ranking weights
```

---

## 17. Representative proofs

### A — simple direct lookup

```text
objective: invoice status
→ discover accounting.invoice.get_status
→ direct bounded result
→ verify/present
```

### B — analytical dataset

```text
objective: which customers drive DSO increase?
→ discover receivables history
→ acquire DatasetHandle
→ model sees dataset schema
→ model writes Python in sandbox
→ bounded ranking/comparison evidence
→ verify/present
```

The model must not receive the historical invoice rows.

### C — cross-entity investigation

```text
objective: why has SO-481 not been invoiced?
→ inspect sale_order relationships
→ acquire order/delivery/invoice facts/datasets
→ Python only where analysis is required
→ verified evidence
```

No bespoke procedural skill required.

### D — consequential action

```text
objective: prepare a PO from low-stock evidence
→ acquire stock dataset
→ Python derives candidates
→ evidence emitted
→ purchasing.order.create.draft
→ policy + preview + approval
```

Sandbox does not mutate ERP state.

---

## 18. Phases

### IR-A0 — capability/entity/result metadata

- [ ] add DomainKey/EntityKey/IntentTag/ToolKind;
- [ ] add relationships/lifecycle metadata where authoritative;
- [ ] make ToolResultPolicy mandatory for agent-visible operations;
- [ ] add provenance metadata;
- [ ] generate compact capability/entity indexes;
- [ ] add abstract model/runtime hints;
- [ ] fail closed on incomplete metadata.

### IR-A1 — dataset contract generation

- [ ] generate `DatasetSchemaRef` descriptors for eligible reads;
- [ ] generate field traits/sensitivity/relationship metadata;
- [ ] generate evidence-policy references;
- [ ] generate allowed logical runtime-profile metadata;
- [ ] emit dataset package entrypoint;
- [ ] add drift tests for dataset contracts.

### IR-A2 — bounded acquisition

- [ ] generate safe filter/projection/order metadata;
- [ ] generate bounded entity-query schemas;
- [ ] enforce trusted org/company scope outside model input;
- [ ] enforce max rows/result policy;
- [ ] prove no generated adapter emits arbitrary SQL or reducer dispatch.

### IR-A3 — generated draft contracts

- [ ] classify draft-eligible mutations explicitly;
- [ ] generate draft descriptors/input schemas;
- [ ] bind risk/confirmation/permission/idempotency metadata;
- [ ] integrate with AiActionDraft/reducer allowlist;
- [ ] prove model cannot transform draft capability into direct execution.

### IR-A4 — Python sandbox proof

- [ ] annotate representative accounting/sales/inventory datasets;
- [ ] prove compact discovery + lazy schema loading;
- [ ] prove dataset handle/schema works with Lumiere Python SDK;
- [ ] prove model-authored Python stays outside generated package/IR;
- [ ] prove analytical rows cannot bypass sandbox result policy;
- [ ] measure context reduction vs raw registry/raw row exposure.

---

## 19. Explicitly not part of IR

- planner algorithms;
- hard-coded task workflows;
- hypothesis generation;
- Python program generation/storage;
- Daytona orchestration;
- sandbox snapshot/warm-pool policy;
- actual model/provider selection;
- session summaries/memory;
- artifact retention;
- verifier implementation;
- recipe/skill promotion logic;
- arbitrary SQL/reducer dispatch;
- business rules duplicated from STDB.

---

## 20. Acceptance criteria

The extension succeeds when:

- codegen produces searchable capability/entity catalogs without loading the entire ERP tool surface into model context;
- agent-visible reads have explicit direct/sandbox-dataset/aggregate-only policy;
- dataset-backed reads produce stable schema/provenance/runtime metadata suitable for Python sandbox use;
- the IR does not become a dataframe/programming/orchestration DSL;
- generated contracts never embed Daytona/model provider specifics;
- eligible mutations expose draft contracts without generic reducer authority;
- adding a properly annotated ERP operation updates human/offline/agent acquisition contracts from the same IR source;
- Python sandbox programs and reusable recipes can build on stable generated contracts without pushing their procedural logic back into IR;
- Casbin/STDB remain permission/business authorities.
