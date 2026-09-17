# Governed intelligence program architecture

**Status:** Proposed architecture authority for post-H5 harness work
**Date:** 2026-09-17
**Supersedes:** model-first / generic-agent-loop assumptions in future harness work
**Preserves:** generated ERP capability authority, Casbin/STDB authority, per-call policy, spend admission, approval stops, durable run events, evidence/verification contracts
**Extends:** `decision-precedent-memory-layer.md`

## 1. Decision

Lumiere's AI harness is a **governed program runtime**, not an LLM-shaped agent runtime.

Models are replaceable intelligence primitives inside an explicit program. They do not own authorization, ERP semantics, workflow state, business mutation semantics, execution authority, or organizational precedent.

The runtime exposes three distinct intelligence operations:

```text
decide()    -> bounded classification / choice / score / probability
generate()  -> prose/code/artifact synthesis
reason()    -> bounded proposal generation when the program cannot determine the next step
```

The important boundary is:

```text
model proposes
precedent informs
runtime authorizes / executes / verifies
```

Initial providers remain Mistral/Gemini/Kong/Ollama where already admitted. A future Jev/System-One provider implements `decide()` without forcing a redesign of the harness.

Target architecture:

```text
User objective
      ↓
Context compiler
      ↓
GovernedProgram
      ├── DeterministicStep
      ├── DecisionStep
      │      └── PrecedentRetriever -> bounded prior cases/patterns
      ├── CapabilityStep
      ├── VerificationStep
      ├── GenerationStep
      ├── ReasoningStep  -> typed proposal only
      └── ApprovalStep
      ↓
shared runtime admission
      ├── authorization
      ├── invocation policy
      ├── spend/budget admission
      ├── approval state
      ├── evidence/provenance
      ├── precedent governance
      └── execution/recovery
      ↓
Generated ERP capability surface
      ↓
STDB / authoritative read models / action-draft paths
```

## 2. Why change direction

The existing H3-H5 implementation is valuable and remains infrastructure:

- normalized provider transport;
- bounded rounds/model/tool/token limits;
- per-invocation policy checks;
- approval stops;
- spend admission;
- provider-attempt persistence;
- durable execution events;
- non-progress detection.

The correction is to stop treating a tool-calling conversation loop as the universal runtime and to stop letting the reasoning loop own execution semantics.

For known ERP workflows, asking a generative model to reconstruct the next-state machine wastes context, makes evaluation harder, increases tool-selection variance, and couples orchestration to chat-provider semantics.

For unknown/open-ended work, the model may still help determine a next step, but it should return a typed proposal that the governed runtime independently validates and executes.

For recurring business decisions, the runtime should also retrieve prior verified cases and outcomes so providers reason from organizational precedent instead of starting from zero on every run.

## 3. Non-negotiable invariants

1. `DecisionProvider`, `GenerationProvider`, and `ReasoningProvider` never become authorization or execution authorities.
2. Generated capability IR remains the canonical application-operation vocabulary.
3. Casbin/server authorization is re-evaluated for every consequential capability invocation.
4. STDB reducers/business invariants remain authoritative for mutation semantics.
5. Decision confidence is advisory input to deterministic admission policy; it cannot grant permissions or bypass confirmation.
6. Provider-reported confidence is not assumed calibrated. Production calibration uses verified outcomes/evals.
7. Unknown/low-confidence/high-risk states escalate to verification, clarification, review, or bounded `reason()`; they do not silently widen authority.
8. `ReasoningStep` may propose but may not directly execute capabilities, approve drafts, retry mutations, or admit final answers.
9. Provider substitution must not change durable program semantics.
10. Every intelligence call is replay/inspection friendly without persisting hidden chain-of-thought.
11. Shared runtime services own authorization, policy, budgets, approval, execution, recovery and verification for every step kind.
12. New fixed ERP workflows must not be implemented as generic agent loops when their program graph is known.
13. Precedent informs current decisions but never becomes current authorization, approval, or business-rule authority.
14. Corrections/supersessions are append-only and remain linked to the original decision case.
15. Precedent retrieval is tenant-scoped by default and must preserve material constraints/outcome provenance.
16. Stable repeated decisions should be candidates for deterministic graduation instead of permanent model dependence.

## 4. Intelligence primitives

### 4.1 DecisionProvider

```rust
#[async_trait]
pub trait DecisionProvider: Send + Sync {
    async fn decide(&self, request: DecisionRequest) -> Result<DecisionResponse>;
}
```

`DecisionRequest` contains bounded state, explicit questions, candidate values and optional compact precedent context. Initial implementation uses `LlmDecisionAdapter` over Mistral/Gemini. Future Jev integration implements the same contract.

### 4.2 GenerationProvider

```rust
#[async_trait]
pub trait GenerationProvider: Send + Sync {
    async fn generate(&self, request: GenerationRequest) -> Result<GenerationResponse>;
}
```

Generation covers prose synthesis, code/program authoring, documents, reports and presentation composition. Generated output remains subject to evidence and final-answer admission.

### 4.3 ReasoningProvider

The existing agent loop is refactored behind a proposal-only reasoning interface:

```rust
#[async_trait]
pub trait ReasoningProvider: Send + Sync {
    async fn reason(&self, request: ReasoningRequest) -> Result<ReasoningOutcome>;
}

pub enum ReasoningOutcome {
    DecisionProposal(DecisionProposal),
    CapabilityProposal(CapabilityProposal),
    ProgramPatchProposal(ProgramPatchProposal),
    ClarificationRequest(ClarificationRequest),
    FinalDraft(FinalDraft),
    UnableToProgress(UnableToProgress),
}
```

`ReasoningProvider` owns only bounded reasoning state, provider interaction, malformed-output handling and non-progress detection.

It does **not** own capability execution, authorization, policy admission, spend reservation/settlement, approval/draft lifecycle, mutation retry/recovery, verification, final-answer admission, or precedent mutation.

Those remain shared governed-runtime services.

## 5. Decision precedent and institutional memory

Decision memory is a separate first-class layer from knowledge memory and execution memory.

```text
KnowledgeMemory  -> facts, documents, policies, source passages
DecisionMemory   -> prior cases, crossroads, corrections, outcomes, promoted patterns
ExecutionMemory  -> program runs, capability traces, artifacts, recipes
```

`DecisionStep` may declare a precedent policy and retrieve the strongest admissible prior cases before calling `DecisionProvider`.

```text
current bounded decision state
      ↓
PrecedentRetriever
      ↓
verified prior cases / corrections / outcomes / patterns
      ↓
compact precedent context
      ↓
DecisionProvider
```

Retrieval is hybrid rather than embedding-only and must account for decision type, tenant/company scope, program/step compatibility, entity/context shape, material constraints, semantic similarity, verification/outcome quality, review status, recency and supersession/rejection state.

Precedent is never executable authority. Historical approval is not current approval; historical authorization is not current authorization.

Repeated stable decisions may be promoted through a reviewed `DecisionPattern` lifecycle:

```text
individual cases
  ↓
verified precedent cluster
  ↓
DecisionPattern candidate
  ↓
human/eval review
  ↓
reviewed pattern
  ↓
deterministic program branch / policy / native ERP feature
```

See `decision-precedent-memory-layer.md` for canonical records, retrieval and governance.

## 6. ReasoningStep contract

`ReasoningStep` is exceptional, not the default control plane.

Use it when the execution graph cannot be predetermined, hypotheses must be revised from evidence, capability ordering depends on semantic observations not captured by the static program, recovery requires choosing among several admissible next actions, or the request is exploratory by nature.

A reasoning step receives only an admitted view:

```text
objective
bounded state summary
current evidence refs/summaries
bounded precedent summaries where enabled
candidate CapabilityKeys and schemas
allowed proposal kinds
remaining reasoning budget
```

It returns a proposal. The runtime handles it through schema validation, authorization, policy/risk/approval, spend/tool admission, execution and verification. The reasoning provider never receives a raw execution handle that lets it bypass this path.

## 7. GovernedProgram model

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

The program owns control flow. Providers provide bounded intelligence results.

Known workflow example:

```text
objective
  ↓
deterministic capability discovery
  ↓
DecisionStep
  ├── retrieve precedent
  └── choose from 3-10 admitted candidates
  ↓
CapabilityStep
  ↓
VerificationStep
  ↓
record DecisionCase + Outcome
  ↓
DecisionStep: evidence sufficient?
  ├── no -> bounded acquisition branch
  └── yes -> GenerationStep
```

Open-ended escalation still returns through normal governed execution.

## 8. Capability discovery and routing

Keep deterministic narrowing first:

```text
objective
  ↓
lexical/tag/semantic discovery
  ↓
Casbin-filtered candidate set
  ↓
3-10 generated CapabilityKeys
  ↓
DecisionStep or ReasoningStep over that bounded set
```

No provider receives the full operation catalog by default.

Routing is by primitive and eval profile rather than provider brand:

```text
decide(choice, cardinality=6, reliability>=X, precedent=enabled)
generate(report-summary, budget=Y)
reason(exploratory-analysis, max_rounds=Z, proposal_kinds=[...])
```

## 9. Confidence, verification, precedent and shadowing

Persist:

```text
DecisionRequested
PrecedentQueryRequested
PrecedentMatchesReturned
PrecedentUsed
DecisionAnswered
DecisionVerified
DecisionEscalated
DecisionCaseRecorded
DecisionCaseCorrected
DecisionPatternProposed
DecisionPatternPromoted
DecisionPatternSuperseded
ReasoningRequested
ReasoningProposed
ReasoningProposalAccepted
ReasoningProposalRejected
```

Provider confidence is never a permission. Calibration comes from verified outcomes.

Shadow providers may evaluate the same decision request but cannot affect control flow, execute capabilities or alter business state. Evals should compare provider quality both with and without precedent context so the system can measure whether precedent actually improves correctness/cost.

## 10. What happens to `agent_loop.rs`

`orchestrator/agent_loop.rs` is retained but refactored.

Keep bounded transcript/state, model interaction rounds, malformed proposal handling, duplicate/non-progress detection, proposal construction, clarification proposal generation and bounded planning/replanning.

Move provider routing policy, spend reservation/settlement, capability authorization, invocation policy, direct capability execution, approval lifecycle, mutation retry/reconciliation, evidence verification, final-answer admission and precedent persistence out to governed-runtime services.

During migration, existing direct-execution behavior may remain behind a compatibility adapter until proposal-mode parity is proven. It must not become the design target for new work.

## 11. Migration milestones

### GIP-0 — intelligence seams

- [ ] add `DecisionProvider`;
- [ ] add `GenerationProvider` where needed;
- [ ] add proposal-only `ReasoningProvider` / `ReasoningOutcome` types;
- [ ] retain `LlmCompletion` as transport/internal adapter;
- [ ] add decision/reasoning durable events.

### GIP-1 — extract execution authority from agent loop

- [ ] create shared governed-runtime capability executor;
- [ ] move authorization/policy/spend/approval/execution out of loop ownership;
- [ ] make loop capability output a `CapabilityProposal`;
- [ ] add compatibility adapter for existing loop tests/paths;
- [ ] prove no proposal can bypass generated capability validation.

### GIP-2 — decision precedent foundation

- [ ] add `DecisionCase`, correction/outcome refs and immutable status lifecycle;
- [ ] add tenant-scoped `PrecedentStore`;
- [ ] add hybrid retrieval and compact precedent context;
- [ ] record precedent refs on accepted decisions/proposals;
- [ ] add precedent events and stale/superseded filtering;
- [ ] add `DecisionPattern` candidate/promotion records.

### GIP-3 — first governed program

Use a read-only production-shaped workflow:

```text
objective -> discovery -> precedent retrieval -> DecisionStep -> CapabilityStep -> VerificationStep -> DecisionCase -> GenerationStep
```

No `ReasoningStep` should be required for the happy path.

### GIP-4 — reasoning escalation

- [ ] add `ReasoningStep` to governed programs;
- [ ] constrain allowed proposal kinds/candidate capabilities per step;
- [ ] optionally include bounded precedent summaries;
- [ ] resume the governed program after accepted proposals;
- [ ] reject malformed/unauthorized proposals without provider-side execution.

### GIP-5 — intelligence router and calibration

- [ ] route `decide` / `generate` / `reason` independently by eval profile;
- [ ] retain provider-attempt persistence and spend accounting;
- [ ] add shadow decision providers;
- [ ] compare decision quality with/without precedent context.

### GIP-6 — migrate known ERP programs

- [ ] explicit graphs for known workflows;
- [ ] decision nodes for bounded semantic uncertainty;
- [ ] precedent retrieval where the decision class is recurrence-heavy;
- [ ] reasoning only for genuine open-ended escalation;
- [ ] identify stable repeated decisions as deterministic-graduation candidates;
- [ ] no new provider-specific orchestration branches.

### GIP-7 — Jev/System-One admission

- [ ] implement `JevDecisionProvider` only;
- [ ] begin shadow-only;
- [ ] compare calibration/accuracy/latency/cost with and without precedent;
- [ ] admit decision classes through normal routing policy;
- [ ] no Jev-specific ERP semantics or orchestration.

## 12. Acceptance criteria

The architecture is adopted when:

1. at least one production-shaped ERP workflow runs without the generic loop;
2. the agent loop can operate in proposal-only mode;
3. a capability proposed by reasoning is executed only by shared governed-runtime services;
4. a `DecisionStep` can retrieve scoped prior cases before provider invocation;
5. corrections/supersessions preserve immutable historical decisions;
6. precedent cannot bypass authorization/policy/approval;
7. repeated stable decisions can be surfaced as `DecisionPattern`/deterministic-graduation candidates;
8. Mistral/Gemini decision adapters and reasoning providers can be routed independently;
9. reasoning-provider replacement cannot alter authorization or business semantics;
10. adding Jev requires only a `DecisionProvider` adapter plus eval/routing configuration.

## 13. Plan impact

- `ai-harness-completion-plan.md`: H4/H5 loop work is retained as migration substrate; future work must extract execution authority from the loop rather than expand it.
- `agent-control-plane-model-routing-plan.md`: routing is per intelligence primitive; governed program state owns control flow and shared runtime services own execution.
- `ai-enterprise-harness-plan.md`: provider seams remain, but provider outputs are proposals/decisions/generation results, never execution authority.
- `model-refinement-dataset-plane.md`: evals should produce per-decision/per-reasoning capability profiles and measure precedent lift/correction rate.
- `erp-harness-implementation-ledger.md`: new milestones must reference governed-program primitives, precedent memory where relevant, and may not create a second execution model.
