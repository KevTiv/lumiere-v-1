# Governed intelligence program migration

**Status:** Execution companion to `governed-intelligence-program-architecture.md`
**Date:** 2026-09-17

## Purpose

Convert the landed bounded-agent harness into a governed-program runtime while preserving useful H3-H5 infrastructure and removing execution authority from the model loop.

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
GovernedProgram validates/executes proposals
      ↓
known workflows move to explicit program graphs
      ↓
loop remains only as ReasoningStep
```

The target invariant is:

```text
ReasoningProvider proposes.
Governed runtime authorizes, executes and verifies.
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

Extract the responsibilities currently embedded in/around the loop into shared runtime services:

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

Refactor `agent_loop.rs` so a model-selected capability becomes:

```text
CapabilityProposal {
  capability_key,
  typed_arguments,
  proposal_context,
}
```

instead of an immediate tool execution.

Keep in the loop:

- bounded transcript/state;
- model rounds;
- malformed-output handling;
- duplicate/non-progress detection;
- bounded planning/replanning;
- clarification proposals.

Remove from loop ownership:

- capability execution;
- authorization/policy authority;
- spend reservation/settlement;
- approvals;
- mutation retry/reconciliation;
- evidence verification;
- final-answer admission.

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

Bind each to:

- program/version;
- step id;
- provider/model attempt;
- input hash;
- candidate set / allowed proposal kinds;
- output;
- verification or rejection reason.

### GP-06 — governed program core

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

The program owns control flow. Intelligence providers return bounded values/proposals only.

### GP-07 — first read-only governed program

Choose one production-shaped read-only workflow already represented by reviewed generated capabilities.

Target happy path:

```text
objective
 -> deterministic discovery
 -> DecisionStep
 -> CapabilityStep
 -> VerificationStep
 -> DecisionStep(sufficiency)
 -> GenerationStep
```

`ReasoningStep` must not be required on the normal path.

Compare against the current loop for:

- provider calls;
- tokens;
- latency;
- selection failures;
- policy denials;
- evidence coverage;
- correctness/eval outcome.

### GP-08 — reasoning escalation path

Add `ReasoningStep` only for states the explicit program cannot resolve.

A reasoning step must declare:

```text
allowed proposal kinds
candidate capability set or discovery boundary
remaining rounds/tokens
acceptable program patch scope
clarification policy
```

Accepted proposals return to normal governed execution. Rejected/malformed proposals never execute provider-side.

### GP-09 — intelligence router

Route independently by primitive and eval profile:

```text
decide(choice, cardinality=6, reliability>=X)
generate(report-summary, budget=Y)
reason(exploratory-analysis, max_rounds=Z)
```

Do not route an entire workflow to a provider.

### GP-10 — shadow providers and calibration

Allow non-authoritative decision providers to receive identical bounded requests.

Shadow providers:

- cannot affect control flow;
- cannot execute capabilities;
- cannot alter approval state;
- cannot write business state;
- are separately budgeted and recorded.

This is the Jev/System-One evaluation seam.

### GP-11 — migrate known ERP programs

For each workflow:

1. define explicit program graph;
2. use deterministic code when semantics are known;
3. use `DecisionStep` for bounded uncertainty;
4. use `CapabilityStep` for execution;
5. use `GenerationStep` for synthesis;
6. use `ReasoningStep` only for genuine open-ended escalation;
7. keep all authorization/evidence/budget gates in shared runtime services.

### GP-12 — Jev admission

When Jev API access/stability is sufficient:

- implement `JevDecisionProvider` only;
- start in shadow mode;
- compare calibration, accuracy, latency and cost against LLM decision adapters;
- admit only decision classes that pass normal eval gates;
- never add Jev-specific ERP semantics or workflow branches.

## Explicit non-goals

- deleting the current loop before migration parity;
- replacing STDB business logic with model decisions;
- replacing Casbin with confidence thresholds;
- letting reasoning providers execute capabilities directly;
- letting providers own retries for consequential mutations;
- forcing exploratory work into static graphs;
- exposing the full capability catalog by default;
- treating provider probabilities as calibrated truth.

## Review gate

No new harness feature should add provider-specific orchestration when it can be expressed as:

```text
decide
generate
reason -> proposal
capability
verify
approval
```

No new `ReasoningStep` may directly call an ERP executor. It must return through the shared governed-runtime admission path.

Exceptions require an explicit architecture decision and evidence that the primitive set is insufficient.
