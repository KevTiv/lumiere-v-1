# Agent control plane and model-routing plan

**Status:** Proposed — future runtime plan 2026-08-20
**Tracks:** `agent-control-plane`, `model-routing`, `planner-executor`, `verification`, `artifacts`, `skills`, `small-model-ux`
**Related:** [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [scaleway-cloudflare-bootstrap-deployment-plan.md](./scaleway-cloudflare-bootstrap-deployment-plan.md)

---

## 1. Objective

Define the runtime architecture that turns generated ERP capabilities into a reliable, provider-neutral assistant experience, with particular emphasis on making smaller/cheaper models useful through strong orchestration rather than relying on one frontier model and a large prompt.

The control plane owns reasoning workflow; the application-contract IR owns stable operations and structural safety metadata.

```text
User
  ↓
Agent Control Plane
  ├── session/objective state
  ├── intent router
  ├── capability + skill discovery
  ├── model router
  ├── planner
  ├── executor
  ├── deterministic analysis engine
  ├── verifier
  ├── artifact store
  └── presentation composer
        ↓
Generated capability registry
        ↓
server auth + Casbin
        ↓
STDB / bounded durable contracts
```

---

## 2. Non-negotiable invariants

1. **The control plane never becomes an authorization source.** Every capability invocation is re-authorized server-side through Casbin with trusted actor/org context.
2. **Models never receive raw database credentials, arbitrary SQL, reducer dispatch, Object Storage credentials, or unrestricted network/filesystem access.**
3. **Planner and executor are separate concerns.** Plans are typed/validated before execution where practical.
4. **Bulk computation is deterministic by default.** Models choose goals/plans; trusted code performs filtering, aggregation, joins, statistics, and shaping.
5. **The model sees the smallest useful tool set.** Capability discovery narrows hundreds of generated operations to a task-specific subset.
6. **Model/provider choice is deployment policy, not ERP contract semantics.**
7. **Every task has bounded model/tool/token/time/data budgets.**
8. **Analytical claims are verified against structured results before presentation where practical.**
9. **Conversation transcript is not the long-term memory model.** Sessions reference compact state and durable artifacts.
10. **Specialist sub-agents are narrowly scoped workers, not unrestricted clones.**
11. **AI/provider outage degrades AI only; ordinary ERP continues operating.**

---

## 3. Agent control-plane primitives

Introduce provider-neutral runtime concepts:

```ts
interface AgentTask {
  id: AgentTaskId
  objective: string
  actorContextRef: TrustedContextRef
  budget: AgentBudget
  status: AgentTaskStatus
  activeArtifacts: readonly ArtifactRef[]
}

interface AgentPlan {
  taskId: AgentTaskId
  steps: readonly AgentPlanStep[]
  requiredCapabilities: readonly CapabilityKey[]
  reasoningClass: ReasoningClass
}

interface AgentBudget {
  maxModelCalls: number
  maxToolCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  maxDatasetRows: number
  maxDurationMs: number
}
```

The effective budget is runtime policy. IR may provide hints but must not hard-code commercial/model-provider limits.

---

## 4. Capability discovery instead of giant tool prompts

Do not expose the complete generated ERP tool registry to each model call.

Target pipeline:

```text
user objective
   ↓
intent/domain classification
   ↓
generated CapabilityIndex search
   ↓
Casbin-filtered candidates
   ↓
3–10 task-relevant tools
   ↓
planner/model context
```

Discovery may combine deterministic tags, lexical search, embeddings, and skill metadata. Security remains invocation-time authorization, not discovery filtering.

Measure:

- tool count exposed per call;
- capability discovery precision/recall;
- tokens spent describing tools;
- failed tool-selection rate.

---

## 5. Model router

Provider-neutral abstraction:

```ts
interface ModelRouter {
  resolve(policy: ModelExecutionPolicy): ModelProviderRef
}

interface ModelExecutionPolicy {
  reasoningClass: ReasoningClass
  contextClass: ContextClass
  requiresTools: boolean
  latencyClass: LatencyClass
  taskRisk: OperationRisk
}
```

Initial logical classes:

```text
Fast
  routing / classification / extraction / lightweight verification

Standard
  normal ERP questions / planning / summarization / drafting

Deep
  ambiguous multi-step analysis / research synthesis / exceptional tasks
```

Deployment config initially maps these classes to Scaleway-hosted models. Provider/model names stay outside IR so model replacement needs no contract regeneration.

The router should support escalation only when objective evidence justifies it, e.g. failed plan validation, unresolved ambiguity, or verifier failure.

---

## 6. Planner → executor → verifier loop

Canonical task loop:

```text
UNDERSTAND
    ↓
DISCOVER
    ↓
PLAN
    ↓
AUTHORIZE
    ↓
EXECUTE
    ↓
SHAPE
    ↓
VERIFY
    ↓
insufficient? ──→ bounded REPLAN
    ↓
PRESENT
```

Hard iteration limits prevent agent wandering.

Planner output should prefer typed plans over prose whenever a formal plan exists:

```ts
interface ToolPlanStep {
  capability: CapabilityKey
  input: unknown
  expectedResult: ToolResultExpectation
}
```

Execution validates schemas, capability availability, risk/confirmation requirements, admission policy, and budget before invocation.

---

## 7. Deterministic analytical execution

Use the existing `AnalysisPlan`/`AnalysisResult` foundation as the default data-analysis substrate.

Example:

```text
"Which customers are becoming payment risks?"
   ↓
planner chooses receivables + payment history
   ↓
authorized source datasets
   ↓
analysis engine
  group customer
  compare periods
  payment-delay delta
  top-N deterioration
   ↓
compact AnalysisResult
   ↓
model interpretation
```

The model should not calculate financial totals from raw rows when deterministic code can do so.

---

## 8. Verification layer

Verification should be first-class rather than relying only on another model prompt.

Start deterministic:

- output validates against declared schema;
- numeric claims map to `AnalysisResult` values;
- mentioned entity IDs/names exist in source artifacts;
- source capability/provenance is authorized;
- no result exceeds disclosure/cardinality policy;
- mutations still require normal confirmation and reducer validation.

Optionally add a cheap semantic verifier model for prose-to-evidence consistency.

Conceptual result:

```ts
interface VerificationResult {
  supported: boolean
  unsupportedClaims: readonly ClaimRef[]
  warnings: readonly VerificationWarning[]
  evidenceRefs: readonly ArtifactRef[]
}
```

Unsupported findings should be removed, qualified, or surfaced as uncertainty rather than invented.

---

## 9. Artifact-first memory

Persist useful outputs as typed artifacts instead of retaining giant chat transcripts.

Candidate artifacts:

```text
AnalysisArtifact
DatasetArtifact
PresentationArtifact
DraftDocumentArtifact
ResearchArtifact
ImportProposal
ReportArtifact
```

Each artifact should include provenance:

```ts
interface ArtifactProvenance {
  taskId: AgentTaskId
  operationIds: readonly OperationId[]
  sourceArtifacts: readonly ArtifactRef[]
  planFingerprint?: string
  createdAt: string
}
```

Session context references artifact IDs and concise summaries. Large raw data stays in its authorized server-side storage tier.

---

## 10. Session/context compiler

Maintain structured session state:

```ts
interface AgentSessionState {
  objective?: string
  activeArtifacts: readonly ArtifactRef[]
  workingFacts: readonly FactRef[]
  completedSteps: readonly CompletedStepRef[]
  summary: string
}
```

Generate each model call's context from the minimum relevant pieces rather than replaying the entire conversation.

Context compiler inputs may include:

- current task/objective;
- selected skill instructions;
- 3–10 relevant tool descriptors;
- compact artifact summaries;
- required evidence/result excerpts;
- current approval/confirmation state.

Track context size and irrelevant-context rate as product metrics.

---

## 11. Skills

Skills are reviewed workflow/reasoning compositions over generated capabilities, not generated business APIs.

Suggested package shape:

```text
skills/
  receivables-review/
    SKILL.md
    workflow.json
    validation.json
```

`SKILL.md` contains procedural guidance; `workflow.json` references stable capabilities/analysis shapes; `validation.json` defines structural expectations.

Capability IR may generate discovery metadata and compatibility hints, but skills remain system/admin/user-authored reviewed compositions.

Saved skills never retain permissions. Every step re-authorizes at runtime.

---

## 12. Specialist sub-agents

Prefer narrowly scoped specialists:

```text
AccountingAnalysisAgent
ResearchAgent
DocumentAgent
ImportMappingAgent
PresentationAgent
VerificationAgent
```

Each definition specifies:

```ts
interface SpecialistAgentPolicy {
  allowedCapabilityDomains: readonly DomainKey[]
  allowedSkills: readonly SkillId[]
  reasoningClass: ReasoningClass
  budgetProfile: AgentBudgetProfile
}
```

A specialist receives only the artifacts/data required for its delegated task. It does not inherit unrestricted parent tools.

---

## 13. User experience

The system may use several small model calls internally but present one coherent assistant experience.

For long tasks, stream structured progress events through HTTP/SSE:

```text
Understanding request…
Checking receivables…
Comparing periods…
Verifying findings…
Preparing visualization…
```

Do not expose low-level chain-of-thought. Expose task status, tool/workflow progress, approvals, artifacts, and useful intermediate results.

The UI should allow users to:

- inspect sources/artifacts;
- revise an analysis request;
- approve consequential actions;
- reuse/save a workflow as a reviewed skill candidate;
- continue work from an artifact rather than restarting chat context.

---

## 14. Initial Scaleway implementation

Deploy the control-plane runtime near the trusted backend in Paris.

```text
Cloudflare
   ↓ HTTPS/SSE
Agent API / control plane — Scaleway Paris
   ↓
Capability + skill discovery
   ↓
Casbin / STDB / analysis engine
   ↓
ModelRouter
   ↓
Scaleway Generative APIs
```

Prefer serverless/pay-per-use inference initially. Dedicated inference is an economic/runtime decision made later from measured usage.

Instrument per organization/task:

- model calls/tokens;
- model class/provider;
- capability calls;
- analysis input/output cardinality;
- latency per phase;
- retries/replans;
- verifier failures;
- estimated inference cost.

---

## 15. Phases

### ACP0 — control-plane skeleton

- [ ] define `AgentTask`, `AgentPlan`, `AgentBudget`, session state, and artifact refs;
- [ ] implement generated capability-index search + Casbin filtering;
- [ ] implement provider-neutral model router interface;
- [ ] separate planner and executor interfaces;
- [ ] enforce task/tool/model budgets;
- [ ] use deterministic analysis engine for large tabular results;
- [ ] add structured SSE task-status events.

**Exit gate:** a normal ERP analysis task can discover a small authorized tool set, plan, execute deterministic analysis, and present a verified result using a configurable small/standard model.

### ACP1 — artifact + verification foundation

- [ ] persist analysis/presentation/draft/research artifact metadata;
- [ ] build context compiler from objective + artifacts + selected tools/skills;
- [ ] add deterministic claim/evidence verification;
- [ ] measure context/token reduction against transcript/raw-result baseline;
- [ ] add bounded replan after verifier/plan failure.

### ACP2 — skills + specialists

- [ ] define reviewed skill format and registry;
- [ ] add capability/skill discovery integration;
- [ ] add one accounting specialist and one document/research specialist;
- [ ] prove delegated agents receive narrower capability sets and budgets;
- [ ] keep runtime authorization per capability step.

### ACP3 — model-quality/economics tuning

- [ ] evaluate Fast/Standard/Deep routing against representative task corpus;
- [ ] record quality, latency, token and cost metrics per class;
- [ ] add escalation rules based on objective failures rather than user-tier hardcoding;
- [ ] choose Scaleway model mapping from measured results;
- [ ] preserve provider portability.

---

## 16. Required evaluation corpus

Before declaring the harness worthwhile, maintain representative tasks such as:

- locate/explain a specific invoice/order;
- compare receivables periods;
- identify payment deterioration and produce chart intent;
- summarize a bounded audit history;
- map an uploaded dataset into a draft import proposal;
- draft a document from approved ERP context;
- research/synthesize from supplied source findings;
- propose but do not execute a consequential mutation.

Evaluate small and larger models against identical deterministic tools and evidence, measuring correctness rather than prose preference alone.

---

## 17. Explicitly deferred

- unrestricted autonomous agents;
- arbitrary model-generated code execution;
- persistent permissions inside skills;
- provider/model names in application-contract IR;
- raw transcript as canonical memory;
- direct LLM access to PG/STDB/Object Storage;
- automatic execution of financial mutations;
- autonomous skill publication from observed behavior.

---

## 18. Acceptance criteria

The control plane is successful when:

- smaller models can complete representative ERP tasks reliably because discovery, execution, analysis, verification, and memory are handled structurally;
- the model sees a bounded relevant capability set rather than the entire ERP API;
- model/provider changes require deployment configuration, not application-contract regeneration;
- task budgets prevent unbounded recursive/tool/token usage;
- large data stays server-side and reaches models through compact evidence/artifacts;
- analytical claims are tied to structured provenance/evidence;
- sessions can continue from artifacts without replaying full historical transcripts;
- specialists receive narrower capabilities than their parent task;
- Casbin/STDB remain authorization/business authorities;
- the UX presents one coherent assistant despite multi-model/sub-agent execution internally.
