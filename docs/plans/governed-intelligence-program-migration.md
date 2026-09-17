# Governed intelligence program migration

**Status:** Execution companion to `governed-intelligence-program-architecture.md`
**Date:** 2026-09-17

## Purpose

Convert the already-landed bounded agent harness into a governed-program runtime without discarding the H3-H5 work.

This is a restructuring sequence, not a rewrite.

## Existing assets to retain

The following remain first-class runtime infrastructure:

- `providers/llm.rs` normalized provider transport;
- `orchestrator/agent_loop.rs` bounded reasoning loop;
- `orchestrator/invocation_policy.rs` per-call policy;
- `orchestrator/spend_admission.rs` budget/spend admission;
- `orchestrator/progress.rs` non-progress detection;
- provider attempt persistence;
- run/step event persistence;
- generated capability registry and policy filtering;
- approval/draft semantics;
- evidence/provenance and answer admission work.

## Migration rule

No existing provider or loop behavior is removed until the equivalent governed-program path is proven by fixtures/evals.

The migration direction is:

```text
existing agent loop
      ↓
extract decision seam
      ↓
route bounded decisions through DecisionProvider
      ↓
introduce GovernedProgram graph
      ↓
move known ERP flows to explicit graph
      ↓
retain agent loop as ReasoningStep
```

## Work packages

### GP-01 — decision contract

Deliver:

- `DecisionRequest`;
- `DecisionQuestion::{Choice,Score,Probability}`;
- `DecisionResponse`;
- `DecisionAnswer`;
- `DecisionProvider` trait;
- validation that option keys are unique and bounded;
- deterministic request hashing;
- redaction-safe persistence contract.

No runtime routing change yet.

### GP-02 — LLM decision adapter

Implement `LlmDecisionAdapter` over current Mistral/Gemini transport.

Requirements:

- strict schema-constrained output;
- malformed decision output fails closed;
- no direct capability execution from adapter output;
- provider confidence is optional/untrusted metadata;
- token/spend accounting uses existing admission path;
- provider attempts remain durable.

### GP-03 — decision events and verification

Persist:

```text
DecisionRequested
DecisionAnswered
DecisionVerified
DecisionEscalated
```

Bind each decision to:

- program/version;
- step id;
- input hash;
- provider/model attempt;
- selected output;
- optional distribution/confidence;
- verification outcome/reference.

### GP-04 — governed program core

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

Program execution must reuse existing:

- authorization;
- invocation policy;
- spend admission;
- approval stops;
- run state;
- evidence and artifact ownership.

Do not create a parallel policy or execution subsystem.

### GP-05 — first read-only program

Choose one production-shaped, read-only workflow already represented by reviewed generated capabilities.

Target flow:

```text
objective
  -> deterministic candidate discovery
  -> DecisionStep(choice)
  -> CapabilityStep
  -> VerificationStep
  -> DecisionStep(probability/sufficiency)
  -> GenerationStep
```

Compare against the current agent-loop route for:

- provider calls;
- tokens;
- latency;
- tool-selection failures;
- policy denials;
- final evidence coverage;
- correctness/eval outcome.

### GP-06 — intelligence router

Route by primitive and eval profile rather than provider name.

```text
decide(choice, cardinality=6, reliability>=X)
generate(report-summary, budget=Y)
reason(exploratory-analysis, max_rounds=Z)
```

Provider routing remains budget/policy constrained.

### GP-07 — shadow decision providers

Allow a non-authoritative provider to receive the same bounded decision request and record a shadow result.

Shadow providers:

- cannot change control flow;
- cannot execute tools;
- cannot alter approval state;
- cannot write business state;
- are budgeted separately;
- are visible in eval/calibration data.

This is the insertion point for Jev/System-One evaluation.

### GP-08 — migrate known ERP programs

For each migrated ERP workflow:

1. define explicit program graph;
2. retain generated capabilities as operation authority;
3. move classification/selection/sufficiency checks to `DecisionStep`;
4. keep generative synthesis in `GenerationStep`;
5. call `ReasoningStep` only when the graph genuinely cannot resolve the task;
6. retain all existing evidence/authorization/budget gates.

### GP-09 — Jev provider admission

When Jev access/API stability is sufficient:

- implement `JevDecisionProvider`;
- map only to the `DecisionProvider` contract;
- begin in shadow mode;
- measure calibration, accuracy, latency and cost against LLM adapters;
- admit only decision classes that pass the same eval gates;
- never add Jev-specific ERP semantics to programs.

## Explicit non-goals

- replacing STDB business logic with model decisions;
- replacing Casbin with confidence thresholds;
- making Jev or any LLM an authorization source;
- removing the bounded agent loop;
- forcing all workflows into static graphs;
- exposing the entire generated capability catalog to a provider;
- treating provider-reported probabilities as calibrated truth.

## Review gate

No new harness feature should introduce a provider-specific orchestration branch if it can be expressed as one of:

```text
decide
reason
generate
capability
verify
approval
```

Exceptions require an explicit architecture decision and evidence that the primitive set is insufficient.
