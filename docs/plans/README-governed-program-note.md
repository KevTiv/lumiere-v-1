# Governed-program plan note

The authoritative restructuring for post-H5 harness work is documented in:

- `governed-intelligence-program-architecture.md`
- `governed-intelligence-program-migration.md`
- `decision-precedent-memory-layer.md`
- `typed-decision-graph-and-run-review-plan.md`
- `intelligence-compounding-epistemic-trace.md`

Existing harness/control-plane/model-routing plans must be interpreted through those documents where older language assumes a generic tool-calling LLM loop is the universal runtime, provider output owns execution, uncertainty is collapsed directly into actions, raw transcript history substitutes for governed decision memory, or private chain-of-thought is required for useful reasoning observability.

The target harness shape is:

```text
Typed DecisionGraph
  ├── deterministic Compute nodes
  ├── versioned DecisionType nodes
  │      ├── Choice
  │      ├── Score
  │      └── Probability
  ├── parallel DecisionBatch nodes
  ├── precedent-aware bounded context
  ├── reviewed TaskRecipe procedural memory
  ├── conditional AcquireEvidence nodes
  ├── deterministic Gate / EarlyStop nodes
  ├── proposal-only ReasoningStep
  ├── governed Capability / Approval / Verification steps
  └── independent RunReviewProgram
            ↓
      EpistemicTraceGraph
            ↓
  reviewed learning / corrections
            ↓
 DecisionPattern + TaskRecipe
            ↓
 shadow evaluation / graduation
```

AI supplies narrow typed judgments. Program IR and policy own composition and consequences. Probabilistic state remains typed until explicit gates convert it into program control.

Provider-private chain-of-thought is neither required nor assumed. The harness captures provider-reported structured explanation, runtime-observed evidence/actions, user corrections and reviewer-derived findings with explicit provenance. Only reviewed learning can enter durable procedural memory.

Repeated stable decisions and procedural patterns are candidates for reviewed deterministic graduation rather than permanent model dependence.
