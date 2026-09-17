# Governed intelligence program architecture

**Status:** Proposed architecture authority for post-H5 harness work
**Date:** 2026-09-17
**Supersedes:** model-first / generic-agent-loop assumptions in future harness work
**Preserves:** generated ERP capability authority, Casbin/STDB authority, per-call policy, spend admission, approval stops, durable run events, evidence/verification contracts

## 1. Decision

Lumiere's AI harness is a **governed program runtime**, not an LLM-shaped agent runtime.

Models are replaceable intelligence primitives inside an explicit program. They do not own authorization, ERP semantics, workflow state, business mutation semantics, or the execution graph by default.

The runtime exposes three distinct intelligence operations:

```text
decide()    -> bounded classification / choice / score / probability
reason()    -> bounded open-ended agent loop when the program cannot be predetermined
generate()  -> prose/code/artifact synthesis
```

Initial providers remain Mistral/Gemini/Kong/Ollama where already admitted. A future Jev/System-One provider implements `decide()` without forcing a redesign of the harness.

The design target is:

```text
User objective
      ↓
Context compiler
      ↓
Governed Program
      ├── deterministic step
      ├── decide(...)
      ├── capability(...)
      ├── verify(...)
      ├── reason(...)        # exceptional/open-ended path
      └── generate(...)
      ↓
Policy / authorization / budgets / evidence gates
      ↓
Generated ERP capability surface
      ↓
STDB / authoritative read models / action-draft approval paths
```

## 2. Why change direction

The existing H3-H5 implementation is valuable and remains the execution substrate:

- provider-neutral tool transport;
- bounded model/tool/token limits;
- per-invocation policy checks;
- approval stops;
- spend admission;
- provider-attempt persistence;
- durable execution events;
- non-progress detection.

The architectural correction is to stop treating a tool-calling conversation loop as the universal intelligence API.

For known ERP workflows, asking a generative model to reconstruct the next-state machine on every run wastes context, makes evaluation harder, encourages tool-selection variance, and couples orchestration to chat-provider semantics.

Instead, Lumiere should encode the program graph explicitly whenever the graph is known and call model intelligence only at bounded decision/generation/reasoning nodes.

## 3. Non-negotiable invariants

1. `DecisionProvider`, `GenerationProvider`, and `ReasoningProvider` never become authorization authorities.
2. Generated capability IR remains the canonical application operation vocabulary.
3. Casbin/server authorization is re-evaluated for every consequential capability invocation.
4. STDB reducers/business invariants remain authoritative for mutation semantics.
5. Decision confidence is advisory input to deterministic admission policy; it cannot grant permissions or bypass confirmation.
6. Provider-reported confidence is not assumed calibrated. Production calibration must use verified outcomes/evals.
7. Unknown/low-confidence/high-risk decisions escalate to verification, clarification, review, or bounded `reason()`; they do not silently widen authority.
8. The agent loop remains bounded and auditable, but becomes a fallback primitive rather than the default workflow engine.
9. Provider substitution must not change durable program semantics.
10. Every intelligence call is replay/inspection friendly without storing hidden chain-of-thought.

## 4. Runtime primitives

### 4.1 Decision provider

```rust
#[async_trait]
pub trait DecisionProvider: Send + Sync {
    async fn decide(&self, request: DecisionRequest) -> Result<DecisionResponse>;
}

pub struct DecisionRequest {
    pub state: serde_json::Value,
    pub questions: Vec<DecisionQuestion>,
    pub budget: DecisionBudget,
}

pub enum DecisionQuestion {
    Choice {
        key: String,
        instructions: String,
        options: Vec<DecisionOption>,
    },
    Score {
        key: String,
        instructions: String,
        min: f64,
        max: f64,
    },
    Probability {
        key: String,
        instructions: String,
    },
}

pub struct DecisionResponse {
    pub answers: Vec<DecisionAnswer>,
    pub provider: String,
    pub model: String,
    pub usage: IntelligenceUsage,
}
```

Initial implementation:

```text
DecisionProvider
      ↓
LlmDecisionAdapter
      ├── Mistral
      └── Gemini
```

Future implementation:

```text
DecisionProvider
      ├── LlmDecisionAdapter
      └── JevDecisionProvider
```

No orchestration change should be required to introduce Jev.

### 4.2 Generation provider

Generation remains text/artifact oriented:

```rust
#[async_trait]
pub trait GenerationProvider: Send + Sync {
    async fn generate(&self, request: GenerationRequest) -> Result<GenerationResponse>;
}
```

This covers prose synthesis, document drafting, code/program authoring, presentation composition, and other genuinely generative work.

### 4.3 Reasoning provider / bounded loop

The existing tool-calling agent loop remains the implementation basis for `reason()`.

Use it only when:

- the execution graph cannot be usefully predetermined;
- hypotheses must be revised from evidence;
- tool ordering depends on unbounded semantic observations;
- a governed program explicitly admits open-ended reasoning.

`reason()` inherits current limits, policy checks, spend admission, approval stops, persistence and non-progress controls.

## 5. Governed program model

A program is a typed, versioned graph of admitted steps.

```rust
pub struct GovernedProgram {
    pub key: ProgramKey,
    pub version: ProgramVersion,
    pub objective_schema: SchemaRef,
    pub steps: Vec<ProgramStep>,
    pub output_schema: SchemaRef,
    pub policy_profile: PolicyProfileRef,
}

pub enum ProgramStep {
    Deterministic(DeterministicStep),
    Decide(DecisionStep),
    Capability(CapabilityStep),
    Verify(VerificationStep),
    Reason(ReasoningStep),
    Generate(GenerationStep),
    RequireApproval(ApprovalStep),
}
```

The program owns control flow. Providers supply bounded intelligence results.

Example:

```text
objective
  ↓
deterministic capability discovery
  ↓
decide: rank 3-10 admitted candidates
  ↓
policy threshold
  ├── low confidence -> clarification/reason/review
  └── accepted
        ↓
capability execution
        ↓
verify evidence/result
        ↓
decide: sufficient evidence?
  ├── no -> bounded acquisition branch
  └── yes
        ↓
generate presentation
```

## 6. Capability discovery and decision routing

Keep deterministic narrowing first:

```text
objective
  ↓
lexical/tag/semantic candidate discovery
  ↓
Casbin-filtered candidate set
  ↓
3-10 generated CapabilityKeys
  ↓
decide(choice)
```

A model does not receive the global operation surface by default.

Decision routing uses task shape rather than vendor identity:

```rust
pub struct IntelligenceCapabilityProfile {
    pub provider: String,
    pub model: String,
    pub choice_accuracy: Option<f64>,
    pub calibration_error: Option<f64>,
    pub verification_accuracy: Option<f64>,
    pub p50_latency_ms: Option<u64>,
    pub cost_class: CostClass,
    pub max_choice_cardinality: Option<u32>,
    pub supports_generation: bool,
    pub supports_reasoning_loop: bool,
}
```

Profiles are eval-derived and versioned.

## 7. Confidence and calibration

Provider confidence is never treated as a permission.

The runtime records:

```text
DecisionRequested
DecisionAnswered
DecisionVerified
DecisionRejected
DecisionEscalated
```

with:

```rust
pub struct DecisionRecord {
    pub decision_key: String,
    pub provider: String,
    pub model: String,
    pub input_hash: String,
    pub selected: serde_json::Value,
    pub confidence: Option<f64>,
    pub distribution: Option<serde_json::Value>,
    pub verification_ref: Option<String>,
}
```

Calibration is computed from verified outcomes, not from self-reported model confidence.

This enables provider shadowing:

```text
production: Gemini decision
shadow: Jev decision
verified outcome
      ↓
offline calibration / routing policy update
```

Shadow results never affect production execution until explicitly admitted.

## 8. Where the existing agent loop moves

Current `orchestrator/agent_loop.rs` is not deleted.

It becomes the implementation of a bounded `ReasoningStep` and remains appropriate for:

- research;
- exploratory analysis;
- unfamiliar multi-tool objectives;
- hypothesis loops;
- recovery when deterministic/decision steps cannot resolve ambiguity and policy allows escalation.

Known ERP paths should progressively migrate to explicit program graphs.

## 9. Migration sequence

### GIP-0 — vocabulary and seams

- [ ] add provider-neutral decision types;
- [ ] add `DecisionProvider` and `LlmDecisionAdapter`;
- [ ] keep existing `LlmCompletion` as transport/internal adapter during migration;
- [ ] add `DecisionRequested/Answered/Verified/Escalated` durable events;
- [ ] add eval/calibration metadata without changing authorization semantics.

### GIP-1 — first governed program

Use a read-only, low-risk ERP objective:

```text
objective -> candidate discovery -> decision -> capability -> evidence verification -> generation
```

Requirements:

- [ ] no global tool prompt;
- [ ] 3-10 candidate capabilities maximum by default;
- [ ] deterministic confidence/admission policy;
- [ ] existing per-call policy and budget gates preserved;
- [ ] compare latency/cost/tool-error rate against agent-loop baseline.

### GIP-2 — decision router

- [ ] route by decision task shape and eval profile;
- [ ] support Mistral/Gemini decision adapters;
- [ ] retain model/provider attempts and spend accounting;
- [ ] add shadow-provider execution with zero authority.

### GIP-3 — reason() demotion

- [ ] make explicit governed programs the default for known migrated ERP workflows;
- [ ] use `reason()` only from admitted `ReasoningStep`s;
- [ ] prohibit new fixed ERP workflows from being implemented as unconstrained generic loops when a program graph is known.

### GIP-4 — System-One/Jev admission

When Jev access is available and its API contract is stable enough:

- [ ] implement `JevDecisionProvider` only;
- [ ] do not modify program semantics;
- [ ] run shadow decisions first;
- [ ] collect accuracy/calibration/latency/cost evidence;
- [ ] admit selected decision classes only after eval gates pass;
- [ ] keep Mistral/Gemini fallback where policy allows.

## 10. Plan impact

The following plan interpretation changes immediately:

- `ai-harness-completion-plan.md`: H4/H5 bounded loop remains valid implementation work, but future work must target governed-program primitives instead of expanding the generic loop as the universal runtime.
- `agent-control-plane-model-routing-plan.md`: model routing becomes intelligence-operation routing (`decide` / `reason` / `generate`), with explicit program state owning control flow.
- `ai-enterprise-harness-plan.md`: provider seams remain, but the primary abstraction is governed execution rather than model-authored orchestration.
- `model-refinement-dataset-plane.md`: evals should produce per-decision capability/calibration profiles in addition to broad model profiles.
- `erp-harness-implementation-ledger.md`: new harness milestones should reference GIP-* and must not create a second competing execution model.

## 11. Acceptance criteria

This architecture is considered adopted when:

1. a production-shaped read-only ERP workflow executes through `GovernedProgram` with explicit `DecisionStep` and `CapabilityStep` nodes;
2. Mistral/Gemini can satisfy `DecisionProvider` without the program knowing provider-specific tool-call formats;
3. the same program can shadow a second decision provider without changing business execution;
4. `agent_loop` remains available through `ReasoningStep` but is no longer required for that workflow;
5. authorization, policy, budget, evidence and approval gates remain unchanged or stronger;
6. decision correctness can be evaluated independently of final prose quality;
7. adding Jev requires a provider adapter + routing/eval configuration, not an orchestration rewrite.
