# Agent IR and codegen extension plan

**Status:** Proposed — contract-generation extension 2026-08-20
**Tracks:** `application-contract-ir`, `codegen`, `capability-discovery`, `result-policy`, `analysis-shapes`, `model-hints`
**Related:** [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [sliding-window-cold-tier.md](./sliding-window-cold-tier.md)

---

## 1. Objective

Extend application-contract IR/codegen so generated operations are efficient for both human clients and agent runtimes without turning IR into an orchestration language.

IR describes **what an operation is and how it may safely be consumed**. The Agent Control Plane decides **how to reason with operations, route models, plan, verify, remember, and delegate**.

---

## 2. Generated capability metadata

Evolve capability descriptors toward:

```rust
pub struct GeneratedCapabilityDescriptor {
    pub operation: OperationName,
    pub capability: CapabilityKey,
    pub input: GeneratedTypeRef,
    pub output: GeneratedTypeRef,
    pub domain: DomainKey,
    pub intents: Vec<IntentTag>,
    pub risk: GeneratedOperationRisk,
    pub confirmation: GeneratedConfirmationPolicy,
    pub traffic: GeneratedOperationTrafficPolicy,
    pub result_policy: GeneratedToolResultPolicy,
    pub analysis_shapes: Vec<GeneratedAnalysisShape>,
    pub model_hint: GeneratedModelPolicyHint,
    pub presentation: Option<GeneratedPresentationCapability>,
}
```

These fields are structural hints only. They do not grant access, choose a concrete model, assign roles, or encode business validation.

---

## 3. Capability discovery index

Generate a compact discovery artifact separate from full tool schemas:

```ts
export interface CapabilityIndexEntry {
  operation: OperationName
  capability: CapabilityKey
  domain: DomainKey
  intents: readonly IntentTag[]
  keywords: readonly string[]
  risk: OperationRisk
  reasoningHint: ReasoningClass
  resultPolicy: ToolResultPolicy
  compatibleAnalysisShapes: readonly AnalysisShape[]
}
```

Purpose:

```text
hundreds of generated ERP operations
        ↓
compact searchable index
        ↓
intent/domain/task filtering
        ↓
small Casbin-authorized candidate set
        ↓
full schemas loaded only for selected tools
```

This keeps model context small, especially for weaker/smaller models.

Generate deterministic stable names/tags where possible; descriptions/keywords may be explicit metadata rather than inferred from implementation names.

---

## 4. Tool-result policy

Make result handling first-class:

```ts
type ToolResultPolicy =
  | {
      kind: "direct"
      maxBytes: number
    }
  | {
      kind: "dataset"
      maxRows: number
      maxBytes: number
    }
  | {
      kind: "aggregate-first"
      allowedShapes: readonly AnalysisShape[]
      maxOutputRows: number
    }
```

Examples:

```text
customer.get
→ direct

invoice.search
→ dataset

accounting.transactions.history
→ aggregate-first
```

Generated agent adapters must honor the policy instead of blindly serializing returned data into model context.

---

## 5. Analysis-shape metadata

Generate/declare which deterministic transformations make sense for an operation's output:

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

IR may describe structural compatibility such as numeric/date/groupable fields, but must not encode business conclusions.

For example, schema/type metadata can derive:

```text
amount: numeric → aggregate
created_at: datetime → timeseries / compare_periods
customer_id: entity key → group_by
```

Codegen should preserve stable field references so the analysis DSL does not depend on display labels.

---

## 6. Model-policy hints

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

Do **not** generate provider/model names such as Mistral/GLM/OpenAI model IDs.

Runtime deployment maps abstract classes to currently selected models:

```text
Fast → configured cheap model
Standard → configured workhorse
Deep → configured high-reasoning model
```

This keeps model churn outside contract versioning.

---

## 7. Skill-discovery metadata

IR may generate compatibility/discovery metadata useful to reviewed skills:

```ts
export interface CapabilitySkillMetadata {
  capability: CapabilityKey
  intents: readonly IntentTag[]
  compatibleWith: readonly CapabilityKey[]
  produces: readonly ArtifactKind[]
}
```

IR must **not generate complete skills automatically**.

Skills remain reviewed compositions:

```text
IR/codegen → capability primitives + discovery hints
Skill registry → workflow/reasoning composition over those primitives
```

---

## 8. Generated artifacts

Private generated package/crate should be able to publish:

```text
@lumiere/contracts
  ├── services/hooks
  ├── full capability descriptors
  ├── compact capability index
  ├── JSON schemas for selected tools
  ├── result-policy metadata
  ├── analysis-shape metadata
  ├── model-policy hints
  └── stable artifact/presentation type refs
```

Do not make normal frontend bundles pay for the complete agent registry if tree-shaking/subpath exports can separate concerns.

Suggested package entrypoints:

```text
@lumiere/contracts
@lumiere/contracts/react-query
@lumiere/contracts/agent
@lumiere/contracts/analysis
```

---

## 9. Codegen validation

Add generation-time errors for unsafe/incomplete agent exposure.

Examples:

- agent-exposed operation missing `CapabilityKey`;
- `aggregate-first` operation with no allowed analysis shape;
- model-visible operation with unbounded opaque output;
- mutation exposed without risk/confirmation metadata;
- duplicate capability/operation identifiers;
- capability index references absent generated schema;
- unsupported analysis shape for output field types.

Generated metadata should fail closed rather than silently default to broad access/result exposure.

---

## 10. Drift and compatibility

Include new metadata in contract drift/version checks.

A change to any of these may be contract-significant:

```text
CapabilityKey
input/output schema
operation risk
confirmation semantics
result policy
analysis field compatibility
stable operation name
```

Concrete model mappings, runtime token budgets, skill content, and provider endpoints are deployment/runtime configuration and should not trigger contract regeneration.

---

## 11. Representative proof

Use one simple lookup and one analytical accounting capability.

### Simple lookup

```text
operation: accounting.invoice.get
result_policy: direct
reasoning_hint: Fast
```

Generated harness adapter can return the bounded typed result directly.

### Analytical operation

```text
operation: accounting.receivables.history
result_policy: aggregate-first
analysis_shapes:
  group_by
  aggregate
  compare_periods
  top_n
  timeseries
reasoning_hint: Standard
```

Generated harness adapter returns a server-side dataset handle and analysis metadata, not the raw historical rows.

---

## 12. Phase IR-A0 — metadata model

- [ ] add `DomainKey` + `IntentTag` metadata for explicitly agent-discoverable operations;
- [ ] add abstract `GeneratedModelPolicyHint`;
- [ ] make `ToolResultPolicy` mandatory for agent-visible operations;
- [ ] add allowed `AnalysisShape` metadata;
- [ ] generate compact `CapabilityIndexEntry`;
- [ ] generate stable full schemas separately from compact discovery entries;
- [ ] add generation-time validation/fail-closed errors.

### Phase IR-A1 — package/runtime adapters

- [ ] emit agent/analysis package entrypoints;
- [ ] generate capability-search index artifact;
- [ ] generate result-policy enforcement adapters;
- [ ] integrate stable field refs with `AnalysisPlan` validation;
- [ ] keep provider/model mapping outside generated output;
- [ ] add drift tests for contract-significant agent metadata.

### Phase IR-A2 — migration and proof

- [ ] annotate one lookup + one analytical accounting operation;
- [ ] prove discovery loads compact metadata first and full schema only after selection;
- [ ] prove analytical result cannot bypass aggregate-first shaping through generated API;
- [ ] prove Casbin still authorizes every selected capability at runtime;
- [ ] measure tool-description/context reduction versus exposing the full registry.

---

## 13. Explicitly not part of IR

- planner algorithms;
- task recursion/replanning strategy;
- actual model/provider selection;
- token pricing/commercial quotas;
- session summaries/memory policy;
- artifact-retention policy;
- verifier implementation;
- specialist sub-agent orchestration;
- skill procedural content;
- autonomous skill generation;
- arbitrary sandboxed code execution.

These belong to the Agent Control Plane or dedicated runtime systems.

---

## 14. Acceptance criteria

The extension succeeds when:

- codegen can produce a compact searchable capability catalog without loading all ERP tool schemas into model context;
- every agent-visible operation has explicit result handling and risk metadata;
- large analytical outputs are structurally forced toward dataset/aggregate-first handling;
- analysis plans use stable generated type/field references;
- model routing receives abstract hints without coupling contracts to concrete model providers;
- generated packages remain useful to frontend clients without forcing agent-only payloads into ordinary bundles;
- skills/control-plane logic can build on generated primitives without pushing orchestration behavior back into IR;
- Casbin/STDB remain the permission/business authorities.
