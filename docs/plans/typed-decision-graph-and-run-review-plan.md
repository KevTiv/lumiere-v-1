# Typed decision graph and run-review architecture

**Status:** Authoritative extension to `governed-intelligence-program-architecture.md`
**Date:** 2026-09-17
**Purpose:** Move Lumiere from a safe agent harness toward typed organizational decision software where AI supplies bounded judgments and code owns composition, consequences, review, intelligence compounding, and graduation to deterministic behavior.
**Related:** `intelligence-compounding-epistemic-trace.md`

## 1. Core rule

The harness must prefer:

```text
AI answers narrowly typed questions.
Code computes deterministic facts.
Program IR composes decisions.
Policy gates consequences.
Independent review checks outcomes.
Observable decision artifacts are captured with provenance.
Reviewed learning compounds into future bounded context.
Repeated stable judgments graduate out of AI.
```

Provider output is never the workflow, authority, or business rule.

## 2. Typed decision-graph IR

Extend `GovernedProgram` with a typed decision graph rather than treating every semantic branch as a generic `DecisionStep`.

```rust
pub enum DecisionNode {
    Compute(ComputeNode),
    Choice(ChoiceNode),
    Score(ScoreNode),
    Probability(ProbabilityNode),
    Batch(DecisionBatchNode),
    AcquireEvidence(EvidenceAcquisitionNode),
    Gate(GateNode),
    EarlyStop(EarlyStopNode),
    Capability(CapabilityNode),
    Verify(VerificationNode),
    Reason(ReasoningNode),
    Generate(GenerationNode),
    RequireApproval(ApprovalNode),
}
```

The graph owns control flow. Intelligence providers only satisfy the typed uncertainty nodes.

### 2.1 Deterministic-first rule

Use `ComputeNode` whenever the answer can be derived from authoritative state without model judgment:

- sums, balances and ratios;
- date windows / aging;
- identifiers and relationship checks;
- exact statuses;
- cardinality/invariant checks;
- policy/version comparisons;
- schema validation;
- deterministic risk thresholds.

Do not spend intelligence budget on facts code can compute exactly.

## 3. Organizational decision vocabulary

Introduce a stable, typed vocabulary for organizational judgments parallel to generated Capability IR.

```rust
pub struct DecisionTypeDefinition {
    pub key: DecisionTypeKey,
    pub version: DecisionTypeVersion,
    pub input_schema: SchemaRef,
    pub output_schema: SchemaRef,
    pub required_evidence: Vec<EvidenceRequirement>,
    pub risk_class: RiskClass,
    pub precedent_policy: PrecedentPolicy,
    pub verification_policy: VerificationPolicy,
    pub escalation_policy: EscalationPolicy,
}
```

Examples:

```text
PaymentDisposition
CreditRisk
SupplierRisk
CustomerEscalation
StockReorderPriority
FraudConcern
PurchaseApprovalAssessment
CollectionPriority
```

Programs reference `DecisionTypeKey` rather than embedding provider-specific prompt semantics.

## 4. First-class probabilistic state

Do not immediately collapse uncertainty to booleans.

```rust
pub struct Probabilistic<T> {
    pub value: T,
    pub confidence: Option<f64>,
    pub distribution: Option<serde_json::Value>,
    pub calibration_profile: Option<CalibrationProfileRef>,
    pub evidence_refs: Vec<EvidenceRef>,
}
```

Provider-reported confidence remains untrusted metadata until calibrated against verified outcomes.

A `GateNode` converts probabilistic state into deterministic program behavior:

```text
P(fraud) >= hard_stop_threshold     -> Stop/Review
P(fraud) in uncertainty_band        -> AcquireEvidence
P(fraud) below continue_threshold   -> Continue
```

The threshold belongs to policy/program configuration, never to the model.

## 5. Parallel independent decision batches

Support multiple independent judgments over the same bounded state.

```rust
pub struct DecisionBatch {
    pub questions: Vec<TypedDecisionQuestion>,
    pub independence_contract: IndependenceContract,
}
```

Example:

```text
current supplier/invoice state
  ├── fraud concern?
  ├── urgency?
  ├── discrepancy severity?
  ├── policy exception likelihood?
  └── precedent compatibility?
```

Run independent questions in parallel where dependencies do not require sequencing. This reduces context coupling and enables provider-specific batching later without changing program semantics.

## 6. Conditional evidence acquisition

Evidence should be fetched incrementally rather than front-loading every possible record.

```text
cheap deterministic + bounded decisions
      ↓
uncertain / conflicting?
   ├── no -> continue
   └── yes
        ↓
AcquireEvidenceNode
        ↓
current authorization + scope checks
        ↓
new evidence
        ↓
recompute only affected nodes
```

Every evidence acquisition declares:

- the exact capability/read contract;
- maximum rows/bytes;
- privacy scope;
- which decision nodes may consume the result;
- staleness/watermark requirements.

## 7. Early-stop semantics

Make termination explicit and deterministic.

```rust
pub enum ProgramControl {
    Continue,
    Stop(StopReason),
    Escalate(EscalationReason),
    RequireEvidence(EvidenceRequest),
    RequireApproval(ApprovalRequest),
}
```

Examples:

- already settled -> stop;
- wrong organization/company -> stop;
- duplicate exact effect -> invariant failure;
- hard policy violation -> escalate/review;
- insufficient evidence -> acquire evidence;
- consequential action -> approval.

Models do not get to override an already-triggered hard stop.

## 8. Signals vs disposition

Separate observed/judged signals from operational disposition.

Bad:

```text
model -> "hold invoice"
```

Preferred:

```text
signals
  vendor_match = .98
  duplicate_probability = .03
  goods_match = .61
  discrepancy_severity = .72
      ↓
program/policy gate
      ↓
hold / continue / review
```

This allows policy to evolve independently of providers and makes decision behavior reviewable.

## 9. Precedent-aware typed decisions

Precedent retrieval must be decision-type specific and version-aware.

A precedent query should bind at minimum:

```text
tenant/company
decision_type + version
program + step compatibility
policy version
material entity/context attributes
required evidence shape
outcome/review status
supersession state
```

Semantic similarity is only one ranking input.

Every decision records:

```text
program_version
decision_type_version
policy_version
capability_contract_version
precedent_snapshot_ref
task_recipe_snapshot_ref(s)
provider_profile_version
intelligence_event_ref
```

Policy/version changes can invalidate or reduce the weight of older precedents or recipes.

Reviewed `TaskRecipe` procedural memory may accompany DecisionCase precedent when task type, DecisionType/version, material constraints, policy/evidence schema and tenant scope are compatible. Recipes guide decomposition/evidence/checks; they never determine current disposition or authorization.

## 10. Independent RunReviewProgram

Every production-shaped governed program should be eligible for independent post-run review.

```text
GovernedProgram run
      ↓
immutable execution trace + evidence + outcomes
      ↓
RunReviewProgram
  ├── objective actually satisfied?
  ├── unsupported claim?
  ├── wrong capability/branch?
  ├── policy anomaly?
  ├── suspicious side effect?
  ├── precedent contradiction?
  ├── unresolved uncertainty?
  └── review-worthy user/org impact?
      ↓
Healthy / ReviewRequired / Defect / IncidentCandidate
```

The reviewer must not rely on hidden chain-of-thought from the executing provider. It consumes observable decisions, evidence, program state, capability receipts and outcomes.

Where practical, route review through a different provider/profile than the executor so systematic provider errors are easier to detect.

Review may additionally emit a separate `RunLearningAssessment` over the provenance-labeled epistemic trace. It may validate/reject insights, identify reusable/failure patterns and missing checks, and propose TaskRecipe/DecisionPattern candidates. Review disposition and learning promotion remain separate decisions.

## 11. Counterfactual / shadow execution

Shadowing applies to decision nodes and whole decision paths, never to consequential capability execution.

```text
Production
  Gemini + current policy

Shadow A
  Jev + current policy

Shadow B
  Gemini + candidate policy

Shadow C
  reviewed deterministic DecisionPattern
```

All shadows consume the same versioned decision snapshot and cannot change live control flow.

Compare:

- choice/score/probability outputs;
- calibration;
- eventual verified outcome;
- human correction;
- cost/latency;
- precedent lift;
- TaskRecipe/procedural-memory lift;
- evidence-selection quality;
- policy disagreement.

## 12. AI -> deterministic graduation

Repeated stable judgments should not remain permanent model calls.

Track by `DecisionType`:

```text
frequency
provider disagreement
human correction rate
verified outcome rate
output entropy
precedent consistency
policy stability
cost
```

Graduation lifecycle:

```text
AI DecisionNode
  ↓ reviewed trace + repeated verified low-entropy outcomes
TaskRecipe / DecisionPattern candidate
  ↓ fixtures/evals/human review
shadow deterministic implementation
  ↓ comparison against live decisions/outcomes
deterministic program branch / policy / native ERP feature
```

Graduation must be reversible/versioned. Historical cases remain immutable.

## 13. Trust and organization controls

For every decision/program run, operators should be able to inspect a provenance-aware reasoning notebook built from observable artifacts:

- which decision type/version ran;
- deterministic facts used;
- evidence acquired and why;
- precedents retrieved/used;
- TaskRecipe guidance retrieved/used;
- provider/model/profile;
- probability/confidence + calibration status;
- gates/thresholds that converted signals to disposition;
- policy/version bindings;
- capability receipts/effects;
- approvals/corrections;
- provider-reported factors, alternatives, assumptions and uncertainty where explicitly returned;
- user/operator corrections;
- independent run-review and learning-review results;
- shadow disagreements where enabled.

Each item must identify whether it was deterministic/runtime observed, provider reported, reviewer derived or user supplied. This is observable organizational reasoning, not hidden chain-of-thought.

## 14. Migration sequence

### TDG-01 — DecisionType registry

- define versioned `DecisionTypeDefinition`;
- add schema/risk/evidence/precedent/verification/escalation metadata;
- bind existing decision cases to decision type/version.

### TDG-02 — DecisionGraph IR

- add `Compute`, `Choice`, `Score`, `Probability`, `Batch`, `AcquireEvidence`, `Gate`, `EarlyStop` nodes;
- compile/validate graphs before execution;
- reject cycles unless explicitly represented by bounded `ReasoningStep`/loop constructs.

### TDG-03 — probabilistic program state

- add `Probabilistic<T>` / distribution metadata;
- separate provider confidence from calibrated confidence;
- persist calibration profile refs;
- implement deterministic threshold gates.

### TDG-04 — conditional evidence + early stops

- add evidence acquisition contracts;
- re-run only affected nodes;
- implement hard-stop/escalation semantics;
- verify no provider can override deterministic stops.

### TDG-05 — parallel batches

- execute independent decision questions concurrently;
- preserve per-question events/cost/calibration;
- prove deterministic dependency ordering.

### TDG-06 — independent RunReviewProgram

- review observable trace/evidence/outcomes;
- emit typed review disposition;
- support independent provider/profile routing;
- surface review findings to admin/operator UX.

### TDG-07 — counterfactual path shadowing

- shadow providers, candidate policies and deterministic patterns;
- no live side effects;
- compare against eventual verified outcomes.

### TDG-08 — deterministic graduation

- detect low-entropy/high-confidence repeated decision classes;
- propose `DecisionPattern` graduation;
- require fixtures/evals/review;
- shadow deterministic candidate before promotion.

### TDG-09 — intelligence compounding integration

- implement the `IC-01` through `IC-09` workstream from `intelligence-compounding-epistemic-trace.md`;
- attach epistemic trace nodes to typed graph node identities and existing intelligence events;
- extend RunReviewProgram with learning assessment without giving it execution authority;
- retrieve reviewed TaskRecipe memory through the context compiler;
- measure memory lift through existing zero-authority shadow infrastructure.

### TDG-10 — Jev admission

- map Jev to `Choice` / `Score` / `Probability` nodes through `DecisionProvider`;
- use the same DecisionType and graph contracts as Mistral/Gemini;
- evaluate batching, calibration and precedent lift;
- no Jev-specific workflow semantics.

## 15. Acceptance criteria

This extension is adopted when:

1. at least one governed ERP workflow executes as a compiled typed DecisionGraph;
2. deterministic facts are computed outside providers;
3. probabilistic outputs remain typed until converted by explicit program/policy gates;
4. uncertain states can acquire additional authorized evidence and re-evaluate only affected nodes;
5. independent decision questions can run in parallel;
6. hard-stop conditions cannot be overridden by provider output;
7. precedent retrieval is DecisionType/version aware;
8. an independent RunReviewProgram can flag a run without execution authority;
9. shadow decision paths cannot mutate business state;
10. a repeated stable decision can be promoted to a reviewed deterministic candidate;
11. provider-visible structured explanations can be correlated to typed graph nodes without claiming hidden chain-of-thought;
12. reviewed trace artifacts can promote into versioned TaskRecipe procedural memory;
13. context compilation can combine current facts, precedent and TaskRecipe guidance while preserving current-policy precedence;
14. shadow runs can measure memory lift and smaller-vs-frontier provider quality over identical snapshots;
15. Jev can later satisfy the same DecisionGraph nodes without changing program semantics.
