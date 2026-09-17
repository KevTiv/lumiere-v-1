# Governed-program plan note

The authoritative restructuring for post-H5 harness work is documented in:

- `governed-intelligence-program-architecture.md`
- `governed-intelligence-program-migration.md`
- `decision-precedent-memory-layer.md`
- `typed-decision-graph-and-run-review-plan.md`

Existing harness/control-plane/model-routing plans must be interpreted through those documents where older language assumes a generic tool-calling LLM loop is the universal runtime, provider output owns execution, uncertainty is collapsed directly into actions, or raw transcript history substitutes for governed decision memory.

The target harness shape is now:

```text
Typed DecisionGraph
  ├── deterministic Compute nodes
  ├── bounded Choice / Score / Probability nodes
  ├── parallel DecisionBatch nodes
  ├── conditional AcquireEvidence nodes
  ├── deterministic Gate / EarlyStop nodes
  ├── precedent-aware DecisionTypes
  ├── proposal-only ReasoningStep
  ├── governed Capability / Approval / Verification steps
  └── independent RunReviewProgram
```

AI supplies narrow typed judgments. Program IR and policy own composition and consequences. Repeated stable decisions are candidates for reviewed deterministic graduation rather than permanent model dependence.
