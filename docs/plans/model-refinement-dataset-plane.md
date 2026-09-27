# Lumière model refinement and dataset plane

**Status:** Proposed — architecture and execution plan 2026-09-13  
**Tracks:** `training-data`, `experience-cases`, `dataset-governance`, `evals`, `sft`, `preference-learning`, `reward-models`, `distillation`, `model-registry`, `shadow-evaluation`, `adapters`, `model-routing`  
**Stacks on:** `forensic-introspection-causality-layer.md`  
**Related:** `harness-decision-trace-replay-organizational-learning.md`, `harness-security-residency-sandbox-certification.md`, `adversarial-business-invariant-certification.md`, `agent-control-plane-model-routing-plan.md`, `agent-generated-erp-tool-surface-plan.md`

---

## 1. Objective

Turn Lumière's governed production experience into a controlled model-improvement system without allowing production traces, customer data, corrections, or organization-specific business knowledge to flow directly into model training.

The intended architecture is:

```text
ERP + harness runtime
      ↓
INT / ADV / HSEC / HLEARN / INTRO
      ↓
governed ExperienceCase candidates
      ↓
Training Data Gateway
      ↓
policy + consent + provenance + deletion-lineage checks
      ↓
Dataset Compiler
  ├── supervised examples
  ├── preference pairs
  ├── verifier/reward examples
  ├── adversarial negatives
  └── immutable eval fixtures
      ↓
Model Lab
  ├── capability ranker
  ├── tool selector / argument model
  ├── ERP planner
  ├── evidence verifier
  ├── response composer
  ├── SFT / LoRA
  ├── preference optimization
  ├── reward / verifier training
  └── distillation
      ↓
Model Registry
      ↓
benchmark + adversarial certification
      ↓
shadow execution
      ↓
canary promotion
      ↓
Harness ModelRouter
```

The proprietary advantage should primarily live in the **experience, evaluation, governance, semantic contracts, correction signals, and outcome feedback loop**, not in forcing organization-private facts into model weights.

---

## 2. Core principle

Production is not a training corpus.

A production run may become training material only through an explicit compilation path:

```text
production event / run
    ↓
ExperienceCase
    ↓
training eligibility decision
    ↓
redaction / abstraction / transformation
    ↓
TrainingExample
    ↓
reviewed immutable DatasetVersion
    ↓
training or evaluation job
```

There must never be a supported path equivalent to:

```text
SELECT * FROM agent_runs
→ jsonl
→ fine tune
```

---

## 3. Relationship to the existing stack

The prior planning stack provides the raw ingredients:

```text
INT
  defines valid human ERP workflows

ADV
  identifies invalid states, races, misuse and business-invariant failures

HSEC
  defines authority, data-residency, sandbox and processor boundaries

HLEARN
  records observable decisions, corrections, replay and comparison

INTRO
  provides typed causality, provenance, actor pseudonyms and forensic lineage

MLEARN
  compiles approved experience into datasets, trains candidates and promotes models
```

MLEARN must not weaken any invariant defined below it.

A model that performs better semantically but regresses tenant isolation, security policy adherence, tool safety, residency, or action correctness cannot be promoted.

---

## 4. Non-negotiable invariants

1. **No production trace is trainable by default.**
2. **Training permission is explicit and machine-enforced.**
3. **Authorization data is never learned into executable permission.**
4. **Organization-private knowledge remains retrieval/policy/recipe data by default, not model weights.**
5. **Hidden model chain-of-thought is neither required nor stored as training provenance.**
6. **Observable decisions, tool calls, evidence, corrections and outcomes may become training signals when permitted.**
7. **Every TrainingExample resolves to provenance and deletion lineage.**
8. **Every DatasetVersion is immutable and content-addressed.**
9. **Evaluation splits are protected from training contamination.**
10. **Security/tenancy/business-invariant regressions are hard promotion blockers.**
11. **Candidate models execute in shadow mode before consequential production use.**
12. **Model promotion is reversible and versioned.**
13. **Provider/base-model replacement does not invalidate accumulated Lumière semantic/eval assets.**
14. **Customer deletion or training-permission revocation remains traceable into datasets and affected model artifacts.**
15. **The first model targets should be narrow, measurable and replaceable.**

---

## 5. Training permission model

Add an explicit policy enum:

```ts
type TrainingPermission =
  | "none"
  | "eval-only"
  | "organization-private-training"
  | "deidentified-shared-training"
  | "system-owned-fixture"
```

Default policy for customer-derived production data:

```text
none
```

unless a customer/organization policy explicitly permits otherwise.

### `none`

The material may participate in runtime execution and ordinary retention but may not enter training or model-development datasets.

### `eval-only`

The case may be retained as an immutable evaluation fixture but not used for gradient updates, preference training, distillation or synthetic augmentation of training data.

### `organization-private-training`

The case may be used only for a training artifact scoped to that organization and subject to that organization's residency, retention, deletion and model-governance policy.

### `deidentified-shared-training`

The case may enter a shared Lumière dataset only after compilation removes organization-private identifiers and satisfies the configured deidentification/review gate.

### `system-owned-fixture`

Synthetic, repository-owned or public benchmark fixtures may be used across system training/evaluation according to normal platform policy.

Training permission must be inherited as a narrowing constraint. A transformation cannot upgrade `none` to `deidentified-shared-training` merely because fields were hashed.

---

## 6. Canonical TrainingExample

Introduce a first-class training artifact:

```ts
interface TrainingExample {
  id: TrainingExampleId
  version: number

  taskFamily: TrainingTaskFamily
  sourceExperienceCase: ExperienceCaseRef

  inputRef: TrainingInputRef
  expectedOutputRef: TrainingOutputRef
  alternativeOutputRefs: readonly TrainingOutputRef[]

  label: TrainingLabel
  quality: TrainingQuality

  provenanceRefs: readonly ProvenanceRef[]
  lineageRefs: readonly DataLineageRef[]

  governance: {
    trainingPermission: TrainingPermission
    sourceOrganizations: readonly OrganizationRef[]
    dataClassification: readonly DataClassification[]
    retentionPolicyRef: RetentionPolicyRef
    residencyPolicyRef: ResidencyPolicyRef
    deletionState: "active" | "affected" | "revoked"
  }

  split?: "train" | "validation" | "test"
  caseFamilyId: string

  contentHash: string
  compilerVersion: string
  createdAt: string
}
```

`TrainingExample` is not a mutable row that gets edited in place. Corrections produce a new version or a replacement lineage node.

---

## 7. Task families

Do not build one giant generic dataset. Compile task-specific examples.

Initial task families:

```ts
type TrainingTaskFamily =
  | "capability-retrieval"
  | "tool-selection"
  | "tool-arguments"
  | "workflow-planning"
  | "business-state-classification"
  | "action-proposal"
  | "evidence-selection"
  | "claim-verification"
  | "decision-ranking"
  | "response-generation"
  | "security-risk-classification"
  | "policy-denial-explanation"
```

Each family has a separate schema, metrics and promotion thresholds.

---

## 8. Capability retrieval dataset

This should be the first trainable production-facing model target.

Input:

```text
objective
current module/entity context
authorized organization/company scope
small semantic entity metadata
```

Label:

```text
relevant CapabilityKey ranking
```

Training signal can come from:

```text
capabilities discovered
capabilities actually selected
successful tool executions
rejected/hallucinated tool attempts
user corrections
successful recipes/skills
final business outcome
```

Example:

```text
Objective:
"Prepare month-end close readiness for ACME NL"

Labels:
accounting.period.read
accounting.bank_reconciliation.read
accounting.invoice.read
accounting.payment.read
accounting.fixed_asset.read
accounting.fx_revaluation.read
accounting.financial_report.generate
```

Metrics:

```text
Recall@3
Recall@5
Recall@10
Precision@K
mean reciprocal rank
unauthorized candidate rate
hallucinated capability rate
```

A dedicated capability ranker can reduce prompt size and make tool discovery more deterministic before any large reasoning model is invoked.

---

## 9. Tool-selection dataset

Input:

```text
objective
current decision state
candidate authorized tools
tool summaries
```

Label:

```text
selected capability
or
NO_TOOL / ASK / ABSTAIN
```

Do not train the model to call a tool merely because one is available.

Important negative examples include:

- no authorized capability exists;
- user asks for analysis only;
- evidence is insufficient;
- action requires human approval;
- the requested transition is invalid;
- operation would violate tenant/company scope.

---

## 10. Tool-argument dataset

The generated application-contract IR is the schema authority.

Example:

```text
User objective:
Confirm sales order SO0045

Current state:
SO0045 = Sent

Capability:
sales.confirm_order

Schema:
{
  sale_order_id: u64
}

Expected:
{
  sale_order_id: 45
}
```

Training and evaluation should require:

```text
schema-valid output
correct resource reference
no model-supplied organization authority field
no unauthorized cross-company reference
no invented fields
no positional reducer payloads
```

---

## 11. Workflow planning dataset

INT and HLEARN can produce high-quality workflow plans without storing hidden reasoning.

Input:

```text
objective
current canonical resource states
available certified workflows
allowed capabilities
required approvals
```

Expected output:

```text
bounded semantic next-step plan
```

Example:

```text
Objective:
"Finish this sale and collect payment"

State:
quotation accepted
stock available
no picking yet

Expected plan:
1. confirm sales order
2. fulfill stock picking
3. create invoice
4. post invoice
5. register payment
6. reconcile
```

The model does not author business state transitions; it selects from certified semantic operations.

---

## 12. Decision-quality / preference dataset

HLEARN three-way comparison provides direct preference examples:

```text
Original
Corrected
Baseline
```

Compile:

```ts
interface PreferenceTrainingExample {
  promptRef: TrainingInputRef
  chosenRef: TrainingOutputRef
  rejectedRef: TrainingOutputRef
  correctionRef: CorrectionRef
  outcomeComparisonRef?: RunComparisonRef
}
```

Use cases:

- recommendation quality;
- source selection;
- analysis method;
- final response style;
- tool choice;
- business interpretation.

A corrected response is not automatically globally preferred. Scope it by:

```text
personal
team
organization
system
```

and by task family/domain.

---

## 13. ADV as negative-example generator

ADV cases should compile into explicit invalid-action and invalid-state examples.

Example:

```text
State:
invoice = Posted
period = Closed

Bad proposal:
update invoice amount

Expected:
reject direct mutation
recommend reversal/credit-note path if authorized
```

Negative-example families:

```text
illegal state transitions
duplicate economic effects
over-shipment
over-return
double invoice
double reimbursement
duplicate serial use
stale approval
closed-period posting
cross-tenant references
retry amplification
outcome-unknown replay
```

These examples should feed both training and hard evaluation suites.

---

## 14. HSEC as security-label generator

HSEC fixtures can compile into security/risk training examples.

Examples:

```text
actor in org A requests org B invoice
→ DENY / tenant scope violation
```

```text
sandbox asks for unrestricted network egress
→ DENY / egress policy violation
```

```text
saved WorkProgram requests capability removed from actor role
→ DENY / current authorization wins
```

A learned model can improve detection/explanation, but it is never an authorization authority.

Casbin/STDB remain deterministic enforcement.

---

## 15. Evidence-verification dataset

Input:

```text
claim
supporting evidence refs
source metadata
```

Labels:

```text
supported
partially-supported
unsupported
stale
contradicted
requires-domain-review
```

This can train a smaller verifier model used after planner/response generation.

Evaluation should separate:

```text
numeric verification
entity/reference verification
source freshness
semantic support
business-policy correctness
```

Deterministic checks remain authoritative wherever possible.

---

## 16. Outcome-based labels

Long-term training value should come from actual business outcomes, not only thumbs-up/down.

Examples:

```text
supplier recommendation
→ PO issued
→ actual delivery
→ stockout avoided/not avoided
→ landed cost
```

```text
collections recommendation
→ follow-up performed
→ invoice paid / not paid
→ days-sales-outstanding impact
```

```text
inventory recommendation
→ replenishment executed
→ service level
→ expired stock
```

Create explicit outcome observation records:

```ts
interface ModelOutcomeObservation {
  sourceRunRef: RunRef
  decisionRef: DecisionRef
  metricKey: string
  expectedDirection: "increase" | "decrease" | "target"
  observedValue: number | string | boolean
  observationWindow: TimeRange
  confounderNotes?: string
  provenanceRefs: readonly ProvenanceRef[]
}
```

Do not automatically infer causality from correlation. Human/domain review or controlled comparison may be required before converting an outcome into a strong preference label.

---

## 17. ExperienceCase → TrainingExample compiler

Introduce a versioned compiler:

```text
ExperienceCase
      ↓
TrainingEligibilityPolicy
      ↓
PrivacyTransform
      ↓
TaskFamilyCompiler
      ↓
Validation
      ↓
TrainingExample
```

Compiler responsibilities:

1. verify TrainingPermission;
2. resolve data lineage;
3. strip non-required tenant identifiers;
4. remove credentials/secrets;
5. abstract direct customer facts where appropriate;
6. preserve semantic capability/resource identifiers;
7. preserve correction/preference relationship;
8. validate output schema;
9. assign case-family identity;
10. prevent protected eval-case leakage;
11. hash the compiled artifact;
12. retain compiler/policy versions.

---

## 18. Privacy transformation

Training compilation should use the INTRO/HSEC classification system.

Possible transforms:

```text
OMIT
PSEUDONYMIZE
GENERALIZE
TOKENIZE_ENTITY
KEEP_BOUNDED
KEEP_SYSTEM_SEMANTIC
```

Examples:

```text
"Jane Smith" → <PERSON_17>
"ACME East Africa Ltd" → <ORG_4>
actual customer email → omitted
sale_order_id 98127 → <SALE_ORDER_1>
capability key sales.confirm_order → retained
state = Sent → retained
amount €12,415.22 → retained only when task requires monetary reasoning and permission allows
```

Deidentification must be task-aware; blindly removing every amount/entity relationship can destroy the supervision signal.

---

## 19. Organization-private knowledge boundary

Do not train organization-specific facts into shared model weights.

Preferred architecture:

```text
Foundation model
      ↓
Lumière general ERP adapter/model
      ↓
optional vertical adapter
      ↓
organization runtime context
   ├── reviewed knowledge
   ├── policies
   ├── heuristics
   ├── recipes
   ├── skills
   └── current ERP data
```

Examples that should normally remain outside weights:

```text
supplier-specific preferences
employee identities
customer history
current prices
bank details
approval delegations
company-specific policy thresholds
private contractual terms
```

Weights should primarily learn reusable semantics:

```text
ERP terminology
workflow patterns
tool selection
typed argument generation
business-state reasoning
verification behavior
safe abstention
```

---

## 20. Organization-private adapters

Support later, not initially.

Requirements before enabling an organization-private adapter:

- sufficient approved training volume;
- explicit organization training policy;
- clear residency target;
- deletion/unlearning impact model;
- isolated dataset/version lineage;
- isolated adapter storage;
- no cross-org serving cache contamination;
- revocation path;
- independent benchmark improvement;
- HSEC certification.

Prefer organization context/recipes/skills over adapters until evidence shows weight-level adaptation is materially useful.

---

## 21. Vertical adapters

Vertical adapters may be more valuable earlier than per-org adapters.

Examples:

```text
agriculture
field distribution
manufacturing
professional services
retail/POS
```

Vertical adapters should be trained on deidentified/shared/system-owned examples whose business semantics generalize across tenants.

The base model router chooses:

```text
base Lumière model
+ optional certified vertical adapter
+ organization runtime context
```

---

## 22. DatasetVersion

Datasets are immutable, versioned artifacts.

```ts
interface TrainingDatasetVersion {
  id: TrainingDatasetId
  version: number
  parentRef?: TrainingDatasetVersionRef

  taskFamilies: readonly TrainingTaskFamily[]
  compilerVersion: string
  policyVersion: string
  sourceCutoff: string

  exampleManifestRef: ArtifactRef
  exampleManifestHash: string

  trainCount: number
  validationCount: number
  testCount: number

  sourcePermissionSummary: TrainingPermissionSummary
  lineageManifestRef: ArtifactRef
  residencyPolicyRef: ResidencyPolicyRef

  status: "candidate" | "approved" | "revoked"
  createdAt: string
}
```

Never use a mutable `latest.jsonl` as dataset authority.

---

## 23. Dataset manifest

The manifest should include stable TrainingExample refs/hashes rather than embedding all text directly in registry metadata.

```text
dataset version
  ├── example IDs + hashes
  ├── task family
  ├── split
  ├── case-family ID
  ├── source permission class
  ├── source lineage refs
  ├── compiler version
  └── policy version
```

Dataset materialization for a trainer is ephemeral and reproducible from the manifest.

---

## 24. Split discipline and leakage prevention

Each ExperienceCase receives a stable `case_family_id`.

All variants belong together:

```text
original run
correction
corrected replay
alternative replay
baseline
synthetic perturbations
```

A case family must never be split between train and test.

Recommended split strategies:

### Temporal

Train on older cases, evaluate on newer cases.

### Organization holdout

Hold out entire organizations for generalization evaluation where policy permits deidentified evaluation.

### Vertical holdout

Hold out an industry/vertical to test transfer.

### Scenario-family holdout

Keep all variants of an ADV/HSEC scenario out of training.

### Capability holdout

Test whether the model can infer related new capabilities from generated descriptions rather than memorize exact operation names.

---

## 25. Protected benchmark registry

Introduce:

```ts
interface BenchmarkSuiteVersion {
  key: string
  version: number
  caseRefs: readonly EvaluationCaseRef[]
  metrics: readonly MetricSpec[]
  hardGates: readonly GateSpec[]
  contentHash: string
}
```

Initial benchmark families:

```text
capability retrieval
tool selection
tool argument validity
workflow state reasoning
business-invariant safety
tenancy/security policy
stale approval
idempotency/retry
claim/evidence support
abstention
response quality
cost
latency
```

---

## 26. Hard gates vs quality metrics

Separate them.

Quality metrics may trade off within reviewed limits:

```text
answer usefulness
ranking recall
latency
cost
verbosity
```

Hard gates cannot:

```text
tenant isolation
authorization compliance
business-invariant safety
schema validity for consequential actions
residency policy
credential leakage
forbidden tool access
```

Example:

```text
candidate model improves tool accuracy 94% → 97%
BUT tenancy suite 100% → 99.9%

Result: REJECT
```

---

## 27. ModelArtifact registry

Create a model registry independent of any single provider.

```ts
interface ModelArtifact {
  id: ModelArtifactId
  kind: "base" | "adapter" | "ranker" | "verifier" | "reward" | "distilled"

  baseModelRef?: ExternalModelRef
  artifactRef: ArtifactRef
  artifactHash: string

  trainingDatasetRefs: readonly TrainingDatasetVersionRef[]
  trainingJobRef?: TrainingJobRef

  benchmarkReportRefs: readonly BenchmarkReportRef[]
  securityCertificationRef?: CertificationRef

  intendedTaskFamilies: readonly TrainingTaskFamily[]
  runtimeProfileRef: ModelRuntimeProfileRef

  status: "candidate" | "shadow" | "canary" | "production" | "revoked"
  createdAt: string
}
```

Do not identify production behavior solely by a provider string such as `model-name=...`.

---

## 28. TrainingJob

```ts
interface TrainingJob {
  id: TrainingJobId
  method:
    | "sft"
    | "lora"
    | "preference"
    | "reward"
    | "distillation"

  baseModelRef: ExternalModelRef
  datasetRefs: readonly TrainingDatasetVersionRef[]
  configRef: ArtifactRef
  codeVersion: string
  runtimeImageDigest: string
  seed: number

  startedAt?: string
  completedAt?: string
  status: "queued" | "running" | "failed" | "complete" | "revoked"

  outputModelRef?: ModelArtifactRef
  logsRef?: ArtifactRef
}
```

Training jobs must be reproducible enough to audit:

```text
base model
code commit
container digest
config
seed
dataset hashes
```

---

## 29. Training execution residency

Training is another processor of customer data and therefore falls under HSEC.

For organization-private training:

```text
organization residency policy
∩ dataset residency
∩ trainer/GPU region
∩ object storage region
∩ model artifact storage region
```

must be non-empty.

No silent fallback to another GPU region.

Shared deidentified training datasets require their own reviewed residency policy and must not retain reversible organization-specific mappings in the trainer environment.

---

## 30. Training infrastructure isolation

Training workers must not receive production database credentials.

Allowed path:

```text
DatasetVersion manifest
      ↓
Training Dataset Broker
      ↓
scoped read-only materialization
      ↓
training worker
```

Training worker:

```text
no STDB admin credentials
no PG production credentials
no broad object-store credentials
no ability to resolve org pseudonyms
no access to unrelated datasets
```

---

## 31. First model: capability ranker

Recommended first implementation target.

Why:

- supervision is relatively objective;
- low risk;
- easy to benchmark;
- can run as advisory without authority;
- reduces token/tool-schema load for larger models;
- immediately benefits every harness task.

Initial deployment:

```text
objective
→ deterministic/semantic discovery
→ ranker rescoring
→ Casbin filtered set
→ top 3–10 tools
→ planner model
```

The ranker cannot introduce tools not present in the generated/authorized candidate set.

---

## 32. Second model: tool selector / argument generator

Use certified capabilities only.

Run initially in shadow mode:

```text
production planner selects tool
candidate model selects tool
compare
```

Then advisory/canary mode.

Consequential actions still go through normal HSEC/ADV paths.

---

## 33. Third model: evidence verifier

A smaller verifier can score generated claims or candidate plans.

Input:

```text
claim / proposed action
+ bounded evidence
+ source metadata
+ canonical resource state
```

Outputs:

```text
supported / unsupported
risk class
missing evidence
recommended abstention/retrieval
```

It may complement deterministic validation but cannot override it.

---

## 34. ERP planner model

Only attempt once the capability and tool-use corpora are strong.

The planner should produce structured semantic plans:

```text
objective
→ certified workflow steps
→ capability requirements
→ approval requirements
```

It must not synthesize raw reducers, SQL, HTTP URLs or authorization scope.

---

## 35. Supervised fine-tuning pipeline

SFT corpus should prioritize:

```text
correct tool selection
correct typed arguments
workflow next-step planning
business-state explanations
evidence-grounded responses
safe refusal/abstention
```

Avoid using raw verbose production conversations when a smaller compiled example preserves the relevant signal.

---

## 36. Preference optimization pipeline

Sources:

```text
human corrections
accepted corrected replays
explicit pairwise review
outcome-supported alternatives
reviewed organizational preferences
```

Do not assume:

```text
latest answer == preferred
longer answer == better
accepted action == causally successful
```

Preference labels should retain reviewer/scope/context.

---

## 37. Reward/verifier model pipeline

Potential reward dimensions:

```text
business validity
tool validity
evidence support
policy risk
historical outcome quality
user preference alignment
cost/latency efficiency
```

Keep hard deterministic constraints outside reward optimization.

The reward model must not be able to make forbidden behavior acceptable by assigning a high score.

---

## 38. Distillation pipeline

Long-term architecture:

```text
strong teacher model
      ↓
Lumière tasks
      ↓
verified/corrected teacher outputs
      ↓
TrainingExample compiler
      ↓
student model
```

Teacher output only becomes training material after:

- tool/schema validation;
- business-invariant validation;
- evidence verification;
- policy/security checks;
- task-specific quality gate.

Distillation should target tasks where a smaller model can materially reduce cost/latency without expanding authority.

---

## 39. Synthetic augmentation

Synthetic examples may be generated from:

```text
IR schemas
workflow state machines
ADV invalid transitions
HSEC policy fixtures
parameter boundary cases
organization-neutral synthetic ERP fixtures
```

Every synthetic example is marked synthetic and retains generator/version provenance.

Do not use synthetic volume to hide poor real-world performance.

---

## 40. Shadow execution

Every candidate production-facing model should first run as shadow.

```text
production request
       ↓
production model → actual response/action
       ↓
shadow candidate → no side effect
       ↓
comparison
```

Compare:

```text
capabilities ranked
selected tool
arguments
decision
claims/evidence
action proposal
latency
cost
policy outcome
```

Shadow candidates cannot issue consequential actions.

---

## 41. RunComparison reuse

Use HLEARN's `RunComparison` as the shared comparison surface.

For model evaluation:

```text
incumbent run
candidate run
baseline/reference run
```

Diff:

```text
decisions
tools
evidence
sources
claims
actions
artifacts
outcomes
```

This avoids building a second comparison system for training.

---

## 42. Canary promotion

After shadow success:

```text
candidate
→ small internal canary
→ selected low-risk orgs/tasks
→ expanded canary
→ production
```

Canary routing must respect:

```text
organization policy
model residency
processor policy
risk class
vertical support
training/private-adapter scope
```

No organization-private adapter may be served to another organization.

---

## 43. Promotion criteria

Candidate promotion requires:

- all hard ADV/HSEC gates pass;
- benchmark regression budget satisfied;
- tool/schema error below target;
- no unauthorized capability expansion;
- evidence-support threshold satisfied;
- shadow comparison accepted;
- latency/cost within admission policy;
- model artifact provenance complete;
- rollback target available.

---

## 44. Rollback

Model routing is versioned and reversible.

```text
production model v7
candidate v8
```

If v8 causes:

```text
quality regression
security regression
provider instability
latency incident
unexpected cost
```

switch router back to v7 without changing ERP contracts, skills or workflow semantics.

---

## 45. Model-router contract

The runtime router chooses only among certified ModelArtifacts.

Conceptually:

```rust
trait ModelRouter {
    async fn select(
        &self,
        task: &ModelTask,
        envelope: &TrustedExecutionEnvelope,
    ) -> Result<ModelArtifactRef, ModelRoutingError>;
}
```

Inputs may include:

```text
task family
reasoning class
vertical
latency budget
cost budget
residency
privacy class
approved adapters
```

The model router never defines authorization.

---

## 46. Deletion lineage

This must be built before large-scale customer-derived training.

Example lineage:

```text
customer-record-812
  ↓
agent-run-55
  ↓
correction-12
  ↓
experience-case-994
  ↓
training-example-447
  ↓
dataset-v17
  ↓
adapter-v4
```

Deletion tooling must answer:

```text
Was this source used in any ExperienceCase?
Was it compiled into training?
Which DatasetVersions contain it?
Which ModelArtifacts were trained from those datasets?
Was the training permission later revoked?
```

---

## 47. Deletion responses by artifact class

### Runtime knowledge / recipes / skills

Delete or tombstone according to ordinary HSEC retention policy.

### TrainingExample not yet trained

Remove from future dataset builds and revoke affected DatasetVersion if required.

### DatasetVersion

Immutable historical manifest may need tombstone/revocation depending on policy; new training jobs cannot consume revoked versions.

### ModelArtifact already trained

Record impact explicitly.

Possible policy responses:

```text
continue serving if lawful/contractually permitted
retrain without affected data
revoke organization-private adapter
schedule unlearning/replacement
```

Do not claim weight-level deletion occurred merely because the source TrainingExample was deleted.

---

## 48. Training-data access controls

Define separate capabilities:

```text
model_training.dataset.compile
model_training.dataset.review
model_training.dataset.export
model_training.job.run
model_training.model.register
model_training.model.promote
model_training.model.rollback
model_training.private_adapter.manage
```

Organization admins do not automatically receive system-level training privileges.

Organization-private training actions remain org-scoped.

---

## 49. Auditability

Every model-development action emits INTRO events:

```text
TrainingExampleCompiled
DatasetVersionCreated
DatasetVersionApproved
TrainingJobStarted
TrainingJobCompleted
ModelArtifactRegistered
BenchmarkExecuted
ShadowComparisonCreated
ModelPromoted
ModelRolledBack
DatasetRevoked
ModelRevoked
```

Sensitive training material is referenced, not copied into general logs.

---

## 50. Data residency and retention

MLEARN participates in the HSEC data-copy inventory.

New copy classes include:

```text
compiled TrainingExample
DatasetVersion manifest
materialized trainer shard
trainer cache
checkpoint
optimizer state
adapter weights
model weights
training logs
benchmark outputs
shadow outputs
```

Each needs:

```text
region
processor
classification
retention
legal-hold policy
deletion behavior
```

---

## 51. Training artifact storage

Initial target should follow the Scaleway-centered architecture:

```text
PostgreSQL
  └─ model/dataset/job metadata + provenance

Object Storage
  ├─ dataset manifests/materializations
  ├─ model/adapters
  ├─ checkpoints
  ├─ benchmark artifacts
  └─ training configs/log bundles
```

Do not require direct bucket credentials inside training jobs; use brokered scoped access.

---

## 52. Organization learning vs model learning

Keep these distinct.

### Organization learning

```text
preferences
reviewed knowledge
heuristics
recipes
skills
policies
```

These are inspectable/reversible runtime artifacts.

### Model learning

```text
reusable ERP semantics
tool use
workflow planning
verification
response behavior
```

These are weight-level behavior changes.

Organization learning should generally precede model learning because it is easier to inspect, update, revoke and delete.

---

## 53. Pattern-candidate promotion into training

An `OrganizationPatternCandidate` is not automatically a training example.

Promotion path:

```text
repeated corrections
→ pattern candidate
→ review
→ organization heuristic/recipe/policy
→ optional deidentified TrainingExample
```

Only when the pattern is sufficiently general and training permission permits should it influence shared weights.

---

## 54. Model-specific organization behavior

Never use model weights to encode authorization such as:

```text
"Sarah may approve purchases"
```

Never use weights to encode volatile rules such as:

```text
"approval threshold = €25,000"
```

These stay in policy/workflow configuration.

Models may learn generic reasoning such as:

```text
"high-value purchase orders often require an approval workflow; inspect current policy before proposing confirmation"
```

---

## 55. Benchmark categories

### Retrieval

```text
capability recall
entity discovery
source retrieval
```

### Tooling

```text
tool selection
argument schema validity
entity reference correctness
```

### Workflow

```text
valid next-step planning
state-transition awareness
approval awareness
```

### Analysis

```text
numeric correctness
aggregation correctness
evidence use
```

### Security

```text
tenant scope
company scope
permission drift
sandbox/egress constraints
provider/residency constraints
```

### Business integrity

```text
idempotency
conservation
accounting balance
stale approval
closed-period behavior
```

### Response

```text
claim support
usefulness
clarity
abstention
```

---

## 56. Benchmark reporting

A benchmark report should expose per-gate results, not only one aggregate score.

```ts
interface BenchmarkReport {
  modelRef: ModelArtifactRef
  suiteRef: BenchmarkSuiteVersionRef

  metricResults: readonly MetricResult[]
  hardGateResults: readonly GateResult[]

  passed: boolean
  createdAt: string
}
```

Hard-gate failures make `passed=false` regardless of aggregate quality.

---

## 57. Production feedback loop

After model promotion:

```text
production runs
→ HLEARN corrections
→ INTRO causality
→ outcome observations
→ ExperienceCases
→ next dataset version
```

This is a controlled loop, not online self-training.

No model changes its own weights directly from live user interactions.

---

## 58. Online adaptation boundary

Allowed online adaptation:

```text
retrieval ranking caches
session context
organization preferences
recipe retrieval
skill selection
model routing policy
```

Not allowed as an implicit live mechanism:

```text
weight updates from individual conversations
authorization learning
silent organization adapter updates
self-generated training and promotion without review
```

---

## 59. Human review surfaces

Admin/model-development UI should support:

```text
review ExperienceCase
inspect source provenance
inspect correction
approve/reject training eligibility
compare compiled example
inspect redaction/generalization
assign task family
protect as eval case
approve dataset version
inspect benchmark diffs
promote/rollback model
```

Organization-private training review remains visible only to appropriately authorized organization actors.

---

## 60. Dataset quality controls

Reject examples with:

```text
missing provenance
ambiguous correction
unknown permission
unresolved sensitive-data classification
unsupported expected output
policy/security violations
corrupted source refs
missing compiler version
train/test collision
```

Flag for review:

```text
conflicting human corrections
uncertain outcome causality
rare high-risk workflows
heavy dependence on organization-specific facts
```

---

## 61. Deduplication

Avoid training on thousands of near-identical retries.

Deduplicate using:

```text
task-family canonicalization
input semantic hash
workflow-state signature
expected-output hash
case-family identity
```

Retain frequency metadata separately if repetition itself is useful.

---

## 62. Bias and organization dominance

Prevent one large organization from dominating shared behavior.

Track contribution distribution by:

```text
organization pseudonym
vertical
task family
workflow
language
region
```

Shared training compilation may apply caps/reweighting.

Do not expose organization identities in shared trainer inputs.

---

## 63. Language support

Training examples may preserve user language where it matters for response/tool understanding while keeping canonical capability keys unchanged.

Evaluate:

```text
English
French
Dutch
and future target languages/regions
```

Tool semantics remain language-independent.

---

## 64. Model portability

All Lumière training/eval artifacts should be provider/base-model neutral where possible.

TrainingExample should describe:

```text
input semantics
expected output semantics
schema
preference
provenance
```

not one vendor-specific chat transcript format as canonical storage.

Export adapters can materialize:

```text
OpenAI-style messages
HF chat templates
plain prompt/completion
pairwise preference records
ranker examples
```

from the canonical representation.

---

## 65. External base models

Base model candidates should be treated as replaceable dependencies.

Registry metadata should capture:

```text
model identifier
license
provider/source
parameter scale
context window
supported runtime
quantization
embedding/tokenizer refs
known restrictions
```

Do not tie ERP application contracts to one base-model vendor.

---

## 66. Train-from-scratch boundary

Do not plan foundation-model pretraining as the initial objective.

First accumulate:

```text
high-quality Lumière task datasets
correction pairs
adversarial negatives
outcome labels
tool-use examples
verifier examples
```

Then use:

```text
fine-tuning
LoRA/adapters
preference optimization
reward/verifier training
distillation
```

Only consider continued pretraining or training a small specialized foundation model after corpus size, compute economics, licensing and benchmark evidence justify it.

---

## 67. Cost accounting

Track model-development cost as first-class metadata:

```text
data compilation cost
label/review cost
GPU hours
training cost
benchmark cost
shadow inference cost
production inference delta
```

Promotion can then consider:

```text
quality gain per €
latency gain
inference-cost reduction
```

---

## 68. Reproducibility

A benchmark/training artifact should identify:

```text
code commit
compiler version
policy version
dataset hashes
model/base model
runtime image digest
seed
hyperparameters
benchmark suite version
```

This is required for forensic comparison of model behavior over time.

---

## 69. Security review of trainer code

Model-development code becomes privileged infrastructure.

Review for:

```text
data exfiltration
arbitrary network egress
credential access
untrusted dataset code execution
pickle/model artifact hazards
malicious tokenizer/config files
supply-chain dependencies
checkpoint poisoning
```

Training workers should use approved pinned runtime images and artifact verification.

---

## 70. Model artifact integrity

Hash/sign model artifacts and adapters.

At runtime verify:

```text
artifact hash
registry status
certification status
runtime compatibility
adapter scope
```

A modified/unregistered adapter must not be loadable into production serving.

---

## 71. Private adapter serving isolation

If organization-private adapters are eventually supported:

```text
request org
→ trusted organization context
→ router resolves org-approved adapter
→ serving layer verifies adapter org scope
→ adapter cache key includes immutable org-scoped adapter ID
```

Adversarially test:

```text
org A adapter never loaded for org B
cache reuse never crosses org
fallback never drops to another org adapter
```

---

## 72. No direct model authority

Even a Lumière-owned model never becomes authority.

```text
model
→ suggestion / tool proposal / action draft
→ generated capability
→ current authorization
→ business invariant
→ approval where required
→ STDB
```

Training can improve proposal quality, not bypass governance.

---

## 73. Initial implementation milestones

### MLEARN-00 — training governance

- [ ] define `TrainingPermission`;
- [ ] define inheritance/narrowing rules;
- [ ] add policy hooks to HLEARN `ExperienceCase`;
- [ ] define organization-level training policy;
- [ ] ensure default customer policy is `none`.

### MLEARN-01 — TrainingExample schema

- [ ] define `TrainingExample`;
- [ ] define task-family schemas;
- [ ] define provenance/lineage references;
- [ ] define case-family identity;
- [ ] define immutable version/hash semantics.

### MLEARN-02 — dataset compiler

- [ ] ExperienceCase eligibility checker;
- [ ] privacy transforms;
- [ ] schema validator;
- [ ] permission validator;
- [ ] compilation provenance;
- [ ] protected-eval collision detection.

### MLEARN-03 — dataset registry

- [ ] `TrainingDatasetVersion`;
- [ ] immutable manifest;
- [ ] artifact materialization;
- [ ] approval/revocation lifecycle;
- [ ] residency metadata.

### MLEARN-04 — benchmark registry

- [ ] `BenchmarkSuiteVersion`;
- [ ] hard gates vs quality metrics;
- [ ] train/test leak checks;
- [ ] ADV/HSEC fixture integration;
- [ ] baseline incumbent reports.

### MLEARN-05 — capability ranker

- [ ] compile retrieval examples;
- [ ] train/evaluate first small model;
- [ ] integrate shadow rescoring;
- [ ] measure token/cost reduction;
- [ ] preserve deterministic/Casbin candidate boundary.

### MLEARN-06 — tool selector / arguments

- [ ] compile selected-tool examples;
- [ ] compile typed argument examples;
- [ ] add NO_TOOL/ASK/ABSTAIN labels;
- [ ] shadow compare against incumbent planner;
- [ ] add schema hard gate.

### MLEARN-07 — SFT pipeline

- [ ] reproducible training job;
- [ ] pinned runtime;
- [ ] SFT/LoRA support;
- [ ] model artifact registration;
- [ ] benchmark generation.

### MLEARN-08 — preference pipeline

- [ ] HLEARN correction pairs;
- [ ] pairwise human-review surface;
- [ ] preference dataset compiler;
- [ ] organization/vertical/system scope;
- [ ] preference optimization job.

### MLEARN-09 — verifier/reward pipeline

- [ ] evidence-verification examples;
- [ ] ADV/HSEC negative examples;
- [ ] reward/verifier training;
- [ ] deterministic hard-gate boundary;
- [ ] candidate reranking integration.

### MLEARN-10 — distillation

- [ ] teacher-run capture;
- [ ] teacher verification gate;
- [ ] distillation dataset compiler;
- [ ] smaller student benchmark;
- [ ] inference cost/latency comparison.

### MLEARN-11 — model registry

- [ ] ModelArtifact lifecycle;
- [ ] hashes/signatures;
- [ ] task-family declaration;
- [ ] runtime compatibility;
- [ ] certification refs;
- [ ] revocation/rollback.

### MLEARN-12 — shadow runtime

- [ ] dual-run orchestration;
- [ ] no-effect candidate boundary;
- [ ] HLEARN RunComparison reuse;
- [ ] cost/latency measurement;
- [ ] security/business-gate diffing.

### MLEARN-13 — canary/router integration

- [ ] candidate/canary status;
- [ ] org/task/risk-aware routing;
- [ ] automatic rollback hooks;
- [ ] promotion audit events;
- [ ] residency constraints.

### MLEARN-14 — vertical adapters

- [ ] vertical dataset segmentation;
- [ ] adapter registry;
- [ ] vertical benchmark suites;
- [ ] routing hints;
- [ ] portability tests.

### MLEARN-15 — organization-private adapters

- [ ] explicit opt-in policy;
- [ ] isolated datasets;
- [ ] isolated adapter artifacts;
- [ ] org-scoped serving/cache;
- [ ] deletion/retraining policy;
- [ ] HSEC cross-org adversarial certification.

---

## 74. Proposed PR stack

```text
MLEARN-00 training governance
  ↓
MLEARN-01 TrainingExample + lineage
  ↓
MLEARN-02 compiler
  ↓
MLEARN-03 dataset registry
  ↓
MLEARN-04 benchmark registry
  ↓
MLEARN-05 capability ranker
  ↓
MLEARN-06 tool selection/arguments
  ↓
MLEARN-07 SFT/LoRA pipeline
  ↓
MLEARN-08 preference learning
  ↓
MLEARN-09 verifier/reward
  ↓
MLEARN-10 distillation
  ↓
MLEARN-11 model registry
  ↓
MLEARN-12 shadow execution
  ↓
MLEARN-13 canary/model router
  ↓
MLEARN-14 vertical adapters
  ↓
MLEARN-15 optional org-private adapters
```

---

## 75. Acceptance criteria

The model-refinement plane is ready for its first real training experiment when:

- production traces cannot enter training without explicit permission;
- TrainingExample has complete provenance and lineage;
- compiler policy is versioned and reproducible;
- dataset versions are immutable;
- protected eval/test cases cannot enter training;
- ADV/HSEC hard-gate suites are connected;
- training workers cannot access production databases/secrets;
- training residency is enforced;
- deletion impact can be traced from source → example → dataset → model;
- the first benchmark baseline is recorded for the incumbent model;
- the capability-ranker task has enough approved examples to train/evaluate.

---

## 76. Promotion gates

### Gate A — dataset plane

Required:

- permission enforcement;
- provenance;
- lineage;
- immutable versions;
- leak prevention;
- residency.

### Gate B — first internal model

Required:

- capability ranker benchmark improvement;
- zero unauthorized capability expansion;
- shadow-only deployment;
- reproducible TrainingJob.

### Gate C — tool-use model

Required:

- schema validity target;
- entity/reference correctness;
- ADV/HSEC hard gates;
- no-effect shadow certification.

### Gate D — generative planner

Required:

- certified workflow planning benchmark;
- strong abstention behavior;
- evidence/claim verification;
- action proposals remain draft-only until ordinary ERP authorization/approval.

### Gate E — production Lumière model

Required:

- full model registry + rollback;
- shadow evidence;
- canary evidence;
- no security/business regressions;
- residency/processor approval;
- cost/latency admission.

### Gate F — organization-private adapter

Required:

- explicit org opt-in;
- isolated lineage/dataset/model artifacts;
- deletion/retrain policy;
- cross-org serving/cache adversarial pass;
- measurable benefit over runtime organization context alone.

---

## 77. What not to do

Do not:

- train directly on raw production transcripts;
- treat hashed customer data as automatically safe for shared training;
- learn authorization into model weights;
- store company secrets in shared adapters;
- let a model promote itself;
- let a training job access live ERP databases;
- mix eval fixtures into training;
- promote based on one aggregate quality score;
- allow security regressions in exchange for better answer quality;
- make per-organization fine-tunes the default personalization mechanism;
- assume deletion from a dataset deletes information from already-trained weights;
- make foundation-model training from scratch an early milestone.

---

## 78. Long-term target

The intended flywheel is:

```text
real ERP work
  ↓
observable trace
  ↓
correction + outcome
  ↓
ExperienceCase
  ↓
explicit training permission
  ↓
compiled TrainingExample
  ↓
versioned dataset
  ↓
model candidate
  ↓
ADV/HSEC/eval benchmark
  ↓
shadow comparison
  ↓
canary
  ↓
production
  ↓
new real-world outcomes
```

Over time, this should allow Lumière to maintain a provider-neutral ERP-native model family that improves in:

- capability discovery;
- tool usage;
- workflow planning;
- evidence verification;
- response quality;
- business-domain reasoning;
- cost/latency efficiency;

while keeping organization-specific facts, permissions and volatile business policies in inspectable runtime systems rather than opaque shared weights.
