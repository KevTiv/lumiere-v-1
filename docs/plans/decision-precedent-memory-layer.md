# Decision precedent and institutional memory layer

**Status:** Architecture extension to the governed-program harness
**Date:** 2026-09-17
**Related:** `governed-intelligence-program-architecture.md`, `governed-intelligence-program-migration.md`, `harness-decision-trace-replay-organizational-learning.md`

## 1. Decision

Lumiere should persist and retrieve prior governed decisions as **precedent**, not as authority.

Precedent informs a current `DecisionStep`; it never grants permission, bypasses current policy, substitutes for STDB business invariants, or silently changes a current program branch.

```text
current case
   ↓
PrecedentRetriever
   ↓
verified prior cases / corrections / outcomes / promoted patterns
   ↓
DecisionProvider
   ↓
DecisionProposal
   ↓
current policy + authorization + verification
   ↓
execution
   ↓
current outcome becomes a new immutable decision case
```

Core invariant:

```text
precedent informs
policy constrains
runtime executes
STDB/business rules remain authoritative
```

## 2. Memory model

Keep four distinct memory classes:

```text
KnowledgeMemory   -> facts, documents, policies, source passages
DecisionMemory    -> cases, crossroads, corrections, outcomes, precedent patterns
ExecutionMemory   -> program runs, capability traces, artifacts
ProceduralMemory  -> reviewed TaskRecipe problem-solving patterns
```

They may reference each other but must not collapse into one generic vector-memory store. Procedural memory is derived from reviewed observable traces/corrections; it is not raw transcript replay and is never current authority.

## 3. Canonical records

```rust
pub struct DecisionCase {
    pub id: DecisionCaseId,
    pub organization_id: OrganizationId,
    pub program: ProgramVersionRef,
    pub step_id: StepId,
    pub decision_type: DecisionType,
    pub context_fingerprint: String,
    pub facts_ref: DecisionFactsRef,
    pub candidate_set_hash: String,
    pub selected: serde_json::Value,
    pub confidence: Option<f64>,
    pub provider_attempt_ref: Option<ProviderAttemptRef>,
    pub policy_refs: Vec<PolicyRef>,
    pub precedent_refs: Vec<DecisionCaseId>,
    pub verification_ref: Option<VerificationRef>,
    pub outcome_ref: Option<OutcomeRef>,
    pub correction_of: Option<DecisionCaseId>,
    pub status: DecisionCaseStatus,
}

pub enum DecisionCaseStatus {
    Observed,
    Verified,
    Reviewed,
    Approved,
    Rejected,
    Superseded,
}
```

Corrections are append-only. Never overwrite the historical case.

## 4. Retrieval

Introduce a provider-neutral store:

```rust
#[async_trait]
pub trait PrecedentStore: Send + Sync {
    async fn retrieve(&self, query: PrecedentQuery) -> Result<Vec<PrecedentMatch>>;
    async fn record(&self, case: DecisionCase) -> Result<DecisionCaseId>;
}
```

Retrieval must be hybrid, not embedding-only. Rank by a combination of:

- exact decision type;
- organization / company scope;
- program + step compatibility;
- entity and context shape;
- material constraint match;
- semantic similarity;
- verification/outcome quality;
- human review/approval status;
- recency where relevant;
- supersession/rejection penalties.

No cross-tenant precedent leakage. Cross-organization patterns require an explicitly governed aggregate/knowledge product with privacy and authorization rules.

## 5. DecisionStep integration

A `DecisionStep` may declare precedent policy:

```rust
pub struct PrecedentPolicy {
    pub enabled: bool,
    pub max_cases: u32,
    pub minimum_status: DecisionCaseStatus,
    pub require_same_program_step: bool,
    pub include_patterns: bool,
}
```

Flow:

```text
DecisionStep
  ↓
compile current bounded decision state
  ↓
retrieve strongest admissible precedents
  ↓
compact precedent context
  ↓
DecisionProvider
  ↓
verification/admission
```

Providers receive compact facts and outcomes, not raw historical transcripts.

The context compiler may additionally retrieve reviewed TaskRecipe guidance using task type, DecisionType/version, material constraints, policy/evidence compatibility, review quality and freshness. Structural filters run before semantic similarity.

## 6. Decision patterns and graduation

Repeated stable cases may be promoted into a reviewed `DecisionPattern`:

```rust
pub struct DecisionPattern {
    pub key: DecisionPatternKey,
    pub decision_type: DecisionType,
    pub applicability: ApplicabilityRule,
    pub supporting_case_refs: Vec<DecisionCaseId>,
    pub outcome_metrics: PatternOutcomeMetrics,
    pub correction_rate: f64,
    pub status: PatternStatus,
}
```

Lifecycle:

```text
individual decisions
  ↓
verified precedent cluster
  ↓
DecisionPattern candidate
  ↓
human/eval review
  ↓
reviewed pattern
  ↓
when stable enough: deterministic branch / policy / native ERP feature
```

A repeated AI decision should graduate out of AI when deterministic semantics are justified.

### 6.1 TaskRecipe procedural memory

Repeated reviewed traces may also produce a versioned `TaskRecipe` when the reusable value is *how to approach the task* rather than a single repeated decision.

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

A recipe may guide evidence selection, checks, decision decomposition and escalation, but cannot authorize an action or override current facts/policy.

## 7. Reasoning integration

`ReasoningStep` may consume precedent summaries, but cannot mutate precedent or treat it as executable authority.

Reasoning output may reference precedents:

```text
CapabilityProposal
DecisionProposal
ProgramPatchProposal
```

The governed runtime records which precedent refs materially influenced the accepted proposal. It should likewise record which TaskRecipe refs were supplied/materially used so memory lift can be evaluated.

## 8. Events and observability

Add durable events:

```text
PrecedentQueryRequested
PrecedentMatchesReturned
PrecedentUsed
DecisionCaseRecorded
DecisionCaseCorrected
DecisionPatternProposed
DecisionPatternPromoted
DecisionPatternSuperseded
TaskRecipeProposed
TaskRecipePromoted
TaskRecipeSuperseded
UserCorrectionRecorded
LearningCandidateReviewed
```

Measure:

- precedent hit rate;
- decision correctness with/without precedent;
- provider calls/tokens saved;
- correction rate;
- approval rate;
- outcome quality;
- stale/superseded precedent usage;
- pattern graduation candidates;
- TaskRecipe hit/use rate;
- quality/correction lift with and without procedural memory;
- smaller-vs-frontier model lift under identical reviewed memory.

## 9. Safety and governance rules

1. Historical approval is never current approval.
2. Historical authorization is never current authorization.
3. Rejected/superseded cases cannot be silently treated as positive precedent.
4. Provider confidence and precedent frequency do not override policy.
5. Current facts and current policy always dominate stale precedent.
6. Corrections remain linked to originals for audit and learning.
7. Precedent retrieval is tenant-scoped by default.
8. Precedent summaries must preserve material constraints and outcome provenance.
9. Pattern promotion is reviewed and versioned.
10. Deterministic graduation must go through normal ERP/product governance.
11. Only reviewed trace/case material may be promoted into durable TaskRecipe procedural memory.
12. Provider-reported explanation and reviewer-derived interpretation retain distinct provenance.
13. User/operator corrections are append-only and never rewrite original cases or traces.
14. Current facts, policy and authorization always dominate TaskRecipe guidance.
15. Procedural memory must remain compact/versioned; raw transcripts are not reusable authority.

## 10. Acceptance criteria

The layer is admitted when:

1. `DecisionStep` can retrieve scoped prior cases before calling a provider;
2. retrieved cases are traceable to immutable prior decisions/outcomes;
3. corrections do not erase originals;
4. precedent cannot bypass authorization/policy/approval;
5. shadow/eval runs can compare decision quality with and without precedent;
6. repeated stable decisions can be proposed for pattern promotion;
7. reviewed patterns can later be converted into deterministic program/policy changes without embedding provider-specific semantics;
8. reviewed observable traces can produce versioned TaskRecipe procedural memory without storing raw transcripts as authority;
9. TaskRecipe retrieval is tenant-scoped and subordinate to current facts/policy/authorization;
10. shadow/eval runs can measure decision quality and correction lift with/without recipes and across smaller/frontier model profiles.
