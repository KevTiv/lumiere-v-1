# Agent IR and codegen extension plan

**Status:** Proposed — contract-generation extension 2026-08-24
**Tracks:** `application-contract-ir`, `codegen`, `capability-discovery`, `entity-discovery`, `generated-agent-tools`, `result-policy`, `sandbox-datasets`, `analysis-shapes`, `provenance`, `model-hints`
**Related:** [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-generated-erp-tool-surface-plan.md](./agent-generated-erp-tool-surface-plan.md) · [agent-sandbox-data-analysis-plan.md](./agent-sandbox-data-analysis-plan.md) · [sliding-window-cold-tier.md](./sliding-window-cold-tier.md)

---

## 1. Objective

Extend application-contract IR/codegen so generated operations are efficient for both human clients and reasoning-first agent runtimes without turning IR into an orchestration language.

The target harness model is deliberately **tools + deterministic guardrails + runtime reasoning**, not a growing library of prescriptive procedural skills.

For analytical ERP work, generated operations should also support the stricter rule that **models reason about organization data without ingesting raw organization rows by default**. Multi-row/analytical capabilities produce server-side dataset handles; model-authored bounded analysis runs against those handles; only derived evidence crosses back into model context.

IR describes:

- **what operations and entities exist**;
- **what they accept and return**;
- **how entities are structurally related**;
- **whether a result is direct, sandbox-dataset, or aggregate-only**;
- **what risk, confirmation, traffic, idempotency, result-shaping, provenance, and analysis constraints apply**;
- **which capabilities are semantically discoverable together**.

The Agent Control Plane decides:

- what the user is trying to accomplish;
- which capabilities to inspect or use;
- in what order to use them;
- which hypotheses to test;
- what bounded analysis program to author against acquired datasets;
- whether another observation is required;
- when to replan;
- which model/provider to use;
- how to verify evidence and present the result.

The application IR must never encode instructions such as `when asked X, call A then B then C`.

---

## 2. Architectural boundary

```text
STDB / Rust domain truth
        ↓
application-contract IR
        ↓
@lumiere/contracts
  ├── typed domain services
  ├── React Query hooks/query keys/subscriptions
  ├── capability/tool descriptors
  ├── entity/domain descriptors
  ├── compact discovery indexes
  ├── JSON-schema-compatible input/output schemas
  ├── bounded query contracts
  ├── draft-action descriptors
  ├── dataset/evidence result policies
  ├── analysis/provenance metadata
  └── abstract model-policy hints
        ↓
Agent Control Plane
  UNDERSTAND → DISCOVER → ACQUIRE → HYPOTHESIZE → SCRIPT
  → AUTHORIZE → EXECUTE SANDBOX → OBSERVE EVIDENCE
  → VERIFY → bounded REPLAN → PRESENT
```

The same generated operation boundary is consumed by frontend clients, offline clients, workflows, and agents. STDB remains the sole business-logic authority.

---

## 3. Generated capability metadata

Evolve capability descriptors toward:

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
    pub analysis_shapes: Vec<GeneratedAnalysisShape>,
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

These fields are structural metadata only. They do not grant access, choose a concrete model, assign roles, or encode business validation.

---

## 4. Entity and domain metadata

Generate a compact structural graph from domain/schema/application metadata so an agent can inspect the ERP before deciding what to do.

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

pub struct GeneratedEntityRelationship {
    pub relation: RelationshipKey,
    pub target: EntityKey,
    pub cardinality: RelationshipCardinality,
    pub semantic: RelationshipSemantic,
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
  lifecycle:
    draft -> confirmed -> delivered -> invoiced
  primary_capabilities:
    sales.order.get
    sales.order.search
    sales.order.lines.list
```

Lifecycle metadata describes valid structural states/transitions only when already represented by authoritative domain rules. It must not duplicate or replace reducer validation.

---

## 5. Capability discovery index

Generate a compact discovery artifact separate from full tool schemas:

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
  resultPolicy: ToolResultPolicy
  compatibleAnalysisShapes: readonly AnalysisShape[]
  relatedCapabilities: readonly CapabilityKey[]
}
```

Purpose:

```text
hundreds/thousands of generated ERP operations
        ↓
compact searchable capability + entity indexes
        ↓
intent/domain/entity/task filtering
        ↓
small Casbin-authorized candidate set
        ↓
full schemas loaded only for selected tools
```

This keeps model context small and allows the model to discover its own route instead of requiring a preselected skill.

Generate deterministic stable names/tags where possible; descriptions/keywords may be explicit metadata rather than inferred from implementation names.

---

## 6. Generated introspection surface

Generate deterministic read-only introspection contracts over the generated metadata itself:

```text
capabilities.search
capabilities.describe
entities.search
entities.describe
entities.relationships
domains.list
domains.describe
```

These are harness metadata operations, not ERP database queries.

Representative behavior:

```text
User: why has order SO-481 not been invoiced?

agent
  ↓
entities.search("sales order")
  ↓
entities.describe("sale_order")
  ↓
sees relationships to deliveries and invoices
  ↓
capabilities.search(domain="sales", entities=["sale_order"])
  ↓
loads only selected tool schemas
```

The discovery layer answers **what exists and how it connects**, not **what sequence must be followed**.

---

## 7. Bounded entity-query contracts

Avoid generating one bespoke search tool for every possible filter combination while also avoiding raw SQL.

For eligible read models/entities, codegen may produce bounded typed query contracts:

```ts
export interface EntityQuery<TFilter, TProjection, TOrderBy> {
  filter?: TFilter
  projection?: readonly TProjection[]
  orderBy?: readonly TOrderBy[]
  limit?: number
  cursor?: string
}
```

Generated metadata must constrain:

- queryable entity/read model;
- allowed filter fields/operators;
- allowed projections;
- ordering fields;
- maximum rows/page size;
- organization/company scope injection;
- permission capability;
- result policy;
- sandbox/aggregate compatibility.

Example conceptual request:

```text
query entity=account_move
filter partner_id=83 AND payment_state=not_paid
projection id, invoice_date, amount_residual
limit 5000
```

The runtime must translate this through generated typed services/read models. It must not construct arbitrary model-provided SQL.

If the result policy is `sandbox-dataset`, the runtime returns an opaque `DatasetHandle` + schema/provenance rather than serializing 5,000 rows into model context.

---

## 8. Generated action-draft exposure

Mutation metadata should generate agent-facing **draft capabilities** where policy allows.

A mutation-capable operation may expose:

```text
sales.order.create
        ↓ generated agent adapter
sales.order.create.draft
```

The model receives a typed draft operation, never generic reducer dispatch.

The generated descriptor carries:

```text
CapabilityKey
input schema
risk
confirmation policy
permission resource/action
idempotency semantics
expected target/source version metadata when applicable
diff/result presentation metadata
correction/compensation reference when defined
```

Runtime path:

```text
model proposes typed draft
        ↓
plan + schema validation
        ↓
server-derived actor/org/company context
        ↓
Casbin + reducer allowlist + risk policy
        ↓
ActionDraft
        ↓
deterministic diff/preview
        ↓
human approval where required
        ↓
normal STDB reducer
        ↓
audit
```

Codegen must not make a risky reducer directly executable merely because it exists.

---

## 9. Tool-result policy

Make raw-data visibility/result handling first-class:

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

Examples:

```text
invoice.get_status
→ direct

invoice.search
→ sandbox-dataset

accounting.transactions.history
→ sandbox-dataset / aggregate-only
```

Generated agent adapters must honor the policy instead of blindly serializing returned data into model context.

For `sandbox-dataset`, generated/runtime contracts expose only opaque dataset identity, schema, allowed analysis operations, watermark/provenance, expiry and budgets. Storage paths, credentials, raw-row download URLs and arbitrary query channels are not part of the model-facing contract.

---

## 10. Analysis-shape metadata

Generate/declare which deterministic transformations make sense for an operation's output:

```rust
pub enum GeneratedAnalysisShape {
    Filter,
    Project,
    GroupBy,
    Aggregate,
    Join,
    ComparePeriods,
    TopN,
    Histogram,
    Timeseries,
}
```

IR may describe structural compatibility such as numeric/date/groupable fields and explicitly compatible joins, but must not encode business conclusions.

For example, schema/type metadata can derive:

```text
amount: numeric → aggregate
created_at: datetime → timeseries / compare_periods
customer_id: entity key → group_by
```

Codegen should preserve stable field references so the analysis DSL does not depend on display labels.

The actual hypothesis and analysis-program sequence remain runtime/model concerns.

---

## 11. Provenance metadata

Make source provenance a generated/runtime-visible first-class contract.

```ts
export type ProvenanceKind =
  | "erp_record"
  | "erp_dataset"
  | "erp_aggregate"
  | "evidence"
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

Generated ERP operations should default to authoritative internal provenance. External-research and user/model content are explicitly separate trust classes in the runtime.

Dataset/evidence artifacts should preserve source capability, entity/version or source watermark, operation/correlation IDs, analysis-program lineage and shaping lineage where available.

This metadata supports evidence verification and prompt-injection defenses without storing hidden model reasoning.

---

## 12. Model-policy hints

IR may emit only abstract reasoning hints:

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

Do **not** generate provider/model names.

Runtime deployment maps abstract classes to currently selected models.

---

## 13. Skills become optional reviewed compositions

IR may generate compatibility/discovery metadata useful to reviewed skills:

```ts
export interface CapabilitySkillMetadata {
  capability: CapabilityKey
  intents: readonly IntentTag[]
  compatibleWith: readonly CapabilityKey[]
  produces: readonly ArtifactKind[]
}
```

IR must **not generate complete procedural skills automatically**.

Skills, when used, remain optional reviewed compositions over generated capabilities. The default general-purpose harness should be able to solve representative ERP tasks through capability/entity discovery, dataset acquisition, bounded sandbox analysis and evidence reasoning without requiring a matching skill.

```text
IR/codegen → capability primitives + entity graph + dataset/evidence contracts
Control plane → reasoning/hypothesis/program loop
Optional skill registry → reviewed reusable compositions
```

---

## 14. Generated artifacts

Private generated package/crate should be able to publish:

```text
@lumiere/contracts
  ├── services/hooks
  ├── full capability descriptors
  ├── compact capability index
  ├── entity/domain descriptors + indexes
  ├── JSON schemas for selected tools
  ├── bounded query schemas/adapters
  ├── generated draft-action descriptors
  ├── result-policy metadata
  ├── dataset schema/analysis compatibility metadata
  ├── evidence-policy refs
  ├── analysis-shape metadata
  ├── provenance metadata
  ├── model-policy hints
  └── stable artifact/presentation type refs
```

Do not make normal frontend bundles pay for the complete agent registry if tree-shaking/subpath exports can separate concerns.

Suggested package entrypoints:

```text
@lumiere/contracts
@lumiere/contracts/react-query
@lumiere/contracts/agent
@lumiere/contracts/agent/discovery
@lumiere/contracts/agent/query
@lumiere/contracts/agent/dataset
@lumiere/contracts/analysis
```

---

## 15. Codegen validation

Add generation-time errors for unsafe/incomplete agent exposure.

Examples:

- agent-exposed operation missing `CapabilityKey`;
- agent-visible operation missing domain/entity tags where applicable;
- analytical operation missing explicit `direct | sandbox-dataset | aggregate-only` policy;
- `aggregate-only` operation with no allowed analysis shape;
- `sandbox-dataset` operation with no dataset schema/evidence policy/allowed analysis operations;
- model-visible direct operation with unbounded opaque output;
- mutation exposed without risk/confirmation/idempotency metadata;
- draftable mutation missing input schema or permission mapping;
- duplicate capability/operation/entity identifiers;
- capability index references absent generated schema;
- relationship references unknown entity;
- bounded query exposes unsupported filter/projection field;
- unsupported analysis shape for output field types;
- sandbox join references undeclared compatibility;
- authoritative ERP result missing provenance contract.

Generated metadata should fail closed rather than silently default to broad access/result exposure.

---

## 16. Drift and compatibility

Include new metadata in contract drift/version checks.

A change to any of these may be contract-significant:

```text
CapabilityKey
EntityKey / relationship key
input/output schema
operation risk
confirmation semantics
idempotency semantics
result policy / direct-vs-sandbox classification
dataset schema / allowed analysis operations / join compatibility
evidence policy reference
queryable/filterable/projectable fields
analysis field compatibility
provenance contract
stable operation name
```

Concrete model mappings, runtime token/sandbox budgets, planning strategy, skill content, provider endpoints, and discovery ranking weights are deployment/runtime configuration and should not trigger contract regeneration.

---

## 17. Representative reasoning proofs

### Proof A — simple lookup

```text
objective: "show me invoice INV-22 status"

DISCOVER
→ capability index finds accounting.invoice.get_status

AUTHORIZE/EXECUTE
→ Casbin + typed generated operation

PRESENT
→ direct bounded result
```

### Proof B — cross-entity investigation without a predefined skill

```text
objective: "why has order SO-481 not been invoiced?"

DISCOVER
→ entity sale_order
→ relationships: deliveries + invoices
→ relevant capabilities loaded

ACQUIRE
→ bounded direct facts and/or dataset handles

HYPOTHESIZE / SCRIPT / OBSERVE
→ inspect delivery and invoice evidence without dumping raw histories into model context

VERIFY
→ conclusions reference authoritative evidence
```

The test fails if the harness requires a bespoke `sales-order-not-invoiced` skill.

### Proof C — analytical accounting task

```text
operation: accounting.receivables.history
result_policy: sandbox-dataset
analysis_shapes:
  group_by
  aggregate
  compare_periods
  top_n
  timeseries
```

Generated harness adapter returns a server-side dataset handle + schema/provenance. The model authors bounded analysis programs and receives only derived evidence.

### Proof D — consequential action

```text
objective: "prepare a purchase order for the low-stock items"

agent discovers inventory + purchase capabilities
→ acquires stock dataset
→ sandbox derives candidate evidence
→ proposes purchasing.order.create.draft
→ policy validates
→ user receives diff/preview + evidence refs
→ no ERP mutation before required approval
```

---

## 18. Phases

### Phase IR-A0 — capability + entity metadata model

- [ ] add `DomainKey`, `EntityKey`, `IntentTag`, `ToolKind` metadata for explicitly agent-discoverable operations;
- [ ] add structural entity relationships and lifecycle metadata where authoritative source exists;
- [ ] add abstract `GeneratedModelPolicyHint`;
- [ ] make `ToolResultPolicy` mandatory for agent-visible operations;
- [ ] add `direct | sandbox-dataset | aggregate-only` variants;
- [ ] add allowed `AnalysisShape` + dataset/evidence-policy metadata;
- [ ] add provenance contract metadata;
- [ ] generate compact `CapabilityIndexEntry` and entity/domain indexes;
- [ ] generate stable full schemas separately from compact discovery entries;
- [ ] add generation-time validation/fail-closed errors.

### Phase IR-A1 — discovery + package/runtime adapters

- [ ] emit agent/discovery/query/dataset/analysis package entrypoints;
- [ ] generate capability/entity search index artifacts;
- [ ] expose deterministic `capabilities.*`, `entities.*`, and `domains.*` introspection adapters;
- [ ] generate result-policy enforcement adapters;
- [ ] generate opaque dataset-handle/schema contracts for sandbox-class results;
- [ ] integrate stable field refs with `AnalysisPlan` validation;
- [ ] preserve provenance through dataset/evidence envelopes;
- [ ] keep provider/model mapping outside generated output;
- [ ] add drift tests for contract-significant agent metadata.

### Phase IR-A2 — bounded read/query generation

- [ ] define safe filter/projection/order metadata for eligible read models;
- [ ] generate bounded typed entity-query schemas;
- [ ] enforce server-derived org/company scope independent of model input;
- [ ] enforce maximum rows/result policy at generated/runtime boundary;
- [ ] prevent sandbox-class reads from serializing raw rows into model context;
- [ ] prove no generated query adapter can emit arbitrary SQL or arbitrary reducer dispatch.

### Phase IR-A3 — generated action-draft contracts

- [ ] classify draft-eligible mutations explicitly;
- [ ] generate draft capability descriptors and input schemas;
- [ ] bind risk/confirmation/permission/idempotency/correction metadata;
- [ ] integrate with existing `AiActionDraft` + reducer allowlist path;
- [ ] allow action drafts to reference verified evidence/watermarks where relevant;
- [ ] prove model/sandbox cannot convert draft capability into direct reducer execution.

### Phase IR-A4 — reasoning-first + sandbox proof

- [ ] annotate representative sales, accounting, inventory, purchasing, and expense entities/capabilities;
- [ ] prove discovery loads compact metadata first and full schema only after selection;
- [ ] prove cross-entity task completion without a bespoke procedural skill;
- [ ] prove analytical raw rows remain outside model context for sandbox-class capabilities;
- [ ] prove model can author bounded analysis over generated dataset schemas and receive derived evidence;
- [ ] prove Casbin still authorizes every selected acquisition capability at runtime;
- [ ] measure tool-description/context/raw-data reduction versus exposing the full registry/raw rows;
- [ ] add eval coverage comparing sandbox reasoning against direct-row context and any equivalent reviewed skill composition.

---

## 19. Explicitly not part of IR

- planner algorithms;
- hard-coded task workflows (`A → B → C` instructions);
- hypothesis selection/replanning strategy;
- sandbox runtime implementation;
- actual model/provider selection;
- token pricing/commercial quotas;
- runtime CPU/memory/time budgets;
- session summaries/memory policy;
- artifact-retention policy;
- verifier implementation;
- specialist sub-agent orchestration;
- skill procedural content;
- autonomous skill generation;
- unrestricted sandboxed code execution;
- direct raw SQL generation;
- generic reducer dispatch;
- business rules duplicated from STDB reducers.

These belong to the Agent Control Plane, sandbox runtime, or authoritative ERP domain/runtime systems.

---

## 20. Acceptance criteria

The extension succeeds when:

- codegen produces a compact searchable capability **and entity** catalog without loading all ERP tool schemas into model context;
- a general reasoning agent can discover entities, relationships, and relevant operations without a matching procedural skill;
- every agent-visible operation has explicit result handling, provenance, risk, and scope-compatible metadata;
- analytical operations explicitly classify direct vs sandbox-dataset vs aggregate-only behavior;
- sandbox-class generated adapters return opaque dataset handles/schema/provenance rather than raw model-visible rows;
- eligible read models expose bounded typed queries without granting arbitrary SQL authority;
- eligible mutations expose generated draft contracts without granting generic reducer execution;
- analysis plans use stable generated type/field references;
- model routing receives abstract hints without coupling contracts to concrete model providers;
- generated packages remain useful to frontend/offline clients without forcing agent-only payloads into ordinary bundles;
- control-plane reasoning/sandbox execution can build on generated primitives without pushing orchestration behavior back into IR;
- Casbin/STDB remain the permission/business authorities;
- adding a new properly annotated ERP operation updates human-client and agent acquisition/dataset contracts from the same IR/codegen source rather than requiring a handwritten AI tool implementation.
