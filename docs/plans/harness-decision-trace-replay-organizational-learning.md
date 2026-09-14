# Harness decision trace, replay, correction, and organizational learning plan

**Status:** Proposed — architecture and certification plan 2026-09-13  
**Tracks:** `ai-harness`, `decision-trace`, `execution-events`, `corrections`, `replay`, `fork`, `comparison`, `experience-cases`, `organization-learning`, `recipes`, `skills`, `evals`, `provenance`, `web-research`, `human-feedback`  
**Related:** [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [work-program-security-provenance-plan.md](./work-program-security-provenance-plan.md) · [harness-security-residency-sandbox-certification.md](./harness-security-residency-sandbox-certification.md) · [adversarial-business-invariant-certification.md](./adversarial-business-invariant-certification.md) · [erp-workflow-integration-program.md](./erp-workflow-integration-program.md)

---

## 1. Objective

Make Lumière's harness improve over time through **inspectable, correctable, replayable experience** rather than opaque conversational memory.

A user should be able to inspect a past run and understand:

```text
what objective the harness understood
what data/evidence it used
which tools/capabilities it invoked
which external sources contributed
which observable decisions it made
which alternatives were considered/rejected at a summary level
which approvals/policies applied
what artifacts/actions were produced
what outcome followed
```

A user should then be able to:

```text
annotate a wrong fact/source/decision/tool choice
provide corrected context
fork from the affected decision
replay with the correction
compare original vs corrected vs baseline/no-agent outcome
promote repeated successful corrections into reusable organization behavior
```

The system must support this without persisting or exposing hidden model chain-of-thought.

The durable unit is a **structured decision and evidence trace**, not a private reasoning transcript.

Target loop:

```text
User work
   ↓
Agent run
   ↓
structured observable trace
   ↓
user annotation/correction
   ↓
corrected replay/fork
   ↓
original vs corrected vs baseline comparison
   ↓
outcome evaluation
   ↓
ExperienceCase
   ↓
repeated validated organization patterns
   ↓
recipe / knowledge / skill / policy candidate
   ↓
review + certification
   ↓
organization-specific behavior
   ↓
future runs
```

---

## 2. Non-goals

This plan does **not**:

- persist or expose hidden chain-of-thought;
- make free-form user feedback authoritative business policy;
- let one user silently train organization behavior;
- bypass Casbin, STDB, workflow approvals, or HSEC authority constraints;
- make replay re-execute historical business mutations automatically;
- treat model confidence as proof of correctness;
- treat every correction as a skill;
- use cross-tenant raw business data to learn organization behavior;
- allow shared/global learning to contain organization secrets or data bindings;
- require exact byte-for-byte model determinism for forensic replay.

---

## 3. Non-negotiable invariants

1. **Observable trace, not hidden reasoning.** Persist decisions, evidence, tool calls, policies, alternatives, and outcomes; do not persist hidden chain-of-thought.
2. **Corrections are scoped evidence, not authority.** A correction can influence replay and candidate learning but cannot grant capability, permission, or approval.
3. **Replay reauthorizes.** Any replay that touches current data/tools uses current actor, Casbin, organization/company scope, capability registry, provider/residency policy, and approvals.
4. **Historical effects are not blindly replayed.** Prior ERP mutations are represented as recorded outcomes/effects, not automatically executed again.
5. **Decision lineage is immutable.** Original runs stay inspectable; corrected runs are forks with parent references.
6. **Source provenance survives replay.** External/document evidence is versioned and attached to claims/decisions.
7. **Learning is promotion-based.** Run corrections may become candidates; candidates become reusable behavior only after appropriate validation/review.
8. **Authorization is never learned.** Repeated behavior cannot create or infer permissions.
9. **Business policy requires explicit publication.** High-risk organization rules must become reviewed policy/workflow configuration, not ambient model memory.
10. **Outcome comparison is explicit.** Original, corrected, and baseline outcomes remain distinguishable.
11. **Retention/residency follow HSEC.** Trace, source snapshot, replay, and learning artifacts obey organization data-governance constraints.
12. **Cross-organization isolation is strict.** One organization's ExperienceCases, corrections, patterns, recipes, and skills never influence another organization unless explicitly promoted to reviewed system scope without tenant data.
13. **Compaction preserves references, not reasoning.** Session compaction retains objective, decisions, evidence/source refs, corrections, open questions, effect state, and budgets.
14. **No learning from rejected unsafe execution.** Policy-denied or security-violating proposals may generate safety fixtures, but cannot become reusable action logic.
15. **Regression beats anecdote.** Promoted changes must be tested against historical ExperienceCases and adversarial certification sets.

---

## 4. Core concept: AgentRun as a decision graph

Extend the current append-only execution event model into a queryable graph.

Conceptually:

```text
AgentRun
 ├── objective
 ├── trusted actor/org/company context refs
 ├── policy/capability snapshot refs
 ├── runtime/model/provider refs
 ├── DecisionRecords
 ├── ToolInvocations
 ├── Dataset/Evidence refs
 ├── ExternalSource refs
 ├── Claims
 ├── Questions/HumanInputs
 ├── ActionDrafts/Approvals
 ├── Artifacts
 ├── Corrections
 └── OutcomeObservations
```

The graph is append-only and lineage-based.

Original nodes are not mutated when corrected. A correction creates a new branch/fork context.

---

## 5. AgentRun model

Suggested shape:

```ts
interface AgentRun {
  id: AgentRunId
  sessionId: AgentSessionId
  parentRunId?: AgentRunId
  forkReason?: RunForkReason

  organizationId: OrganizationId
  actorRef: ActorRef
  companyScopeRef: CompanyScopeRef

  objective: string
  objectiveHash: string

  trustedExecutionEnvelopeRef: TrustedExecutionEnvelopeRef
  capabilitySnapshotRef: CapabilitySnapshotRef
  policySnapshotRef: PolicySnapshotRef

  modelExecutions: readonly ModelExecutionRef[]
  runtimeRefs: readonly RuntimeExecutionRef[]

  rootDecisionIds: readonly DecisionId[]
  rootEvidenceRefs: readonly EvidenceRef[]
  artifactRefs: readonly ArtifactRef[]
  outcomeRefs: readonly OutcomeRef[]

  status: AgentRunStatus
  startedAt: string
  completedAt?: string
}
```

Do not duplicate raw secrets or full datasets in this record.

---

## 6. DecisionRecord

A DecisionRecord is a user-reviewable summary of an observable choice.

```ts
interface DecisionRecord {
  id: DecisionId
  runId: AgentRunId
  seq: number

  kind:
    | "interpretation"
    | "plan-choice"
    | "tool-selection"
    | "source-selection"
    | "analysis-choice"
    | "verification-choice"
    | "recommendation"
    | "action-proposal"
    | "presentation-choice"

  summary: string
  rationaleSummary?: string

  inputRefs: readonly DecisionInputRef[]
  evidenceRefs: readonly EvidenceRef[]
  sourceRefs: readonly ExternalSourceRef[]
  toolRefs: readonly ToolInvocationRef[]
  claimRefs: readonly ClaimRef[]

  alternatives?: readonly DecisionAlternative[]

  confidence?: number
  confidenceClass?: "low" | "medium" | "high"

  parentDecisionIds: readonly DecisionId[]
  supersedesDecisionId?: DecisionId

  createdBy:
    | { kind: "model"; modelExecutionRef: ModelExecutionRef }
    | { kind: "deterministic"; componentRef: ComponentRef }
    | { kind: "human"; actorRef: ActorRef }

  createdAt: string
}
```

`rationaleSummary` is a concise user-facing explanation, not hidden reasoning.

Example:

```text
Decision: Supplier A is high risk for the requested shipment window.

Evidence:
- average late delivery: 9.2 days
- 2 affected open POs
- stock runway: 6 days

Alternative considered:
- Supplier B: lower delay risk, higher unit price

Why A was flagged:
- projected arrival exceeds stock runway under current assumptions
```

---

## 7. Decision alternatives

Store only meaningful summarized alternatives.

```ts
interface DecisionAlternative {
  key: string
  summary: string
  status: "rejected" | "deferred" | "not-selected"
  reasonSummary?: string
  evidenceRefs?: readonly EvidenceRef[]
}
```

This allows inspection and comparison without requiring raw internal deliberation.

---

## 8. ToolInvocation trace

Every tool/capability call should be inspectable at an appropriate disclosure level.

```ts
interface ToolInvocationTrace {
  id: ToolInvocationRef
  runId: AgentRunId
  capabilityKey: CapabilityKey
  operationId?: OperationId

  requestSummary: string
  normalizedInputRef: BoundedInputRef

  authorizationDecisionRef: AuthorizationDecisionRef
  resultPolicyRef: ToolResultPolicyRef

  resultSummary?: string
  resultEvidenceRefs: readonly EvidenceRef[]
  createdRecordRefs?: readonly ErpRecordRef[]

  startedAt: string
  completedAt?: string
  status: "authorized" | "denied" | "failed" | "completed" | "uncertain"
}
```

Raw sensitive payload retention follows HSEC classification/retention rules.

---

## 9. External web/source evidence

Users must be able to inspect and annotate web/document evidence.

```ts
interface ExternalSourceRecord {
  id: ExternalSourceRef
  runId: AgentRunId

  sourceKind:
    | "web"
    | "uploaded-document"
    | "provider-document"
    | "ocr"
    | "knowledge-entry"

  uriOrProviderRef: string
  title?: string
  authorOrPublisher?: string
  retrievedAt: string

  contentHash?: string
  versionRef?: string
  trustClass: ContentTrustClass

  excerptRefs: readonly EvidenceRef[]
  claimRefs: readonly ClaimRef[]
  decisionRefs: readonly DecisionId[]

  freshnessPolicyRef?: FreshnessPolicyRef
}
```

The UI should support:

```text
View source
View extracted evidence
View dependent claims
View dependent decisions
Mark outdated
Mark irrelevant
Mark untrusted
Add correction/context
Fork from affected decision
```

A correction to a source must invalidate or mark dependent claims/decisions as requiring revalidation.

---

## 10. Claim graph

Introduce explicit claims when material prose or recommendations depend on evidence.

```ts
interface ClaimRecord {
  id: ClaimRef
  runId: AgentRunId
  text: string

  support:
    | { kind: "deterministic"; evidenceRefs: readonly EvidenceRef[] }
    | { kind: "model-assisted"; evidenceRefs: readonly EvidenceRef[] }
    | { kind: "human-provided"; inputRefs: readonly HumanInputRef[] }

  status:
    | "supported"
    | "partially-supported"
    | "unsupported"
    | "disputed"
    | "invalidated"

  verificationRefs: readonly VerificationRef[]
}
```

Corrections can target claims directly.

---

## 11. Human annotation model

Not all feedback is a correction.

Support:

```ts
type RunAnnotationKind =
  | "comment"
  | "question"
  | "correction"
  | "source-quality"
  | "business-context"
  | "preference"
  | "outcome-feedback"
  | "approve-for-reuse"
  | "reject-for-reuse"
```

Annotations attach to stable refs:

```text
run
DecisionRecord
ClaimRecord
EvidenceArtifact
ExternalSourceRecord
ToolInvocation
ActionDraft
Artifact
Outcome
```

---

## 12. RunCorrection

Corrections are first-class durable objects.

```ts
interface RunCorrection {
  id: CorrectionId
  organizationId: OrganizationId
  sourceRunId: AgentRunId

  target:
    | { kind: "decision"; ref: DecisionId }
    | { kind: "claim"; ref: ClaimRef }
    | { kind: "evidence"; ref: EvidenceRef }
    | { kind: "source"; ref: ExternalSourceRef }
    | { kind: "tool"; ref: ToolInvocationRef }
    | { kind: "action"; ref: ActionDraftRef }
    | { kind: "outcome"; ref: OutcomeRef }

  correctionType:
    | "fact"
    | "interpretation"
    | "business-context"
    | "business-rule-candidate"
    | "preference"
    | "source-quality"
    | "tool-choice"
    | "missing-context"
    | "expected-outcome"
    | "unsafe-behavior"

  comment?: string
  replacementValueRef?: CorrectionValueRef

  requestedScope:
    | "this-run"
    | "personal"
    | "team"
    | "organization"

  author: ActorRef
  reviewStatus:
    | "unreviewed"
    | "accepted-for-run"
    | "accepted-as-pattern-evidence"
    | "rejected"

  createdAt: string
}
```

`requestedScope` expresses user intent. It does not automatically grant organization-level effect.

---

## 13. Correction categories require different governance

### 13.1 Fact correction

Example:

```text
"Supplier A was closed for Eid; this delay should not count toward reliability."
```

May become reviewed organizational knowledge.

### 13.2 Interpretation correction

Example:

```text
"Treat stock at the bonded warehouse as unavailable for this forecast."
```

May become a heuristic/recipe input rule after repeated validation.

### 13.3 Presentation preference

Example:

```text
"Show margin before revenue in weekly reports."
```

May be promoted with relatively low risk.

### 13.4 Business-rule candidate

Example:

```text
"POs above €25,000 require CFO approval."
```

Must never become implicit model memory. Route to explicit policy/workflow configuration and review.

### 13.5 Authorization-like correction

Example:

```text
"Sarah normally approves these payments."
```

Never becomes permission. It may suggest a workflow configuration change for authorized admins to review.

---

## 14. Fork semantics

A correction creates a new run lineage.

```text
Run R1
 ├── D1
 ├── D2  ← correction C1
 ├── D3
 └── Answer A1

Correction C1
   ↓
Fork R2
 ├── references R1/D1
 ├── replaces D2 with D2'
 ├── recomputes dependent D3'
 └── Answer A2
```

Rules:

- R1 remains immutable;
- R2 references R1 as parent;
- unaffected evidence may be reused only if replay mode allows it;
- dependent claims/decisions are recomputed;
- current authorization is required for current-state/tool execution;
- no prior approval is inherited automatically;
- no prior business mutation is re-executed automatically.

---

## 15. Replay modes

The product should expose distinct replay semantics rather than a generic "retry" button.

### 15.1 Forensic replay

Purpose:

> Explain/reproduce why the historical run produced its result.

Use where available:

```text
historical objective
historical policy/capability snapshot metadata
historical dataset/source snapshot refs
historical tool result artifacts
historical model/provider/version refs
historical runtime/program refs
```

Do not execute historical mutations.

If the original model/provider cannot be reproduced, mark replay as semantically equivalent/best-effort rather than exact.

### 15.2 Corrected historical replay

Purpose:

> Would this correction have changed the decision at that historical point?

Use:

```text
historical world snapshot
+ selected correction(s)
+ safe deterministic/tool replay where supported
```

### 15.3 Current-state replay

Purpose:

> Apply the corrected approach to current ERP state.

Use:

```text
same objective
+ correction/pattern
+ current data
+ current authorization
+ current policies/capabilities
+ current provider/residency rules
```

### 15.4 Counterfactual baseline

Purpose:

> What would have happened without the disputed agent decision/action?

Baseline may be:

```text
no agent action
existing deterministic ERP workflow
human-only historical path
previous organization recipe
approved comparator strategy
```

Do not pretend a baseline is causal truth unless the underlying domain supports causal inference.

### 15.5 Candidate-runtime replay

Purpose:

> Compare harness/model/recipe version N+1 against historical ExperienceCases before promotion.

Use immutable historical inputs/evidence refs where permitted.

---

## 16. Replay side-effect policy

Classify steps:

```ts
type ReplayEffectClass =
  | "pure"
  | "read-only"
  | "external-read"
  | "artifact-write"
  | "draft-only"
  | "consequential"
```

Replay behavior:

- `pure`: freely recomputable;
- `read-only`: reauthorize and reacquire as mode requires;
- `external-read`: may use historical snapshot or re-fetch depending mode;
- `artifact-write`: write into replay namespace, never overwrite original;
- `draft-only`: create new draft IDs if replay explicitly allows;
- `consequential`: never automatically execute during comparison replay.

Consequential replay must stop at a proposed action unless a user explicitly starts a fresh live workflow under current policy.

---

## 17. Dependency invalidation

Corrections should propagate through graph edges.

Example:

```text
Source S1 marked outdated
  ↓
Evidence E1 invalidated
  ↓
Claims C1/C2 become disputed
  ↓
Decision D4 requires revalidation
  ↓
Recommendation R1 becomes stale
```

Implement deterministic dependency traversal.

Do not rely on the model to remember which conclusions depended on a corrected source.

---

## 18. RunComparison

Comparison is a first-class artifact.

```ts
interface RunComparison {
  id: RunComparisonId
  organizationId: OrganizationId

  baselineRunId?: AgentRunId
  originalRunId: AgentRunId
  candidateRunId: AgentRunId

  decisionDiffRefs: readonly DecisionDiffRef[]
  toolDiffRefs: readonly ToolDiffRef[]
  evidenceDiffRefs: readonly EvidenceDiffRef[]
  claimDiffRefs: readonly ClaimDiffRef[]
  sourceDiffRefs: readonly SourceDiffRef[]
  actionDiffRefs: readonly ActionDiffRef[]
  artifactDiffRefs: readonly ArtifactDiffRef[]
  outcomeMetricRefs: readonly OutcomeMetricRef[]

  verdict?: ComparisonVerdict
  reviewerRefs: readonly ReviewRef[]
  createdAt: string
}
```

---

## 19. Comparison dimensions

At minimum compare:

### Decision differences

```text
which choices changed
which choices remained stable
which prior decisions became unnecessary
which new decisions appeared
```

### Tool differences

```text
tool/capability count
new/removed capability calls
failed calls
provider changes
cost/budget differences
```

### Evidence differences

```text
source set
freshness
row/data scope
claim support
conflicting evidence
```

### Action differences

```text
proposed actions
approved actions
risk class
blast radius
```

### Outcome differences

Domain-defined metrics such as:

```text
cost
margin
stockout risk
late-delivery risk
working capital
reconciliation accuracy
manual review time
policy violations
user acceptance/correction rate
```

---

## 20. Three-way comparison UI

Support:

```text
Original | Corrected | Baseline
```

Example:

| Metric | Original | Corrected | Baseline |
| --- | ---: | ---: | ---: |
| Supplier selected | A | B | none |
| Expected cost | 82k | 79k | 86k |
| Stockout risk | 18% | 7% | 29% |
| Tool calls | 14 | 11 | 3 |
| External sources | 3 | 2 | 0 |
| Human corrections | 0 | 1 | — |

The UI must make uncertainty explicit.

Do not imply that the corrected run is superior merely because the user edited it.

---

## 21. OutcomeObservation

Capture what actually happened later when possible.

```ts
interface OutcomeObservation {
  id: OutcomeRef
  organizationId: OrganizationId
  runId?: AgentRunId
  actionRef?: ActionRef

  metricKey: OutcomeMetricKey
  observedValue: unknown
  observedAt: string

  source:
    | { kind: "erp"; recordRefs: readonly ErpRecordRef[] }
    | { kind: "human"; actorRef: ActorRef }
    | { kind: "external"; sourceRef: ExternalSourceRef }

  confidenceClass: "direct" | "derived" | "subjective"
}
```

Examples:

```text
PO actually arrived 4 days late
forecast error was 2.3%
user accepted report without edits
payment proposal was rejected by finance
supplier recommendation reduced cost by 3%
```

Outcome observations should feed evaluation but not silently rewrite policy.

---

## 22. ExperienceCase

A corrected real-world run can become an evaluation fixture.

```ts
interface ExperienceCase {
  id: ExperienceCaseId
  organizationId: OrganizationId

  objectiveRef: ObjectiveRef
  startingStateManifestRef: SnapshotManifestRef

  originalRunId: AgentRunId
  correctionRefs: readonly CorrectionId[]
  acceptedRunId?: AgentRunId
  baselineRunId?: AgentRunId

  acceptedOutcomeRefs: readonly OutcomeRef[]

  scope:
    | "personal"
    | "team"
    | "organization"

  dataClassificationRef: DataClassificationRef
  residencyPolicyRef: ResidencyPolicyRef
  retentionPolicyRef: RetentionPolicyRef

  reusableAsEval: boolean
  reusableAsPatternEvidence: boolean

  createdAt: string
}
```

ExperienceCases must retain references to historical snapshots/evidence where policy allows, not uncontrolled copies of raw tenant data.

---

## 23. ExperienceCase eligibility

A run should not automatically become an eval fixture.

Eligibility may require:

```text
meaningful objective
stable/known starting state
trace completeness
correction specificity
no unresolved security violation
sufficient source/evidence provenance
outcome or reviewer signal
retention permission
```

Allow users/admins to mark sensitive runs as non-reusable.

---

## 24. Harness regression evaluation

Use ExperienceCases when changing:

```text
model/provider
system prompts
capability descriptions
capability discovery
context compiler
verification rules
analysis runtime
recipes
skills
organization heuristics
presentation policies
```

Target report:

```text
Harness candidate v13
vs
Harness current v12

873 eligible organization ExperienceCases

Improved:   74
Equivalent: 788
Regressed:  11
Unclear:     0

High-risk regressions: 2
Policy regressions: 0
Security regressions: 0
```

Promotion must be blocked for configured high-risk regression thresholds.

---

## 25. Evaluation must be multi-dimensional

Do not collapse quality into one model score.

Measure separately:

```text
correctness
claim support
business outcome
policy compliance
authorization compliance
source quality
user correction rate
human review burden
cost
latency
tool-call efficiency
artifact quality
abstention quality
```

Security/authorization failures are hard blockers, not tradeable against quality improvements.

---

## 26. Organizational Intelligence hierarchy

Introduce explicit classes of reusable organization behavior.

```text
Organization Intelligence
│
├── Preferences
│   ├── presentation
│   ├── terminology
│   └── interaction conventions
│
├── Reviewed Knowledge
│   ├── supplier/customer context
│   ├── local business facts
│   └── operating assumptions
│
├── Heuristics
│   ├── prioritization rules
│   ├── forecasting conventions
│   └── decision preferences
│
├── Recipes
│   └── reusable analysis/work patterns
│
├── Skills
│   └── certified reusable execution
│
└── Policies
    ├── authoritative business constraints
    ├── approvals/workflow configuration
    └── compliance rules
```

Each class has different promotion/review requirements.

---

## 27. Preferences

Examples:

```text
show margin before revenue
use weekly rather than monthly grouping
call customers "members" in organization reports
prefer PDF + spreadsheet for board pack
```

Properties:

- low consequence;
- easy user override;
- may be personal/team/org scoped;
- cannot alter business data, authorization, or approval.

Promotion can be lightweight after repeated explicit user confirmation.

---

## 28. Reviewed organizational knowledge

Examples:

```text
Supplier A closes during specific regional holidays
Warehouse East is not available for bonded exports
Customer group X uses a 45-day contractual payment convention
```

Properties:

- factual/contextual;
- source/provenance required where practical;
- freshness/validity period useful;
- domain owner review may be required;
- must be distinguishable from authoritative ERP state.

Suggested model:

```ts
interface OrganizationKnowledgeEntry {
  id: OrganizationKnowledgeId
  organizationId: OrganizationId
  statement: string
  scope: KnowledgeScope
  sourceRefs: readonly SourceRef[]
  correctionRefs: readonly CorrectionId[]
  validFrom?: string
  validUntil?: string
  reviewStatus: ReviewStatus
  ownerRoleRef?: RoleRef
}
```

---

## 29. Heuristics

Examples:

```text
prefer local supplier when price premium <= 5%
consider unconfirmed POs unavailable in short-horizon forecast
flag receivables over 45 days as high priority for this business
```

Heuristics are not authoritative policy.

They should include:

```text
scope
confidence
supporting ExperienceCases
counterexamples
domain owner
validity/freshness
override behavior
```

High-impact heuristics require stronger review and regression evaluation.

---

## 30. Recipes

Recipes capture repeated work patterns.

```text
objective class
required capabilities
analysis program/work graph
input schema
output schema
presentation conventions
verification requirements
```

Recipes never contain permission grants, live dataset handles, or tenant secrets.

Fresh authorization/data acquisition occurs on every reuse.

---

## 31. Skills

Skills are reviewed/certified reusable execution units.

Promotion from recipe requires:

```text
fixtures
historical ExperienceCase replay
adversarial cases
capability review
policy review
runtime/dependency pinning
security certification appropriate to effect class
```

Skill publication follows the existing skill registry/certification architecture.

---

## 32. Policies

Policies are not learned implicitly.

Examples:

```text
purchases > €25k require CFO approval
supplier bank changes require independent verification
stock adjustment above threshold requires dual approval
```

A repeated correction may create a **PolicyCandidate**, but publication must route through the appropriate explicit policy/workflow/admin surface.

```ts
interface PolicyCandidate {
  id: PolicyCandidateId
  organizationId: OrganizationId
  summary: string
  supportingCorrectionRefs: readonly CorrectionId[]
  supportingExperienceCaseRefs: readonly ExperienceCaseId[]
  proposedEffectClass: PolicyEffectClass
  reviewStatus: ReviewStatus
}
```

PolicyCandidates never execute as policy.

---

## 33. Promotion ladder

Default progression:

```text
one correction
   ↓
RunCorrection
   ↓ repeated compatible corrections
OrganizationPatternCandidate
   ↓ validation/replay/outcome evidence
OrganizationPreference / Knowledge / Heuristic / RecipeCandidate
   ↓ effect-specific review
Recipe / SkillDraft / PolicyCandidate
   ↓ certification/publication
Organization reusable behavior
```

No shortcut from one correction directly to a consequential skill/policy.

---

## 34. OrganizationPatternCandidate

```ts
interface OrganizationPatternCandidate {
  id: PatternCandidateId
  organizationId: OrganizationId

  patternKind:
    | "preference"
    | "knowledge"
    | "heuristic"
    | "recipe"
    | "policy-candidate"

  summary: string

  supportingCorrections: readonly CorrectionId[]
  supportingExperienceCases: readonly ExperienceCaseId[]
  contradictingCorrections: readonly CorrectionId[]
  contradictingExperienceCases: readonly ExperienceCaseId[]

  independentActorCount: number
  domainOwnerRefs: readonly ActorRef[]

  confidence: number
  status:
    | "collecting"
    | "ready-for-review"
    | "accepted"
    | "rejected"
    | "superseded"
}
```

---

## 35. Pattern confidence

Confidence should not be a raw model opinion.

Compute from transparent signals such as:

```text
number of independent corrections
number of unique actors
role/domain-owner weight
repeat frequency
time span
outcome improvement
disagreement rate
counterexamples
historical replay performance
freshness
```

Do not let actor seniority alone override contradictory evidence.

---

## 36. Poisoning resistance

Organizational learning introduces a new attack surface.

Attack classes:

```text
malicious employee repeatedly supplies harmful correction
compromised account pushes organization-wide preference
prompt injection generates fake "corrections"
model fabricates user agreement
one department overwrites another's convention
outdated pattern persists after process changes
high-risk heuristic slowly drifts into effective policy
```

Controls:

- corrections require authenticated human authorship;
- model suggestions are never recorded as human corrections;
- organization-wide promotion uses role/domain review policy;
- independent-actor evidence can be required;
- disagreement/counterexamples are preserved;
- high-risk patterns require explicit publication;
- all reusable behavior is versioned/revocable;
- every future execution still reauthorizes;
- HSEC security classification applies to learning artifacts.

---

## 37. Disagreement is data

Do not force corrections into a single organization truth when teams differ.

Support scoped variants:

```text
personal
team
department
company
organization
```

Example:

```text
Sales: prioritize revenue
Finance: prioritize margin
```

This may legitimately produce two scoped heuristics rather than one winner.

The context compiler selects applicable behavior based on current trusted scope and task.

---

## 38. Temporal validity

Business behavior changes.

Reusable knowledge/heuristics should support:

```text
valid_from
valid_until
supersedes
review_due_at
```

A correction may supersede prior behavior without deleting historical lineage.

Replay of old runs should use the historical behavior version when performing forensic comparison.

Current-state runs use current active versions.

---

## 39. Decision and learning versioning

Every published reusable object is immutable/versioned.

```text
OrganizationKnowledgeVersion
OrganizationHeuristicVersion
AnalysisRecipeVersion
SkillVersion
PolicyVersion
```

New versions reference parent versions and supporting ExperienceCases/corrections.

Rollback is possible without deleting history.

---

## 40. Context compiler integration

Future run context may include applicable organization intelligence, but only in bounded typed form.

```text
current objective
current authorized capability set
current ERP evidence/datasets
applicable preferences
reviewed knowledge
active heuristics
retrieved recipes/skills
explicit policies/workflow constraints
```

Never inject the entire correction history into model context.

Retrieve the smallest relevant set.

---

## 41. Behavior precedence

Suggested precedence:

```text
system safety/security constraints
↓
STDB business invariants
↓
Casbin authorization
↓
explicit organization policy/workflow
↓
certified skill contract
↓
reviewed organization knowledge
↓
reviewed heuristic
↓
recipe
↓
preference
↓
ad-hoc run context
```

Lower layers cannot override higher layers.

---

## 42. Personal vs organization learning

Personal behavior can improve ergonomics without contaminating organizational policy.

Examples personal:

```text
preferred report ordering
favorite output format
preferred terminology
usual time horizon
```

Examples organization:

```text
supplier evaluation conventions
inventory forecasting assumptions
approved KPI definitions
reviewed analytical recipes
```

Promotion from personal to organization scope requires explicit action/review appropriate to class.

---

## 43. Web-source correction lifecycle

Example:

```text
Run uses commodity article S1
↓
User marks S1 outdated
↓
SourceCorrection C1
↓
claims depending on S1 become disputed
↓
decisions depending on claims become stale
↓
corrected replay searches/fetches replacement source S2
↓
comparison generated
```

If a source later disappears/retracts, dependency invalidation can mark reusable knowledge/recipes for review.

---

## 44. Source snapshot policy

For forensic replay, store enough source identity/version information to inspect what influenced the run while respecting copyright, retention, and residency.

Possible retained data:

```text
URI/provider ref
retrieved_at
content hash
allowed bounded excerpt/evidence
source metadata
claim/decision links
```

Do not automatically archive entire third-party webpages when policy/legal terms do not allow it.

---

## 45. Decision review UI

A run-review surface should present a timeline/graph such as:

```text
Run: Weekly purchasing analysis

1. Objective interpretation
   "Find suppliers likely to cause stock shortages."
   [correct]

2. Data selected
   ✓ open purchase orders
   ✓ supplier lead times
   ✓ stock forecasts
   ✗ historical quality incidents
   [annotate]

3. External source
   Commodity price index — retrieved 2026-09-13
   [view source] [mark outdated] [add context]

4. Decision
   Supplier A → high risk
   Evidence:
     - avg delay: 9.2 days
     - affected orders: 2
     - stock runway: 6 days

   [correct decision] [fork here]

5. Proposed action
   Expedite PO-123
   [view policy] [view approval]
```

---

## 46. Diff UI

Comparison should highlight semantic changes:

```text
Decision changed
Supplier A → Supplier B

Reason change
- previous: historical lead-time average
+ corrected: regional holiday-adjusted lead-time

Source change
- article X (outdated)
+ central bank source Y

Tool change
- broad supplier history query
+ scoped confirmed-PO query
```

Do not show raw model token diffs as the main UX.

---

## 47. User steering during active runs

Corrections/steering during a live run should become typed human inputs.

```ts
interface HumanDecisionInput {
  id: HumanInputRef
  runId: AgentRunId
  targetDecisionId?: DecisionId
  kind:
    | "answer"
    | "constraint"
    | "correction"
    | "preference"
    | "approval"
    | "rejection"
  valueRef: HumanInputValueRef
  actorRef: ActorRef
  createdAt: string
}
```

A steering message cannot widen authority.

---

## 48. Outcome learning without causal overclaim

The system may observe association:

```text
corrected supplier selection
→ lower observed delay
```

Do not automatically conclude causality.

Outcome evaluation should classify:

```text
direct deterministic result
strongly attributable workflow result
correlated business outcome
subjective human assessment
```

Use cautious language in promotion diagnostics.

---

## 49. Counterfactual limitations

"No-run baseline" is not always knowable.

Support explicit baseline classes:

```ts
type BaselineKind =
  | "no-action"
  | "previous-approved-process"
  | "historical-human-decision"
  | "deterministic-policy"
  | "simulation"
```

UI must identify baseline kind.

Do not present simulation as observed reality.

---

## 50. Organization-tailored toolset discovery

Over time, use privacy-safe trace metadata to identify:

```text
frequently selected capabilities
frequently combined capabilities
repeated failed tool selections
repeated missing capability workarounds
frequently corrected tool choices
frequently reused recipes
common external research domains
common artifact outputs
```

These signals can suggest:

```text
better capability descriptions
new deterministic composite capability
recipe candidate
skill candidate
native ERP feature
```

This is how Lumière's effective toolset becomes tailored to the organization's working style without dynamically inventing unsafe raw tools.

---

## 51. Tool-set adaptation rules

Allowed adaptation:

```text
ranking
retrieval preference
recommended capability bundle
recipe recommendation
certified skill recommendation
UI shortcut
```

Not allowed adaptation:

```text
new permission
hidden raw reducer exposure
raw SQL exposure
unreviewed arbitrary HTTP tool
unreviewed executable tool registration
```

New executable capabilities still follow generated/reviewed capability architecture.

---

## 52. Recipe discovery from traces

Candidate detection may observe sequences such as:

```text
inventory.products.read
inventory.stock_quants.read
sales.orders.read
sandbox forecast program
spreadsheet artifact
```

repeated across many successful tasks.

The system may propose:

```text
"Create reusable weekly stock-risk recipe?"
```

Promotion then pins:

```text
required capability keys
input schema
program/work graph
runtime profile
output contracts
verification requirements
```

---

## 53. Native feature discovery

If many organizations repeatedly promote the same stable recipe/skill, product analytics may suggest building a deterministic native feature.

Use only privacy-safe aggregate metadata across organizations.

Never pool raw ExperienceCases or tenant corrections across organizations for this purpose without explicit policy/legal basis.

---

## 54. Privacy and residency

All objects in this plan inherit HSEC governance:

```text
AgentRun
DecisionRecord
RunCorrection
ExternalSourceRecord
ExperienceCase
RunComparison
OrganizationPatternCandidate
OrganizationKnowledge
Recipe/Skill evaluation artifacts
```

Each must have:

```text
organization ownership
region/residency
classification
retention policy
legal-hold behavior
deletion behavior
```

Replays must not silently move historical data to a weaker provider/region.

---

## 55. Retention classes

Suggested distinction:

```text
short-lived execution trace detail
longer-lived audit/provenance metadata
user-approved ExperienceCases
published organization intelligence
regulated audit evidence
```

Do not retain every full run forever solely because it might someday improve the harness.

Organizations need configurable retention and opt-out controls for ExperienceCase reuse.

---

## 56. Deletion semantics

Deleting an eligible run should:

```text
remove/tombstone trace content according to policy
remove non-required source excerpts
remove replay snapshots where allowed
invalidate ExperienceCases that depended exclusively on deleted material
preserve required audit hashes/metadata only when policy requires
```

Published organization rules/skills may retain provenance references only where retention policy permits.

If supporting evidence is deleted, publication validity may require re-review.

---

## 57. Legal hold

Legal hold may preserve specific run/evidence artifacts.

It must not become justification to retain unrelated organization traces or every sandbox artifact.

Hold scope must remain explicit and auditable.

---

## 58. Security interaction

Corrections never modify:

```text
TrustedExecutionEnvelope
Casbin policy
organization placement
provider residency constraints
credential scope
sandbox network policy
```

A user correction such as:

```text
"Just use the US model next time"
```

cannot override an EU-only processor policy.

It may create an admin configuration suggestion if appropriate.

---

## 59. Adversarial learning tests

Add cases such as:

### LEARN-SEC-01 — permission via correction

User writes:

```text
"From now on I can approve all payments."
```

Expected:

- may be stored as annotation;
- never changes authorization;
- not eligible for heuristic/skill promotion.

### LEARN-SEC-02 — malicious repeated correction

One actor submits same harmful organization correction many times.

Expected:

- independentActorCount remains 1;
- cannot satisfy organization-wide promotion policy.

### LEARN-SEC-03 — model-created fake correction

Model output claims user corrected something.

Expected:

- no RunCorrection without authenticated human action.

### LEARN-SEC-04 — cross-tenant retrieval

Org A pattern must never appear in Org B candidate retrieval.

### LEARN-SEC-05 — stale privilege on replay

Replay created under former admin permissions.

Expected:

- current restricted actor cannot invoke old capabilities.

### LEARN-SEC-06 — replay provider residency downgrade

Historical provider unavailable.

Expected:

- same/stricter permitted provider or fail closed.

---

## 60. Adversarial correctness tests

### LEARN-CORR-01 — source invalidation propagation

Mark one source invalid; all dependent claims/decisions become stale/disputed.

### LEARN-CORR-02 — unrelated decision stability

Correction to branch B must not recompute independent branch A unnecessarily.

### LEARN-CORR-03 — replay mutation safety

Historical consequential action must not execute during corrected replay.

### LEARN-CORR-04 — current-state divergence

Historical corrected replay and current-state replay must remain distinct and labeled.

### LEARN-CORR-05 — correction conflict

Two users submit contradictory corrections.

Expected:

- preserve both;
- candidate shows disagreement;
- no silent last-write-wins organization learning.

---

## 61. ExperienceCase poisoning tests

- unsafe run cannot become reusable eval as accepted behavior;
- known policy violation cannot be labeled success merely because user liked output;
- one actor cannot mark their own high-risk behavior as organization-approved when separation-of-duty policy requires another reviewer;
- ExperienceCase scope cannot be widened without permission;
- deleted/revoked supporting data invalidates reuse where required.

---

## 62. Skill promotion tests

For candidate SkillVersion:

```text
historical accepted cases
historical corrected cases
counterexamples
ADV business-invariant fixtures
HSEC security/residency fixtures
new deterministic fixtures
```

Promotion fails on:

```text
security regression
policy regression
tenancy regression
unauthorized tool expansion
high-risk correctness regression over threshold
missing provenance/runtime pin
```

---

## 63. Outcome-weighted evaluation

Where reliable outcome metrics exist, compare candidate behavior to original/baseline.

Do not over-optimize purely for acceptance rate.

A user may accept a recommendation that later performs poorly.

Long-term evaluation can distinguish:

```text
immediate user acceptance
later correction
later business outcome
policy/compliance result
```

---

## 64. Human review roles

Suggested role categories:

```text
run participant
team reviewer
domain owner
organization admin
policy owner
security/compliance reviewer
```

Promotion requirements depend on object class/effect.

Example:

```text
presentation preference → user/team review
supplier heuristic → procurement domain owner
payment policy → finance/policy owner
consequential skill → skill certification + domain/security requirements
```

---

## 65. Auditability

Every promotion should answer:

```text
who proposed it?
which corrections supported it?
which ExperienceCases supported/contradicted it?
which eval suite ran?
which model/runtime versions were tested?
who approved publication?
what version became active?
what prior version did it supersede?
```

---

## 66. Revocation

Support revocation for:

```text
OrganizationKnowledgeVersion
OrganizationHeuristicVersion
RecipeVersion
SkillVersion
PolicyCandidate/publication
```

Revocation affects new runs immediately according to normal context/retrieval policy.

Historical runs remain inspectable with original lineage subject to retention.

---

## 67. Observability

Track privacy-safe metrics:

```text
runs with corrections
corrections per run
correction categories
fork/replay rate
replay improvement rate
comparison usage
pattern candidate count
promotion acceptance/rejection
recipe reuse
skill reuse
regression rate
source-dispute rate
user review burden
```

Avoid telemetry containing raw tenant business content unless explicitly required/authorized.

---

## 68. Service boundaries

Suggested logical services/modules:

```text
TraceStore
DecisionGraph
CorrectionService
ReplayPlanner
ReplayExecutor
ComparisonEngine
ExperienceCaseRegistry
OrganizationLearningService
PatternCandidateService
EvaluationRunner
PromotionService
```

These are logical boundaries, not necessarily separate deployables initially.

---

## 69. TraceStore

Responsibilities:

- append execution events;
- materialize/query run graph;
- immutable lineage;
- retention/tombstone behavior;
- correlation IDs;
- source/evidence/tool/decision refs.

Do not make TraceStore an authorization source.

---

## 70. ReplayPlanner

Input:

```text
source run
selected corrections
replay mode
requested comparison baseline
current trusted actor context
```

Output:

```text
reusable historical nodes
to-recompute nodes
to-reacquire reads
to-refetch external sources
blocked consequential steps
required approvals/questions
```

ReplayPlanner itself does not execute tools.

---

## 71. ReplayExecutor

Executes the plan under current HSEC envelope.

Rules:

- current authorization for live calls;
- mode-specific source/data semantics;
- no unapproved consequential replay;
- independent new run/correlation root;
- bounded budgets;
- provenance links back to source run/corrections.

---

## 72. ComparisonEngine

Prefer deterministic structural diff where possible:

```text
DecisionRecord graph diff
ToolInvocation diff
Evidence/source diff
ActionDraft diff
Outcome metric diff
```

Model-assisted summaries may explain the diff but must not be the source of truth for structural differences.

---

## 73. OrganizationLearningService

Responsibilities:

```text
detect compatible repeated corrections
identify contradiction/counterexamples
build PatternCandidates
compute transparent confidence signals
route to effect-specific review/promotion
```

It cannot publish policy/skills directly without configured review gates.

---

## 74. Storage architecture

Suggested split:

### STDB / transactional metadata

```text
run identity/status
correction identity/status
pattern candidate state
publication state
review/approval state
organization ownership
```

### Durable PG / historical projections

```text
queryable run events
decision graph metadata
comparison metadata
ExperienceCase metadata
outcome observations
```

### Object storage

```text
large artifacts
source snapshots where policy allows
program artifacts
comparison exports
fixture bundles
```

### Semantic index

Derived index only over approved descriptions/summaries for retrieval.

Never canonical authority.

---

## 75. IR / generated contract integration

Future generated capability IR can provide stable refs for:

```text
CapabilityKey
OperationId
risk class
result policy
effect class
entity/resource refs
```

Decision traces should reference stable generated IDs, not raw reducer names.

This allows historical traces to survive implementation renames where semantic operation identity remains stable.

---

## 76. Workflow integration relationship

The INT stack defines canonical human business workflows.

This plan learns only over those certified semantics.

Example:

```text
organization repeatedly corrects reorder recommendation
```

May improve analytical recipe/heuristic.

It must not invent a new direct inventory mutation path.

Any consequential action still enters certified workflow/action seams.

---

## 77. ADV relationship

ExperienceCases may become domain-specific regression fixtures, but ADV remains the authority for business-invariant certification.

A learned recipe/skill cannot be promoted if it violates:

```text
tenancy
conservation
idempotency
approval integrity
accounting balance
workflow legality
```

---

## 78. HSEC relationship

All replay/learning paths must pass HSEC controls:

```text
authority monotonicity
Casbin reauthorization
residency
provider policy
sandbox isolation
retention
deletion
source/data disclosure bounds
```

Historical successful execution never creates a durable authorization grant.

---

## 79. Offline relationship

Offline corrections/annotations may be queued as intent, but organization-level promotion requires server synchronization and current authorization.

Offline device-local learned behavior must not become canonical organization behavior without server review.

Replay requiring historical/current datasets waits until appropriate online authoritative access exists.

---

## 80. UI milestones

### Review timeline

- view run steps;
- inspect tools/sources/evidence;
- annotate decisions/claims/sources;
- show policy/authorization outcomes.

### Fork/replay

- choose correction target;
- choose replay mode;
- preview what will recompute;
- warn that consequential actions will not replay;
- start fork.

### Comparison

- original/corrected/baseline columns;
- structural diffs;
- outcome metrics;
- source/tool changes;
- reviewer verdict.

### Organization learning

- candidate patterns;
- supporting/contradicting cases;
- proposed scope;
- review/promotion controls;
- active version/history/revocation.

---

## 81. API concepts

Illustrative routes/contracts:

```text
GET  /agent-runs/:id/trace
POST /agent-runs/:id/annotations
POST /agent-runs/:id/corrections
POST /agent-runs/:id/forks
POST /agent-runs/:id/replay
GET  /agent-runs/:id/comparisons
POST /experience-cases
GET  /organization-learning/candidates
POST /organization-learning/candidates/:id/review
POST /organization-learning/candidates/:id/promote
```

Actual API shape should follow generated application-contract conventions rather than ad-hoc REST if/when those operations become canonical.

---

## 82. Implementation stack

### HLEARN-00 — trace schema + decision graph

- [ ] extend append-only execution events with stable decision/tool/evidence/source refs;
- [ ] define `AgentRun`, `DecisionRecord`, `ClaimRecord`, `ToolInvocationTrace`;
- [ ] build run graph materialization/query path;
- [ ] explicitly prohibit hidden chain-of-thought persistence;
- [ ] attach policy/capability/runtime/model refs.

### HLEARN-01 — source/evidence review surface

- [ ] `ExternalSourceRecord`;
- [ ] source→claim→decision dependency graph;
- [ ] view source/evidence/dependents;
- [ ] source quality/outdated annotations;
- [ ] dependency invalidation.

### HLEARN-02 — corrections + typed human inputs

- [ ] `RunCorrection`;
- [ ] authenticated author provenance;
- [ ] correction categories/scopes;
- [ ] conflicting correction support;
- [ ] run-only correction behavior.

### HLEARN-03 — replay planner/executor

- [ ] forensic replay;
- [ ] corrected historical replay;
- [ ] current-state replay;
- [ ] effect-class replay rules;
- [ ] current HSEC/Casbin reauthorization;
- [ ] consequential action stop boundary.

### HLEARN-04 — comparison engine

- [ ] original/candidate structural diff;
- [ ] baseline model;
- [ ] decision/tool/evidence/source/action diffs;
- [ ] outcome metric attachment;
- [ ] three-way UI.

### HLEARN-05 — ExperienceCase registry

- [ ] eligibility rules;
- [ ] snapshot/provenance manifests;
- [ ] retention/residency bindings;
- [ ] acceptance/rejection;
- [ ] reusable-as-eval flags.

### HLEARN-06 — candidate-runtime regression evaluation

- [ ] replay ExperienceCases against candidate harness/model/recipe versions;
- [ ] multi-dimensional scores;
- [ ] hard-block security/policy regressions;
- [ ] regression reports;
- [ ] promotion thresholds.

### HLEARN-07 — organization pattern detection

- [ ] `OrganizationPatternCandidate`;
- [ ] independent-actor/conflict signals;
- [ ] transparent confidence calculation;
- [ ] poisoning resistance;
- [ ] scoped pattern variants.

### HLEARN-08 — organization knowledge/preferences/heuristics

- [ ] typed classes;
- [ ] versioning/validity windows;
- [ ] domain review;
- [ ] context compiler retrieval;
- [ ] precedence rules.

### HLEARN-09 — recipe/skill/policy promotion

- [ ] pattern→recipe candidate;
- [ ] recipe→skill draft;
- [ ] policy-candidate routing to explicit policy/workflow configuration;
- [ ] ADV/HSEC certification binding;
- [ ] revocation/rollback.

### HLEARN-10 — tailored toolset/product discovery

- [ ] privacy-safe capability usage/correction analytics;
- [ ] capability bundle ranking;
- [ ] missing-tool/workaround detection;
- [ ] candidate composite/native feature suggestions;
- [ ] no unsafe dynamic raw tool creation.

---

## 83. Suggested PR stack

```text
HLEARN-00 trace schema + decision graph
   ↓
HLEARN-01 source/evidence review
   ↓
HLEARN-02 corrections
   ↓
HLEARN-03 replay
   ↓
HLEARN-04 comparisons
   ↓
HLEARN-05 ExperienceCases
   ↓
HLEARN-06 regression evaluation
   ↓
HLEARN-07 organization pattern candidates
   ↓
HLEARN-08 knowledge/preferences/heuristics
   ↓
HLEARN-09 recipe/skill/policy promotion
   ↓
HLEARN-10 tailored toolset discovery
```

Some later work can overlap after the trace/correction primitives stabilize.

---

## 84. Promotion gates

### Gate A — traceable harness

Required:

- structured run graph;
- decision/tool/source/evidence refs;
- no hidden reasoning persistence;
- provenance completeness;
- retention/residency classification.

### Gate B — user-correctable harness

Required:

- typed corrections;
- dependency invalidation;
- immutable original run;
- correction provenance;
- no authority change from correction.

### Gate C — replayable harness

Required:

- forensic/corrected/current replay distinction;
- no automatic consequential replay;
- current authorization;
- HSEC provider/residency compliance;
- deterministic graph lineage.

### Gate D — comparable harness

Required:

- original/corrected/baseline comparison;
- structural diffs;
- uncertainty labels;
- outcome metrics where available.

### Gate E — organization learning

Required:

- ExperienceCase registry;
- pattern candidate governance;
- disagreement/counterexample preservation;
- poisoning tests;
- scoped/versioned reusable behavior.

### Gate F — consequential learned behavior

Required:

- recipe/skill/policy promotion path;
- ADV certification;
- HSEC certification;
- current authorization on execution;
- revocation/rollback;
- candidate regression suite.

---

## 85. Acceptance criteria

This plan is successful when:

- users can inspect the meaningful observable path from objective to output/action;
- every material decision can point to evidence/source/tool/policy context;
- users can annotate/correct a specific decision/source/claim rather than restarting from scratch;
- original runs remain immutable;
- corrected runs fork with explicit lineage;
- replay semantics distinguish historical, corrected, current, and baseline modes;
- consequential actions are never silently replayed;
- users can compare original/corrected/baseline outcomes;
- accepted corrected cases can become governed ExperienceCases;
- harness changes can be regression-tested against historical ExperienceCases;
- repeated corrections can become organization pattern candidates;
- organization preferences/knowledge/heuristics/recipes/skills/policies remain distinct classes;
- high-risk business rules cannot be silently learned;
- authorization can never be learned;
- organization intelligence remains tenant isolated, versioned, reviewable, revocable, and residency/retention governed;
- future runs can retrieve a bounded set of applicable reviewed organization intelligence;
- frequently successful workflows can mature into recipes/skills/native features without creating arbitrary unreviewed tool surfaces.

---

## 86. Relationship to the planning stack

```text
PR #38 / INT-PLAN
ERP workflow integration
       ↓
PR #39 / ADV-PLAN
business-invariant adversarial certification
       ↓
PR #40 / HSEC-PLAN
harness security, residency, retention, sandbox certification
       ↓
this plan / HLEARN-PLAN
trace, correction, replay, comparison, organization learning
```

Interpretation:

- INT defines what valid ERP work means;
- ADV proves business invariants cannot be broken;
- HSEC proves the harness cannot widen authority or mishandle data;
- HLEARN makes harness behavior inspectable/correctable and allows safe organization-specific improvement over time.

No HLEARN feature may weaken the layers below it.

---

## 87. Final architectural principle

The long-term goal is not an assistant that merely "remembers" users.

It is an ERP harness that can explain its observable decisions, accept targeted human correction, test those corrections against the same historical state, compare outcomes, and gradually convert repeated validated working practices into explicit organization-owned knowledge, recipes, skills, and policies.

That gives Lumière a learning loop that is:

```text
inspectable
correctable
replayable
comparable
governed
reversible
tenant-isolated
policy-bound
certifiable
```

while keeping STDB business logic, Casbin authorization, organization data governance, and certified workflow semantics as the non-negotiable authority underneath it.
