# Deterministic graduation execution plan

**Status:** GP-16 execution plan
**Date:** 2026-09-18
**Related:** `governed-intelligence-program-migration.md`, `decision-precedent-memory-layer.md`, `typed-decision-graph-and-run-review-plan.md`

## 1. Purpose

Deterministic graduation is the mechanism by which repeated, stable governed AI decisions stop being permanent model dependencies.

The goal is not to convert uncertain semantic judgment into brittle rules. The goal is to identify decision classes whose observed behavior has become sufficiently stable, reviewable, and structurally expressible that the same outcome can be produced by deterministic program or policy logic.

Core invariant:

```text
model decision history
      ↓
measured stability
      ↓
reviewed DecisionPattern
      ↓
deterministic shadow candidate
      ↓
conformance + outcome comparison
      ↓
reviewed promotion
      ↓
program / policy / native ERP behavior
```

A promoted deterministic implementation never gains more authority than the governed decision path it replaces. Authorization, approval, capability admission, verification, and hard stops remain unchanged.

## 2. Scope

GP-16 applies to typed `DecisionType` judgments, not free-form generation and not arbitrary reasoning transcripts.

Initial graduation targets:

- `Choice` decisions with a bounded candidate set;
- thresholdable `Score` decisions where disposition is already program-owned;
- thresholdable `Probability` decisions where calibration and gate policy are explicit;
- repeated program branch decisions with stable material constraints.

Do not graduate:

- open-ended `ReasoningStep` output;
- decisions with material unresolved evidence gaps;
- decisions whose candidate vocabulary changes frequently;
- decisions whose apparent stability is caused by narrow or biased traffic;
- decisions where policy or authorization is the real source of the outcome;
- decisions whose deterministic expression would duplicate STDB business logic instead of calling it.

## 3. Existing assets

Reuse the current PR #45 structures:

- `AiDecisionCase` as immutable observed decision/outcome evidence;
- `AiDecisionPattern` as the reviewed graduation lifecycle record;
- `DecisionTypeDefinition` and version as the judgment contract;
- `PrecedentStore` for case clustering and traceability;
- `ConfiguredIntelligenceRouter` and shadow recording for side-effect-free comparison;
- calibration profiles and deterministic gates;
- `RunReviewProgram` for independent post-run review;
- governed capability, verification, approval and recovery services.

No second execution or policy subsystem is introduced.

## 4. Graduation metrics

Introduce a provider-neutral `GraduationMetrics` snapshot for one decision type/version + applicability partition.

```rust
pub struct GraduationMetrics {
    pub decision_type: DecisionTypeRef,
    pub applicability_fingerprint: String,
    pub observed_cases: u64,
    pub verified_cases: u64,
    pub reviewed_cases: u64,
    pub correction_rate: f64,
    pub verified_outcome_rate: f64,
    pub provider_disagreement_rate: f64,
    pub decision_entropy: f64,
    pub precedent_consistency: f64,
    pub policy_stability_rate: f64,
    pub evidence_shape_stability: f64,
    pub candidate_set_stability: f64,
    pub average_cost_microunits: u64,
    pub average_latency_ms: u64,
}
```

Definitions:

- **correction rate:** corrected/superseded cases divided by eligible observed cases;
- **verified outcome rate:** cases with verified successful/mixed/failure outcome evidence divided by eligible cases;
- **provider disagreement:** production vs shadow disagreement over the same immutable request;
- **decision entropy:** normalized entropy of selected outcomes within the same applicability partition;
- **precedent consistency:** proportion of materially comparable reviewed cases agreeing with the dominant outcome;
- **policy stability:** proportion of cases evaluated under the same materially relevant policy/gate semantics;
- **evidence-shape stability:** similarity of required evidence keys/types and material constraints;
- **candidate-set stability:** proportion using the same bounded candidate vocabulary.

Metrics are descriptive evidence, not promotion authority.

## 5. Applicability partitioning

Never calculate stability across an entire `DecisionType` blindly.

Introduce a deterministic applicability fingerprint derived from reviewed structural dimensions only:

```text
DecisionType/version
+ program_ref / step_id where required
+ candidate_set_hash
+ material constraint schema
+ relevant policy refs/versions
+ evidence-shape version
= applicability_fingerprint
```

Do not include provider/model identity in the applicability fingerprint. Provider disagreement is measured inside the partition.

Do not use embeddings to decide whether two cases share deterministic semantics. Semantic retrieval may suggest candidates, but promotion eligibility requires structural compatibility.

## 6. Candidate discovery

Add a `GraduationAnalyzer` service:

```rust
#[async_trait]
pub trait GraduationAnalyzer: Send + Sync {
    async fn analyze(
        &self,
        query: GraduationQuery,
    ) -> Result<Vec<GraduationCandidate>>;
}
```

A candidate must include:

- decision type/version;
- applicability fingerprint;
- supporting case ids;
- metric snapshot;
- dominant observed output/disposition;
- policy/calibration refs;
- known corrections and counterexamples;
- proposed deterministic expression kind.

Expression kinds:

```text
ProgramBranch
ThresholdPolicy
LookupPolicy
DeterministicCompute
NativeErpRule
NotExpressible
```

Candidate discovery may be scheduled or manually invoked, but it cannot promote anything.

## 7. Eligibility policy

Create versioned `GraduationPolicy` configuration rather than hard-coding global thresholds.

Example:

```rust
pub struct GraduationPolicy {
    pub minimum_cases: u64,
    pub minimum_verified_cases: u64,
    pub maximum_correction_rate: f64,
    pub maximum_provider_disagreement_rate: f64,
    pub maximum_entropy: f64,
    pub minimum_precedent_consistency: f64,
    pub minimum_policy_stability: f64,
    pub minimum_evidence_shape_stability: f64,
    pub minimum_candidate_set_stability: f64,
    pub required_review_dispositions: Vec<String>,
    pub minimum_shadow_cases: u64,
}
```

Important: thresholds determine **candidate eligibility**, not automatic production promotion.

A candidate that crosses all thresholds becomes reviewable. Human/review governance still decides whether the semantics are actually deterministic.

## 8. DecisionPattern evolution

Keep the current lifecycle:

```text
candidate -> reviewed -> promoted -> superseded
```

Extend the durable pattern record, either directly or through an immutable versioned companion record, with:

- `decision_type_version`;
- `applicability_fingerprint`;
- `metrics_snapshot_json`;
- `graduation_policy_ref`;
- `deterministic_expression_kind`;
- `deterministic_implementation_ref`;
- `shadow_eval_ref`;
- `promoted_at`;
- `supersedes_pattern_id` where applicable.

Prefer append-only versioned evidence over rewriting historical metric snapshots.

A reviewed pattern is precedent metadata. A promoted pattern means only that a deterministic implementation has passed the promotion gate.

## 9. Deterministic implementation contract

Introduce a provider-neutral shadow evaluator:

```rust
#[async_trait]
pub trait DeterministicDecisionCandidate: Send + Sync {
    fn implementation_ref(&self) -> &str;
    fn decision_type(&self) -> DecisionTypeRef;

    async fn evaluate(
        &self,
        request: &DecisionRequest,
    ) -> Result<DeterministicDecisionResponse>;
}
```

The implementation receives the exact same bounded request snapshot as the production decision.

It cannot:

- call an LLM;
- execute a capability;
- read unversioned ambient state;
- mutate ERP state;
- alter the production answer;
- bypass DecisionType validation.

It returns only the typed decision signal.

## 10. Shadow conformance

Extend GP-15 shadowing so deterministic candidates can run beside model shadows.

```text
immutable DecisionRequest
     ├── production DecisionProvider
     ├── provider shadow(s)
     └── deterministic candidate shadow
```

Persist for each deterministic shadow:

- request hash;
- pattern/version ref;
- implementation ref;
- typed output;
- exact-match / tolerance-match result;
- execution latency;
- evaluation error;
- production output;
- later verification/outcome linkage.

Comparison semantics:

- `Choice`: exact selected candidate;
- `Score`: configured absolute/relative tolerance plus same gate disposition;
- `Probability`: configured tolerance plus same calibrated gate disposition;
- consequential use: same downstream deterministic branch is required, not merely numerically close.

Shadow evaluation remains zero-authority.

## 11. Promotion gate

A pattern may move `reviewed -> promoted` only when all are true:

1. candidate met its versioned `GraduationPolicy`;
2. supporting cases remain admissible and are not materially superseded;
3. deterministic implementation is versioned and reproducible;
4. minimum shadow sample count is met;
5. shadow conformance meets the policy threshold;
6. no unresolved correction cluster indicates a missing applicability dimension;
7. independent run review shows no new defect/incident signal attributable to the deterministic candidate;
8. relevant policy/calibration versions have not materially drifted during the evaluation window;
9. a reviewer explicitly approves promotion.

Promotion is never triggered solely by frequency, cost savings, or provider agreement.

## 12. Production admission modes

Promote in stages:

```text
Candidate
  ↓
ShadowOnly
  ↓
Advisory
  ↓
DeterministicPrimaryWithModelShadow
  ↓
DeterministicOnly
```

### ShadowOnly

No production authority. Gather parity evidence.

### Advisory

The deterministic result is visible to review/eval tooling but production still uses the provider result.

### DeterministicPrimaryWithModelShadow

The deterministic implementation supplies the live typed decision. The existing model route evaluates the same request as zero-authority shadow for regression detection.

This should be the default first production mode.

### DeterministicOnly

Model shadowing may be disabled only after an additional stability window and explicit review.

High-risk decision types may permanently retain sampled model or independent review shadows.

## 13. Runtime routing

Do not encode deterministic implementations as fake model providers.

Add a decision-resolution layer above provider routing:

```text
DecisionStep
  ↓
DecisionResolutionPolicy
  ├── deterministic promoted implementation
  └── intelligence router
```

The resolution policy is versioned and chooses one of:

```rust
enum DecisionExecutionMode {
    ModelPrimary,
    DeterministicShadow,
    DeterministicPrimaryModelShadow,
    DeterministicOnly,
}
```

The existing `ConfiguredIntelligenceRouter` remains responsible only for actual intelligence-provider selection.

This preserves a clean abstraction boundary and makes a future Jev provider independent from deterministic graduation.

## 14. Drift and rollback

Every promoted deterministic pattern must be reversible.

Automatic detection may move a production mode back toward model-primary when:

- correction rate rises above policy;
- deterministic/model shadow disagreement crosses threshold;
- policy/calibration version changes materially;
- candidate vocabulary changes;
- evidence shape changes;
- RunReview defects increase;
- a pattern is superseded.

Automatic downgrade may remove deterministic authority but must not silently promote a replacement.

Rollback sequence:

```text
DeterministicOnly
 -> DeterministicPrimaryWithModelShadow
 -> ModelPrimary
```

Persist the reason and affected pattern/version.

## 15. Evals and fixtures

Each deterministic candidate requires frozen fixtures covering:

- dominant historical cases;
- corrected/superseded counterexamples;
- boundary values around thresholds;
- missing/partial evidence;
- candidate-set changes;
- policy-version changes;
- calibration-version changes;
- cross-company/tenant isolation;
- malformed request rejection.

Fixture generation can seed from DecisionCases, but reviewed fixtures must be immutable and versioned.

Required CI gate:

```text
historical fixtures
+ adversarial boundary fixtures
+ deterministic implementation
+ current DecisionType contract
= deterministic graduation conformance suite
```

A promoted implementation cannot merge when its conformance suite fails.

## 16. Observability

Add metrics/events:

```text
GraduationAnalysisCompleted
DecisionPatternEligible
DecisionPatternRejected
DeterministicShadowEvaluated
DeterministicShadowDisagreed
DecisionPatternPromoted
DecisionPatternRolledBack
DecisionPatternSuperseded
```

Track:

- model calls avoided;
- spend avoided;
- latency avoided;
- deterministic/model disagreement;
- deterministic/verified-outcome disagreement;
- correction rate before/after promotion;
- review defects before/after promotion;
- percentage of DecisionTypes with graduation candidates;
- percentage of decisions served deterministically.

Savings are observability outputs, never promotion criteria by themselves.

## 17. Security and governance invariants

1. Deterministic graduation never creates authorization.
2. Historical approval never becomes current approval.
3. A deterministic result still passes current program gates, capability admission, verification, and approval.
4. Tenant-scoped cases never produce cross-tenant deterministic rules without an explicitly governed aggregate process.
5. Provider confidence is not a graduation metric unless calibrated and converted into a program-owned disposition.
6. Pattern frequency cannot override corrections or verified bad outcomes.
7. A promoted pattern is versioned and reversible.
8. Deterministic implementations cannot perform side effects.
9. Business invariants that belong in STDB must graduate into STDB/native ERP logic, not duplicate shadow rule engines.
10. Every promotion and rollback is auditable.

## 18. Implementation sequence

**Current implementation status (PR #45):**

- **DG-01 foundation implemented:** typed metrics/candidate contracts, structural cohort fingerprinting, STDB case/event analysis, entropy/correction/outcome/evidence-shape/candidate-set metrics, provider-shadow disagreement, and spend/latency aggregation.
- **DG-02 foundation implemented:** typed validated `GraduationPolicy`, fail-closed eligibility evaluation, and optional policy persistence inside the existing immutable organization-scoped `DecisionTypeDefinition.precedent_policy_json` envelope under `graduation`. Existing definitions without the field remain backward-compatible and graduation-disabled.
- **DG-03 foundation implemented:** candidate persistence now uses typed immutable evidence envelopes inside the existing `AiDecisionPattern.applicability_json` and `outcome_metrics_json` fields, avoiding a schema/contract release. The reducer enforces DecisionType/version, company/program/step/context partition compatibility, unique supporting cases, exact metric/sample count agreement, and rejects rejected/superseded positive support.
- Graduation evidence persists the immutable DecisionType graduation-policy ref and explicit material policy refs. Current cases still lack operational policy-version refs, so `policy_stability_rate` remains intentionally `None`; missing required metrics fail eligibility rather than being inferred.
- **DG-04 implemented:** `DeterministicDecisionCandidate` and `DeterministicCandidateRegistry` provide an immutable implementation-ref registry. Candidate outputs are validated against the exact `DecisionRequest` kind/candidate domain and expose no execution/capability surface.
- **DG-05 implemented:** `DeterministicShadowEvaluator` evaluates the registered candidate against the exact production request after a model decision, compares only the typed decision signal, and persists a zero-authority `deterministic_shadow` intelligence event containing pattern ref, implementation ref, request hash, output/error, exact-match result and latency. The event is permanently marked rejected/zero-authority and is not consulted by live routing.
- **DG-06 implemented:** deterministic conformance now distinguishes exact signal equality from operational equivalence. `Choice` requires exact candidate parity; `Score`/`Probability` support absolute/relative tolerance and, when a `ThresholdGatePolicy` is supplied, require the same downstream gate disposition after the same optional calibration profile. V2 shadow evidence persists tolerance/disposition/conformant results, and `StdbConformanceAggregator` aggregates candidate-version conformance from durable shadow events.

### DG-01 — metrics foundation

- define `GraduationMetrics`, `GraduationQuery`, `GraduationCandidate`;
- compute case counts, corrections, outcomes, entropy and precedent consistency;
- join provider-shadow disagreement from durable intelligence events;
- partition strictly by decision type/version + applicability fingerprint.

### DG-02 — versioned graduation policy

- persist organization-scoped `GraduationPolicy`;
- validate threshold ranges;
- support DecisionType-specific policy refs;
- no auto-promotion.

### DG-03 — pattern evidence hardening

- extend/version `AiDecisionPattern` evidence with metric snapshot, policy ref and applicability fingerprint;
- require same DecisionType/version and compatible applicability for supporting cases;
- reject superseded/rejected support cases unless explicitly included as counterexamples.

### DG-04 — deterministic candidate interface

- add `DeterministicDecisionCandidate`;
- registry keyed by immutable implementation ref;
- validate typed output against current DecisionType.

### DG-05 — deterministic shadow recorder

- execute candidate over the exact immutable production request;
- persist comparison and later outcome linkage;
- guarantee zero side effects.

### DG-06 — conformance evaluator

- implement Choice exact comparison;
- implement Score/Probability tolerance + gate-disposition comparison;
- aggregate shadow conformance metrics by candidate version.

### DG-07 — promotion review gate

- verify graduation-policy thresholds and shadow evidence;
- require explicit reviewed transition;
- reject promotion on unresolved drift/counterexamples.

### DG-08 — decision resolution modes

- add `DecisionExecutionMode`;
- route promoted deterministic candidates before provider routing without pretending they are providers;
- start with `DeterministicPrimaryModelShadow`.

### DG-09 — rollback/drift monitor

- evaluate post-promotion disagreement, corrections, outcome quality and policy drift;
- support deterministic-authority downgrade;
- persist rollback reason.

### DG-10 — CI fixtures and graduation suite

- generate candidate fixtures from immutable cases;
- curate counterexamples/boundaries;
- require conformance for promoted implementations.

## 19. First target

Use `ReportAttentionNeed@1` only as the first instrumentation target, not as an automatic graduation candidate.

Why:

- it already runs in the first production-shaped governed graph;
- its output is typed probability;
- the graph owns the downstream routing threshold;
- it has independent review and shadow-provider infrastructure.

Before deterministic promotion, change its raw literal gate to calibrated `ThresholdPolicy`. Then collect enough real or fixture-backed cases to determine whether the judgment is genuinely deterministic. If it remains semantically uncertain, it should stay model-backed.

The first actual promoted decision should be selected by measured low entropy/correction/disagreement, not by convenience.

## 20. Acceptance criteria

GP-16 is complete when:

1. repeated decisions are partitioned into structurally compatible graduation cohorts;
2. eligibility metrics are computed from durable cases/outcomes/shadows;
3. versioned policy determines candidate eligibility without automatic promotion;
4. deterministic implementations can evaluate the exact production request with zero side effects;
5. deterministic shadows are durably compared against model decisions and later outcomes;
6. reviewed patterns cannot promote without sufficient conformance evidence;
7. production can run deterministic-primary/model-shadow mode;
8. drift can downgrade deterministic authority without deleting history;
9. promoted implementations have immutable fixtures and CI conformance;
10. authorization, approval, verification, policy and STDB business invariants remain outside the graduation mechanism.
