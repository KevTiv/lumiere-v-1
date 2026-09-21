# Intelligence compounding and epistemic trace layer

**Status:** Authoritative extension to the governed-program harness
**Date:** 2026-09-21
**Related:** `governed-intelligence-program-architecture.md`, `governed-intelligence-program-migration.md`, `decision-precedent-memory-layer.md`, `typed-decision-graph-and-run-review-plan.md`

## 1. Decision

Lumiere should compound intelligence from governed runs without depending on private provider chain-of-thought.

The harness should capture **observable, reusable decision artifacts** at the moment they are produced, connect them to evidence and outcomes, independently review them, and promote only validated material into procedural memory.

The layer has three responsibilities:

```text
Structured explanation
  -> what the provider explicitly reported

Epistemic trace graph
  -> what the governed runtime actually observed

Procedural memory
  -> what reviewed runs teach future runs about how to solve a task well
```

This is not a second orchestration system. It is a learning substrate attached to the existing typed DecisionGraph, durable intelligence events, precedent, review, shadowing, and deterministic-graduation machinery.

## 2. Core invariant

```text
private chain-of-thought is neither required nor assumed
provider-reported explanation is explicit model output
runtime observations are authoritative for what actually happened
reviewer-derived interpretation is labeled as derived
only reviewed learning may enter durable procedural memory
memory informs; current policy and authorization remain authoritative
```

The UI and persistence layers must never present reviewer reconstruction or harness inference as verbatim provider thought.

## 3. Structured explanation contract

Upgrade bounded decision/reasoning outputs from a single free-text rationale to a typed explanation artifact.

Target shape:

```rust
pub struct DecisionExplanation {
    pub summary: String,
    pub factors: Vec<DecisionFactor>,
    pub alternatives: Vec<ConsideredAlternative>,
    pub uncertainties: Vec<Uncertainty>,
    pub assumptions: Vec<String>,
    pub evidence_refs: Vec<EvidenceRef>,
    pub follow_up_checks: Vec<String>,
}

pub struct DecisionFactor {
    pub name: String,
    pub effect: FactorEffect,
    pub evidence_refs: Vec<EvidenceRef>,
}

pub struct ConsideredAlternative {
    pub value: String,
    pub disposition: AlternativeDisposition,
    pub reason: String,
}
```

Requirements:

- explanations are bounded and schema-validated;
- evidence references must resolve to admitted evidence;
- no field is treated as authorization, verification, or calibrated truth;
- provider adapters normalize provider-visible reasoning summaries when available;
- providers that expose no useful reasoning still return the typed factors/uncertainties required by the DecisionType contract;
- free-text `rationale` may remain as a compatibility field during migration but is not the durable target.

DecisionType definitions should be able to declare the explanation fields required for that class of decision.

## 4. Epistemic trace graph

Introduce append-only epistemic trace records linked to existing run/step/provider/evidence identities.

Target event categories:

```text
Observation
Hypothesis
Alternative
Decision
Assumption
Uncertainty
EvidenceRequested
EvidenceAcquired
EvidenceRejected
CapabilityResult
Correction
UserFeedback
ReviewFinding
PatternCandidate
```

Every event records provenance:

```rust
pub enum EpistemicSource {
    DeterministicRuntime,
    ProviderReported,
    HarnessObserved,
    ReviewerDerived,
    UserProvided,
}
```

Target durable identity:

```text
organization/company
run_id
program_ref + graph/node id
decision/reasoning event id
provider_attempt_id where applicable
parent trace node(s)
evidence refs
content hash / version
validation status
source
timestamp
```

The graph is a DAG over observable artifacts, not a transcript dump. Parent edges should preserve which evidence, alternatives, corrections, and decisions led to later nodes.

## 5. Relationship to existing durable events

`AiIntelligenceEvent` remains the audit record for a provider decision/reasoning call and its verification/escalation/acceptance lifecycle.

The epistemic trace does not replace it.

```text
AiProviderAttempt
       ↓
AiIntelligenceEvent
       ↓
EpistemicTraceNode(s)
       ↓
verification / run outcome / human correction
       ↓
RunReviewProgram
       ↓
learning candidates
```

The trace layer may reference existing event IDs but must not duplicate spend, authorization, or execution authority.

## 6. Review-driven learning

Extend independent run review with an optional learning assessment.

```rust
pub struct RunLearningAssessment {
    pub validated_insights: Vec<TraceNodeRef>,
    pub rejected_insights: Vec<TraceNodeRef>,
    pub reusable_patterns: Vec<PatternCandidate>,
    pub failure_patterns: Vec<PatternCandidate>,
    pub missing_checks: Vec<String>,
}
```

Rules:

- `RunReviewDisposition` remains the run-health classification;
- learning assessment is separate from disposition;
- deterministic validation should run before model review where possible;
- a learning candidate is not durable procedural authority until reviewed;
- review should prefer a distinct profile/provider according to existing review-isolation policy;
- provider self-explanation alone is never sufficient evidence for promotion.

## 7. Procedural memory / TaskRecipe

Add a fourth durable memory class alongside knowledge, decision, and execution memory:

```text
KnowledgeMemory   -> facts, documents, policies, source passages
DecisionMemory    -> cases, corrections, outcomes, precedent patterns
ExecutionMemory   -> runs, capability traces, artifacts
ProceduralMemory  -> reviewed task recipes and reusable problem-solving patterns
```

Target record:

```rust
pub struct TaskRecipe {
    pub key: TaskRecipeKey,
    pub version: u32,
    pub organization_id: OrganizationId,
    pub task_type: String,
    pub applicability: ApplicabilityRule,
    pub useful_evidence: Vec<EvidenceRequirement>,
    pub decision_points: Vec<DecisionTypeRef>,
    pub preferred_capabilities: Vec<CapabilityRef>,
    pub known_failure_modes: Vec<String>,
    pub useful_checks: Vec<String>,
    pub source_case_refs: Vec<DecisionCaseId>,
    pub source_trace_refs: Vec<TraceNodeRef>,
    pub review_refs: Vec<RunReviewRef>,
    pub status: TaskRecipeStatus,
}
```

Recipes are compact procedural context, not historical transcripts.

They may tell a future run:

- which evidence tends to be useful;
- which decision types usually matter;
- which checks prevent known failures;
- which capabilities are appropriate;
- where experts commonly escalate;
- which historical shortcuts are no longer valid.

Recipes never grant current authorization or bypass the typed graph.

## 8. Context compiler integration

The context compiler should assemble independent bounded inputs:

```text
current authoritative facts
+ current evidence
+ current policy/configuration
+ relevant DecisionCase precedent
+ reviewed TaskRecipe procedural memory
+ explicit user/session context
      ↓
typed provider request
```

Retrieval rules:

- tenant/company scope first;
- task type + DecisionType/version compatibility;
- applicability/material-constraint filters;
- policy/evidence-schema compatibility;
- review quality and freshness;
- superseded/rejected recipe exclusion;
- semantic similarity only after structural filters.

The provider receives compact recipe guidance, not raw trace history.

## 9. User correction loop

User and operator corrections are high-value learning evidence and must become first-class trace events.

```text
user correction
  -> linked to decision/run/evidence
  -> append-only correction record
  -> independent/deterministic review
  -> DecisionCase correction
  -> TaskRecipe / Pattern candidate
  -> reviewed promotion
```

Repeated corrections should surface candidate failure patterns. They must never silently rewrite historical records.

## 10. Shadow and model-lift evaluation

Extend existing shadow evaluation to measure memory lift.

Compare the same versioned decision snapshot under:

```text
model without precedent/recipe
model + precedent
model + precedent + TaskRecipe
candidate smaller/local model + same memory
frontier model + same memory
```

Measure:

- verified decision quality;
- correction rate;
- review disposition/defect rate;
- evidence selection quality;
- recipe adherence;
- provider disagreement;
- token/cost/latency;
- abstention/escalation quality.

This creates empirical evidence for routing cheaper/smaller models when organizational memory closes the quality gap.

## 11. Relationship to deterministic graduation

Procedural memory is not the endpoint.

Stable reviewed recipes and low-entropy decision patterns should feed existing graduation:

```text
observed trace
 -> reviewed learning
 -> TaskRecipe / DecisionPattern
 -> repeated verified stability
 -> deterministic shadow
 -> reviewed promotion
 -> deterministic program/policy/native ERP behavior
```

TaskRecipe promotion and deterministic graduation are both versioned and reversible.

## 12. User-facing reasoning notebook

Expose a user-readable explanation built from observable artifacts:

```text
How this result was reached
  deterministic facts
  evidence acquired
  provider-reported factors
  alternatives explicitly reported
  uncertainties
  gates / policy consequences
  capability actions + receipts
  verification
  independent review
```

Every entry must retain provenance labels such as:

```text
runtime observed
provider reported
reviewer derived
user supplied
```

Do not label this UI as verbatim private chain-of-thought.

## 13. Work packages

### IC-01 — structured explanation contracts

- add typed explanation/factor/alternative/uncertainty contracts;
- extend DecisionType metadata to declare required explanation shape;
- update LLM/provider adapters and strict validation;
- retain compatibility mapping from legacy `rationale`.

### IC-02 — epistemic trace persistence

- add durable append-only trace nodes/edges;
- link run, graph node, intelligence event, provider attempt and evidence refs;
- add deterministic hashing/idempotency and size bounds;
- add provenance/source enum and validation status.

### IC-03 — trace emission integration

- emit deterministic/runtime observations from GovernedProgram;
- translate provider-reported structured explanation into trace nodes;
- record evidence requests/acquisitions, alternatives, corrections and capability results;
- ensure no trace event gains execution authority.

### IC-04 — learning review

- extend RunReviewProgram with optional `RunLearningAssessment`;
- add deterministic pre-review rules for trace consistency;
- persist validated/rejected insight links and pattern candidates;
- reuse existing independent-review isolation policy.

### IC-05 — TaskRecipe procedural memory

- introduce versioned recipe storage/status lifecycle;
- implement tenant-scoped hybrid retrieval;
- require reviewed source traces/cases;
- make corrections/supersessions append-only.

### IC-06 — context compiler integration

- retrieve compatible DecisionCase precedent + TaskRecipe guidance;
- bound recipe size and source count;
- preserve current facts/policy precedence over memory;
- record which recipe refs materially influenced the request.

### IC-07 — correction and promotion workflow

- capture user/operator corrections as trace events;
- connect corrections to DecisionCase and TaskRecipe candidates;
- add reviewed promotion/supersession lifecycle;
- prohibit automatic promotion from frequency alone.

### IC-08 — memory-lift shadow evaluation

- run with/without-memory counterfactuals;
- compare small/frontier provider profiles over identical decision snapshots;
- persist quality/cost/latency/correction metrics;
- expose routing evidence without allowing shadows to mutate live state.

### IC-09 — reasoning notebook surface

- extend chat/run UI contracts with provenance-aware trace nodes;
- render collapsible facts/evidence/alternatives/uncertainties/actions/review;
- keep private provider reasoning unavailable when the provider does not expose it;
- preserve tenant/access controls for every referenced artifact.

## 14. Non-goals

- reconstructing or claiming access to private chain-of-thought;
- storing raw provider transcripts as organizational memory;
- automatically trusting model-generated rationale;
- allowing procedural memory to grant authorization or approval;
- allowing user feedback to rewrite historical records;
- replacing DecisionCase precedent with generic embeddings;
- training/fine-tuning before trace quality and evaluation justify it;
- introducing a second workflow runtime.

## 15. Acceptance criteria

The intelligence-compounding layer is admitted when:

1. typed decisions can emit schema-validated explanations with evidence-linked factors, alternatives and uncertainty;
2. observable reasoning artifacts are stored as provenance-labeled append-only trace DAG nodes;
3. each trace node can be correlated to its run/program step and source event;
4. independent review can validate or reject candidate learning without execution authority;
5. only reviewed material can be promoted into TaskRecipe procedural memory;
6. TaskRecipe retrieval is tenant-scoped, version-aware and subordinate to current facts/policy;
7. user corrections remain append-only and can produce reviewed learning candidates;
8. shadow runs can measure quality lift from precedent/recipes and compare smaller vs larger model profiles;
9. stable reviewed procedural patterns can feed existing deterministic-graduation machinery;
10. the UI can explain how an answer was produced from observable artifacts without misrepresenting hidden provider chain-of-thought.
