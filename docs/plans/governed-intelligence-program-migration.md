# Governed intelligence program migration

**Status:** Execution companion to `governed-intelligence-program-architecture.md`
**Date:** 2026-09-17
**Related:** `decision-precedent-memory-layer.md`

## Purpose

Convert the landed bounded-agent harness into a governed-program runtime while preserving useful H3-H5 infrastructure, removing execution authority from the model loop, and adding tenant-scoped decision precedent as reusable institutional memory.

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
add immutable DecisionCase + PrecedentStore
      ↓
GovernedProgram retrieves precedent and executes decisions through shared runtime
      ↓
known workflows move to explicit program graphs
      ↓
loop remains only as ReasoningStep
```

Target invariants:

```text
ReasoningProvider proposes.
Precedent informs.
Governed runtime authorizes, executes and verifies.
```

## Work packages

### GP-01 — intelligence contracts

Deliver provider-neutral contracts for `DecisionProvider`, `GenerationProvider`, `ReasoningProvider`, `ReasoningOutcome`, `CapabilityProposal`, `DecisionProposal`, `ProgramPatchProposal`, `ClarificationRequest`, strict validation and deterministic request hashing.

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
- one authorization/policy path, not a loop-specific copy;
- generated capability IR remains the only executable ERP vocabulary;
- mutation recovery never depends on model retry behavior.

### GP-04 — proposal-only loop mode

Refactor `agent_loop.rs` so a model-selected capability becomes a `CapabilityProposal` instead of immediate execution.

Keep bounded transcript/state, model rounds, malformed-output handling, duplicate/non-progress detection, bounded planning/replanning and clarification proposals.

Remove capability execution, authorization/policy authority, spend reservation/settlement, approvals, mutation retry/reconciliation, evidence verification and final-answer admission from loop ownership.

A compatibility adapter may preserve existing tests/routes temporarily, but new harness work must target proposal mode.

### GP-05 — durable decision/reasoning events

Persist:

```text
DecisionRequested
DecisionAnswered
DecisionVerified
DecisionEscalated
ReasoningRequested
ReasoningProposed
ReasoningProposalAccepted
ReasoningProposalRejected
```

Bind each to program/version, step id, provider/model attempt, input hash, candidate set / allowed proposal kinds, output, and verification/rejection reason.

### GP-06 — decision precedent foundation

Introduce the institutional-memory layer from `decision-precedent-memory-layer.md`.

Deliver:

- immutable `DecisionCase` records;
- correction/supersession links rather than mutation;
- outcome/verification refs;
- tenant-scoped `PrecedentStore`;
- hybrid retrieval by decision type + program/step + entity/context shape + constraints + semantic similarity + outcome/review quality;
- compact precedent context for providers;
- durable precedent events;
- stale/rejected/superseded filtering;
- `DecisionPattern` candidate records.

Hard requirements:

- historical approval is not current approval;
- historical authorization is not current authorization;
- precedent cannot execute capabilities;
- cross-tenant precedent is forbidden by default;
- current facts/policy dominate stale precedent.

### GP-07 — governed program core

Introduce typed program execution:

```text
DeterministicStep
DecisionStep
CapabilityStep
VerificationStep
GenerationStep
ReasoningStep
ApprovalStep
```

The program owns control flow. Intelligence providers return bounded values/proposals only. `DecisionStep` may declare a `PrecedentPolicy` and retrieve prior cases before provider invocation.

### GP-08 — first read-only governed program with precedent

Choose one production-shaped read-only workflow already represented by reviewed generated capabilities and with a meaningful recurring decision point.

Target happy path:

```text
objective
 -> deterministic discovery
 -> PrecedentRetriever
 -> DecisionStep
 -> CapabilityStep
 -> VerificationStep
 -> DecisionCase record
 -> DecisionStep(sufficiency)
 -> GenerationStep
```

`ReasoningStep` must not be required on the normal path.

Compare against the current loop for provider calls, tokens, latency, selection failures, policy denials, evidence coverage, correctness/eval outcome, precedent hit rate and correction rate.

Run an A/B eval with precedent disabled vs enabled to prove lift rather than assume it.

### GP-09 — reasoning escalation path

Add `ReasoningStep` only for states the explicit program cannot resolve.

A reasoning step declares allowed proposal kinds, candidate capability set/discovery boundary, remaining rounds/tokens, acceptable program-patch scope, clarification policy, and whether bounded precedent summaries may be included.

Accepted proposals return to normal governed execution. Rejected/malformed proposals never execute provider-side.

### GP-10 — intelligence router

Route independently by primitive and eval profile:

```text
decide(choice, cardinality=6, reliability>=X, precedent=enabled)
generate(report-summary, budget=Y)
reason(exploratory-analysis, max_rounds=Z)
```

Do not route an entire workflow to a provider.

### GP-11 — shadow providers and calibration

Allow non-authoritative decision providers to receive identical bounded requests.

Shadow providers cannot affect control flow, execute capabilities, alter approval state or write business state; they are separately budgeted and recorded.

Eval dimensions include:

- accuracy/calibration;
- latency/cost;
- correction rate;
- outcome quality;
- with-precedent vs without-precedent lift.

This is the Jev/System-One evaluation seam.

### GP-12 — decision-pattern promotion and deterministic graduation

Aggregate repeated verified cases into reviewed `DecisionPattern` candidates.

Promotion flow:

```text
repeated verified cases
  -> cluster/pattern candidate
  -> outcome/correction metrics
  -> human/eval review
  -> reviewed DecisionPattern
  -> optional deterministic program branch / policy / native ERP feature
```

Do not auto-promote based on frequency alone. Promotion requires applicability bounds, outcome evidence, correction-rate review and normal product/policy governance.

### GP-13 — migrate known ERP programs

For each workflow:

1. define explicit program graph;
2. use deterministic code when semantics are known;
3. use `DecisionStep` for bounded uncertainty;
4. retrieve precedent only for recurrence-heavy decision classes;
5. use `CapabilityStep` for execution;
6. use `GenerationStep` for synthesis;
7. use `ReasoningStep` only for genuine open-ended escalation;
8. flag stable repeated decisions as deterministic-graduation candidates;
9. keep all authorization/evidence/budget gates in shared runtime services.

### GP-14 — Jev admission

When Jev API access/stability is sufficient:

- implement `JevDecisionProvider` only;
- start in shadow mode;
- compare calibration, accuracy, latency and cost against LLM adapters;
- compare with/without precedent context;
- admit only decision classes that pass normal eval gates;
- never add Jev-specific ERP semantics or workflow branches.

## Explicit non-goals

- deleting the current loop before migration parity;
- replacing STDB business logic with model decisions;
- replacing Casbin with confidence thresholds or precedent frequency;
- letting reasoning providers execute capabilities directly;
- letting providers own retries for consequential mutations;
- forcing exploratory work into static graphs;
- exposing the full capability catalog by default;
- treating provider probabilities as calibrated truth;
- treating historical approval/authorization as current authority;
- cross-tenant precedent retrieval by default;
- auto-promoting frequent decisions into policy/business rules.

## Review gate

No new harness feature should add provider-specific orchestration when it can be expressed as:

```text
decide
generate
reason -> proposal
precedent -> bounded context
capability
verify
approval
```

No new `ReasoningStep` may directly call an ERP executor. No precedent record may bypass current runtime admission.

Exceptions require an explicit architecture decision and evidence that the primitive set is insufficient.
