# Governed intelligence program architecture

**Status:** Proposed architecture authority for post-H5 harness work
**Date:** 2026-09-17
**Supersedes:** model-first / generic-agent-loop assumptions in future harness work
**Preserves:** generated ERP capability authority, Casbin/STDB authority, per-call policy, spend admission, approval stops, durable run events, evidence/verification contracts
**Extends:** `decision-precedent-memory-layer.md` and `typed-decision-graph-and-run-review-plan.md`

## 1. Decision

Lumiere's AI harness is a **governed typed-decision program runtime**, not an LLM-shaped agent runtime.

Models are replaceable intelligence primitives inside an explicit program. They do not own authorization, ERP semantics, workflow state, business mutation semantics, execution authority, organizational precedent, or operational disposition.

The runtime exposes three intelligence operations:

```text
decide()    -> bounded Choice / Score / Probability
generate()  -> prose/code/artifact synthesis
reason()    -> bounded proposal generation when the typed graph cannot resolve state
```

The program/runtime additionally owns:

```text
compute()           -> deterministic facts
precedent()         -> scoped prior decision context
batch()             -> independent parallel decisions
acquire_evidence()  -> conditional authorized evidence
gate()/early_stop() -> deterministic consequence mapping
capability()        -> governed ERP execution
verify()            -> evidence/result validation
approval()          -> human/policy-controlled transition
run_review()        -> independent post-run review
```

The key boundary is:

```text
AI supplies narrow typed judgments.
Precedent informs.
Program IR composes.
Policy gates consequences.
Governed runtime executes and verifies.
Independent review judges the completed run.
```

A future Jev/System-One provider implements the same `DecisionProvider` contract used by Mistral/Gemini and maps only to typed decision nodes.

## 2. Target architecture

```text
User objective
      ↓
Context compiler
      ↓
GovernedProgram / typed DecisionGraph
      ├── ComputeNode
      ├── DecisionType -> Choice / Score / Probability
      │      └── PrecedentRetriever
      ├── DecisionBatch
      ├── AcquireEvidenceNode
      ├── GateNode / EarlyStopNode
      ├── CapabilityStep
      ├── VerificationStep
      ├── GenerationStep
      ├── ReasoningStep -> typed proposal only
      └── ApprovalStep
      ↓
shared governed-runtime admission
      ├── authorization
      ├── invocation policy
      ├── spend/budget admission
      ├── approval state
      ├── evidence/provenance
      ├── precedent governance
      ├── execution/recovery
      └── final-answer admission
      ↓
Generated ERP capability surface
      ↓
STDB / authoritative read models / action-draft paths
      ↓
immutable trace + outcome
      ↓
RunReviewProgram
      ↓
DecisionCase / correction / pattern / graduation signals
```

## 3. Non-negotiable invariants

1. `DecisionProvider`, `GenerationProvider`, and `ReasoningProvider` never become authorization or execution authorities.
2. Generated capability IR remains the canonical application-operation vocabulary.
3. DecisionType/version is the canonical vocabulary for organizational judgments.
4. Casbin/server authorization is re-evaluated for every consequential capability invocation.
5. STDB reducers/business invariants remain authoritative for mutation semantics.
6. Deterministic facts are computed in code whenever possible; providers are not asked to infer exact values the runtime can derive.
7. Signals and operational disposition are separate. Providers produce typed judgments; program/policy gates map them to consequences.
8. Provider confidence is advisory and not assumed calibrated.
9. Probabilistic state remains typed until explicit deterministic gates convert it into program control.
10. Unknown/low-confidence/high-risk states escalate to evidence acquisition, clarification, review, approval, or bounded `reason()`.
11. `ReasoningStep` may propose but may not directly execute capabilities, approve drafts, retry mutations, override hard stops, or admit final answers.
12. Provider substitution must not change durable program semantics.
13. Shared runtime services own authorization, policy, budgets, approval, execution, recovery and verification for every step kind.
14. New fixed ERP workflows must not be implemented as generic agent loops when their graph is known.
15. Precedent informs current decisions but never becomes current authorization, approval, or business-rule authority.
16. Corrections/supersessions are append-only and remain linked to original decision cases.
17. Precedent retrieval is tenant-scoped by default and DecisionType/version aware.
18. Hard-stop conditions cannot be overridden by provider output.
19. Shadow/counterfactual paths never mutate live business state.
20. Stable repeated decisions should be candidates for reviewed deterministic graduation instead of permanent model dependence.
21. Run review consumes observable traces/evidence/outcomes, never hidden chain-of-thought.

## 4. Intelligence and decision primitives

### 4.1 DecisionProvider

```rust
#[async_trait]
pub trait DecisionProvider: Send + Sync {
    async fn decide(&self, request: DecisionRequest) -> Result<DecisionResponse>;
}
```

`DecisionRequest` contains bounded state, explicit typed questions, candidate values, optional precedent context, decision type/version, and evidence refs.

Initial implementation uses Mistral/Gemini through `LlmDecisionAdapter`; Jev later implements the same contract.

### 4.2 GenerationProvider

Generation covers prose, code/program authoring, documents, reports, presentations and other synthesis. Generated output remains subject to evidence and answer admission.

### 4.3 ReasoningProvider

`agent_loop.rs` is refactored behind proposal-only reasoning:

```rust
pub enum ReasoningOutcome {
    DecisionProposal(DecisionProposal),
    CapabilityProposal(CapabilityProposal),
    ProgramPatchProposal(ProgramPatchProposal),
    ClarificationRequest(ClarificationRequest),
    FinalDraft(FinalDraft),
    UnableToProgress(UnableToProgress),
}
```

It owns bounded reasoning state, provider interaction, malformed-output handling and non-progress detection only.

It does not own capability execution, authorization, policy admission, spend settlement, approvals, mutation retry/recovery, verification, final-answer admission, precedent mutation, or hard-stop semantics.

## 5. Typed DecisionGraph

Programs compile a typed decision graph using nodes defined in `typed-decision-graph-and-run-review-plan.md`:

```text
Compute
Choice
Score
Probability
DecisionBatch
AcquireEvidence
Gate
EarlyStop
Capability
Verify
Reason
Generate
RequireApproval
```

Use `Compute` for exact facts. Use AI-backed nodes only for genuine semantic uncertainty.

Independent questions may run as a `DecisionBatch`. Uncertain or conflicting outputs may trigger `AcquireEvidence`, which re-runs only affected downstream nodes.

`Gate` and `EarlyStop` nodes map signals/probabilities to deterministic program control using current policy configuration.

## 6. Organizational decision vocabulary

Every AI-backed judgment should reference a versioned `DecisionTypeDefinition` containing:

```text
input/output schema
required evidence
risk class
precedent policy
verification policy
escalation policy
```

Examples include `PaymentDisposition`, `CreditRisk`, `SupplierRisk`, `CustomerEscalation`, `StockReorderPriority`, and `FraudConcern`.

Provider prompts/wire formats are adapters around these stable organizational semantics.

## 7. Probabilistic state and calibration

Probabilities/confidence remain first-class program state rather than being collapsed immediately.

```rust
pub struct Probabilistic<T> {
    pub value: T,
    pub confidence: Option<f64>,
    pub distribution: Option<serde_json::Value>,
    pub calibration_profile: Option<CalibrationProfileRef>,
    pub evidence_refs: Vec<EvidenceRef>,
}
```

Provider confidence and calibrated confidence are distinct. Thresholds belong to the program/policy, not the provider.

## 8. Decision precedent and institutional memory

Decision memory is separate from knowledge and execution memory.

```text
KnowledgeMemory  -> facts, documents, policies, sources
DecisionMemory   -> prior cases, corrections, outcomes, patterns
ExecutionMemory  -> runs, capability traces, artifacts, recipes
```

Precedent retrieval is DecisionType/version aware and considers tenant/company scope, policy version, material constraints, context/entity shape, verification/outcome quality, recency, review status, and supersession/rejection state.

Historical approval/authorization never becomes current authority.

Repeated stable decision clusters may become reviewed `DecisionPattern`s and later deterministic program/policy/native ERP behavior.

## 9. ReasoningStep

`ReasoningStep` is exceptional. Use it only when the typed graph genuinely cannot resolve the state or the request is exploratory.

It receives an admitted view: objective, bounded state/evidence, optional precedent summaries, candidate capabilities, allowed proposal kinds, and remaining budget.

Any proposal returns through normal schema validation, authorization, policy, approval, spend admission, execution and verification.

## 10. RunReviewProgram

Production-shaped governed runs should be eligible for independent post-run review.

The reviewer checks observable facts including objective satisfaction, unsupported claims, wrong branch/capability choice, policy anomalies, suspicious effects, unresolved uncertainty and precedent contradictions.

Typed result:

```text
Healthy
ReviewRequired
Defect
IncidentCandidate
```

Where practical, route review through a different provider/profile from execution.

## 11. Shadowing and counterfactuals

Shadow evaluation may compare providers, candidate policy versions, and deterministic DecisionPattern candidates over the same versioned decision snapshot.

Shadows cannot change control flow or business state.

Measure calibration, verified outcome, correction rate, cost/latency, precedent lift and policy disagreement.

## 12. Deterministic graduation

Track per DecisionType:

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

Stable repeated decisions progress through:

```text
AI decision
 -> DecisionPattern candidate
 -> fixtures/evals/review
 -> deterministic shadow implementation
 -> outcome comparison
 -> reviewed deterministic program branch / policy / native ERP feature
```

Graduation is versioned and reversible.

## 13. What happens to `agent_loop.rs`

Retain bounded transcript/state, model rounds, malformed proposal handling, duplicate/non-progress detection, proposal construction, clarification and planning/replanning.

Move provider routing policy, spend settlement, capability authorization, invocation policy, direct execution, approval lifecycle, mutation retry/reconciliation, evidence verification, final-answer admission and precedent persistence into shared runtime services.

Existing direct-execution behavior may survive temporarily through a compatibility adapter only.

## 14. Migration authority

Execution sequence is defined in `governed-intelligence-program-migration.md`, now spanning intelligence seams, proposal-only reasoning, precedent, DecisionType registry, typed DecisionGraph IR, probabilistic state, conditional evidence, parallel decision batches, independent run review, shadow/counterfactual evaluation, deterministic graduation and Jev admission.

## 15. Acceptance criteria

The architecture is adopted when:

1. at least one production-shaped ERP workflow executes as a compiled typed DecisionGraph without the generic loop on the happy path;
2. deterministic facts are computed outside providers;
3. provider outputs remain typed/probabilistic until explicit program/policy gates convert them to control flow;
4. uncertain states can acquire authorized evidence and re-evaluate affected nodes only;
5. independent typed decisions can execute in parallel;
6. hard stops cannot be overridden by providers;
7. `agent_loop` operates in proposal-only mode;
8. precedent retrieval is tenant-scoped and DecisionType/version aware;
9. independent RunReviewProgram can flag a run without execution authority;
10. shadows cannot mutate business state;
11. repeated stable decisions can be surfaced and shadowed as deterministic candidates;
12. Jev can later satisfy the same DecisionGraph nodes without changing program semantics.
