# Governed intelligence program migration

**Status:** Execution companion to `governed-intelligence-program-architecture.md`
**Date:** 2026-09-17
**Extends:** `decision-precedent-memory-layer.md` and `typed-decision-graph-and-run-review-plan.md`

## Purpose

Convert the landed bounded-agent harness into a governed typed-decision runtime while preserving useful H3-H5 infrastructure and removing execution authority from the model loop.

This is a restructuring sequence, not a rewrite.

## Existing assets to retain

Retain as first-class infrastructure:

- `providers/llm.rs` normalized provider transport;
- `orchestrator/agent_loop.rs` bounded reasoning mechanics;
- `orchestrator/invocation_policy.rs`;
- `orchestrator/spend_admission.rs`;
- `orchestrator/progress.rs`;
- provider-attempt persistence;
- run/step event persistence;
- generated capability registry and policy filtering;
- approval/draft semantics;
- evidence/provenance and answer-admission work.

## Migration rule

Do not delete the current loop first. Refactor it behind compatibility seams until proposal-only reasoning reaches parity.

Target direction:

```text
existing loop with direct tool execution
      ↓
extract shared governed execution services
      ↓
loop emits typed proposals
      ↓
introduce typed DecisionType + DecisionGraph IR
      ↓
GovernedProgram validates/executes graph
      ↓
known workflows move to explicit graphs
      ↓
loop remains only as ReasoningStep
```

The target invariant is:

```text
AI supplies narrow typed judgments.
Precedent informs.
Program IR composes.
Policy gates consequences.
Governed runtime executes and verifies.
Independent review judges the completed run.
```

## Work packages

### GP-01 — intelligence contracts

Deliver provider-neutral contracts for:

- `DecisionProvider`;
- `GenerationProvider`;
- `ReasoningProvider`;
- `ReasoningOutcome`;
- `CapabilityProposal`;
- `DecisionProposal`;
- `ProgramPatchProposal`;
- `ClarificationRequest`;
- strict validation and deterministic request hashing.

No production route switch yet.

### GP-02 — LLM adapters

Implement:

```text
DecisionProvider -> LlmDecisionAdapter -> Mistral/Gemini
ReasoningProvider -> AgentLoopReasoner -> existing LlmCompletion transport
GenerationProvider -> current generation transport/adapters
```

Requirements:

- malformed typed outputs fail closed;
- adapter outputs cannot directly execute capabilities;
- provider confidence remains untrusted metadata;
- provider attempts and usage remain durable.

### GP-03 — shared governed execution services

Extract responsibilities currently embedded in/around the loop into shared runtime services:

```text
CapabilityAdmission
CapabilityExecutor
SpendAdmission/Settlement
ApprovalCoordinator
VerificationService
ExecutionRecovery
FinalAnswerAdmission
```

Requirements:

- `DecisionStep`, `CapabilityStep`, and accepted `ReasoningStep` proposals reuse the same services;
- there is one authorization/policy path, not a loop-specific copy;
- generated capability IR remains the only executable ERP vocabulary;
- mutation recovery never depends on model retry behavior.

### GP-04 — proposal-only loop mode

Refactor `agent_loop.rs` so model-selected capabilities become typed proposals instead of immediate tool execution.

Keep bounded transcript/state, model rounds, malformed-output handling, duplicate/non-progress detection, bounded planning/replanning, and clarification proposals.

Remove capability execution, authorization/policy authority, spend reservation/settlement, approvals, mutation retry/reconciliation, evidence verification, final-answer admission, and precedent persistence from loop ownership.

### GP-05 — durable decision/reasoning events

Persist typed decision/reasoning requests, outputs, verification, escalation, acceptance/rejection, and provider-attempt links.

### GP-06 — decision precedent foundation

Deliver immutable `DecisionCase`, corrections/outcomes, tenant-scoped `PrecedentStore`, hybrid retrieval, decision-pattern candidates, and policy/version-aware precedent filtering.

### GP-07 — DecisionType registry

Introduce versioned `DecisionTypeDefinition` with:

- input/output schemas;
- required evidence;
- risk class;
- precedent policy;
- verification policy;
- escalation policy.

Bind decision cases to decision type/version.

### GP-08 — typed DecisionGraph IR

Introduce graph nodes:

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

Requirements:

- deterministic computation before model judgment;
- graph validation before execution;
- no provider-owned control flow;
- cycles only through explicit bounded constructs.

### GP-09 — probabilistic program state

Add first-class probabilistic state/distribution metadata and deterministic threshold gates.

Requirements:

- provider confidence separated from calibrated confidence;
- calibration profile refs persisted;
- thresholds owned by policy/program configuration;
- signals separated from operational disposition.

### GP-10 — conditional evidence + early stops

Add authorized evidence acquisition nodes that run only when needed and re-evaluate affected nodes only.

Add hard stop/escalation semantics that providers cannot override.

### GP-11 — parallel decision batches

Execute independent typed questions concurrently while preserving per-question events, provider usage, calibration, and deterministic dependency ordering.

### GP-12 — first production-shaped typed governed program

Choose one read-only recurrence-heavy ERP workflow.

Target happy path:

```text
objective
 -> deterministic Compute nodes
 -> precedent retrieval
 -> parallel bounded decisions
 -> Gate
 -> conditional AcquireEvidence if needed
 -> CapabilityStep
 -> VerificationStep
 -> DecisionCase
 -> GenerationStep
```

`ReasoningStep` must not be required on the normal path.

Compare against the current loop for provider calls, tokens, latency, selection failures, evidence coverage, corrections, correctness, and cost.

### GP-13 — reasoning escalation

Add `ReasoningStep` only when the typed graph cannot resolve the state.

A reasoning step declares allowed proposal kinds, bounded candidate capability/discovery surface, remaining rounds/tokens, patch scope, and clarification policy.

Accepted proposals return to normal governed execution.

### GP-14 — independent RunReviewProgram

Review completed observable traces/evidence/outcomes independently from execution.

Typed dispositions:

```text
Healthy
ReviewRequired
Defect
IncidentCandidate
```

Review checks objective satisfaction, unsupported claims, branch/capability errors, policy anomalies, suspicious effects, unresolved uncertainty, and precedent contradictions.

Where practical, route review through a different provider/profile from execution.

### GP-15 — intelligence router + shadow paths

Route `decide` / `generate` / `reason` independently by eval profile.

Support shadow decision providers, candidate policy versions, and deterministic decision-pattern candidates over the same versioned decision snapshot with zero live side effects.

### GP-16 — deterministic graduation

Execution plan: `deterministic-graduation-execution-plan.md`.

Track structurally compatible decision cohorts by DecisionType/version and applicability fingerprint. Measure correction rate, verified outcomes, provider disagreement, entropy, precedent consistency, policy/evidence/candidate-set stability, latency and cost.

Promote only through a reviewed, reversible lifecycle:

```text
DecisionPattern candidate
 -> versioned graduation eligibility policy
 -> reviewed pattern
 -> deterministic implementation
 -> zero-authority deterministic shadow
 -> fixture + live conformance
 -> reviewed promotion
 -> deterministic-primary / model-shadow
 -> optional deterministic-only
```

Graduation must sit above provider routing rather than masquerading as another provider. Authorization, capability admission, verification, approval and STDB business invariants remain unchanged.

Promotion is never automatic from frequency or cost. Drift, corrections, policy changes or review defects can downgrade deterministic authority back to model-primary without deleting historical evidence.

### GP-17 — migrate known ERP programs

For each workflow:

1. define explicit typed graph;
2. compute deterministic facts in code;
3. use bounded typed decisions only for genuine uncertainty;
4. use DecisionBatch where independent judgments can run concurrently;
5. retrieve precedent by DecisionType/version where useful;
6. acquire additional evidence conditionally;
7. use deterministic gates/early stops for consequences;
8. use `ReasoningStep` only for genuine open-ended escalation;
9. enable RunReviewProgram according to risk;
10. identify deterministic-graduation candidates.

### GP-18 — Jev/System-One admission

When Jev API access/stability is sufficient:

- implement `JevDecisionProvider` only;
- map it to Choice/Score/Probability nodes;
- begin shadow-only;
- evaluate batching, calibration, latency, cost and precedent lift;
- admit decision classes through normal routing policy;
- no Jev-specific ERP semantics or workflow branches.

## Explicit non-goals

- deleting the current loop before migration parity;
- replacing STDB business logic with model decisions;
- replacing Casbin with confidence thresholds or precedent frequency;
- letting reasoning providers execute capabilities directly;
- letting providers own retries for consequential mutations;
- forcing exploratory work into static graphs;
- exposing the full capability catalog by default;
- treating provider probabilities as calibrated truth;
- allowing model output to override deterministic hard stops;
- using raw transcript history as organizational decision memory.

## Review gate

No new harness feature should add provider-specific orchestration when it can be expressed as:

```text
compute
decide(choice/score/probability)
batch
precedent
acquire_evidence
gate / early_stop
generate
reason -> proposal
capability
verify
approval
run_review
```

No new `ReasoningStep` may directly call an ERP executor. No model output may directly own disposition when the program can derive disposition from typed signals and explicit policy gates.

Exceptions require an explicit architecture decision and evidence that the primitive set is insufficient.
