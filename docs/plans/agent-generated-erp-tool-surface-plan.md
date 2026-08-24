# Generated ERP agent tool surface plan

**Status:** Proposed — reasoning-first harness/tool-surface extension 2026-08-24
**Tracks:** `generated-tools`, `runtime-discovery`, `entity-introspection`, `bounded-query`, `draft-actions`, `provenance`, `agent-evals`
**Related:** [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md)

---

## 1. Goal

Make Lumiere's ERP harness follow a reasoning-first model:

```text
frontier/general reasoning model
        +
rich discoverable ERP tools
        +
deterministic authorization/scope/risk guardrails
        +
iterative observation
        +
evidence verification
```

The harness should not require a bespoke procedural skill for every useful ERP task.

The runtime must make it easy for an agent to answer:

```text
What ERP concepts exist?
How are they related?
What operations can I use?
What inputs do those operations accept?
What data/result limits apply?
What actions can only be drafted?
What evidence supports the answer?
```

The model decides how to combine those capabilities. The harness determines what is allowed.

---

## 2. Design principles

1. **Reasoning belongs to the model.** Do not encode fixed task procedures into tool metadata.
2. **Business truth belongs to STDB.** Generated tools call existing typed application operations and reducers; they do not duplicate business rules.
3. **Authority belongs to the harness/server.** Actor/org/company scope, Casbin authorization, risk/confirmation, admission, and reducer allowlists are server-derived and re-evaluated per invocation.
4. **Discovery is cheap; schemas are lazy.** Models search compact indexes first and load full schemas only for selected capabilities.
5. **Prefer domain tools over raw infrastructure.** No direct model SQL, arbitrary reducer dispatch, filesystem, credentials, or unrestricted network.
6. **Large data stays server-side.** Dataset and aggregate-first result policies avoid dumping ERP history into model context.
7. **Mutations are explicit.** Consequential actions become typed drafts before approval/execution.
8. **Every observation has provenance.** Evidence can be tied back to authoritative ERP records, artifacts, or explicitly untrusted external/user sources.
9. **Measure instead of assuming.** Representative ERP evals decide when a reviewed skill or specialist actually improves results.

---

## 3. Tool families

The generated agent-facing surface should converge on a small number of consistent tool families rather than thousands of unrelated handwritten wrappers.

### 3.1 Discovery / introspection

```text
capabilities.search
capabilities.describe
entities.search
entities.describe
entities.relationships
domains.list
domains.describe
```

These operate on generated IR metadata and are deterministic/read-only.

### 3.2 Entity/read-model query

```text
entity.get
entity.search
entity.related
entity.aggregate
```

At codegen/runtime these resolve to typed per-entity/per-read-model contracts. They are not generic database authority.

Representative conceptual requests:

```text
entity.get(
  entity="sale_order",
  id=481,
  projection=["id", "state", "partner_id"]
)

entity.related(
  entity="sale_order",
  id=481,
  relation="invoices"
)

entity.search(
  entity="account_move",
  filter={payment_state: "not_paid"},
  projection=["id", "partner_id", "amount_residual"],
  limit=50
)
```

The model-facing shape can be generic while the generated registry constrains every allowed entity, field, operator, relation, projection, and row bound.

### 3.3 Deterministic analysis

```text
analysis.filter
analysis.project
analysis.group_by
analysis.aggregate
analysis.compare_periods
analysis.top_n
analysis.histogram
analysis.timeseries
```

These operate on server-side dataset/artifact handles created by eligible ERP reads.

The model chooses analysis intent; deterministic code performs arithmetic and tabular transformation.

### 3.4 Draft actions

```text
actions.search
actions.describe
actions.draft
actions.preview
```

`actions.draft` accepts only generated draft-eligible capability keys and typed parameters.

There is no model-visible `execute_arbitrary_reducer` tool.

### 3.5 External/research capabilities

Handwritten provider tools may complement the generated ERP surface:

```text
research.search_web
research.lookup_supplier
research.exchange_rate
research.tax_reference
files.search
files.read
```

These are not generated from ERP IR unless they correspond to an actual stable application contract. They remain separately permissioned/audited capabilities.

---

## 4. Discovery flow

```text
user objective
    ↓
UNDERSTAND
    ↓
search compact domain/entity/capability indexes
    ↓
load structural entity relationships
    ↓
select 3–10 likely capabilities
    ↓
load full input/output schemas only for those capabilities
    ↓
PLAN
```

The model should be able to explore when the initial intent classifier is imperfect.

Example:

```text
"Why has SO-481 not been invoiced?"

1. search entity "sales order"
2. inspect `sale_order`
3. discover `deliveries` + `invoices` relationships
4. load get/related capabilities
5. inspect order
6. inspect delivery state
7. inspect invoices
8. verify explanation against returned ERP evidence
```

No `sales_order_not_invoiced` procedural skill is required.

---

## 5. Iterative reasoning loop

The control plane should support bounded repeated observation:

```text
DISCOVER
   ↓
PLAN
   ↓
AUTHORIZE
   ↓
EXECUTE
   ↓
OBSERVE
   ↓
finished? ── yes → VERIFY → PRESENT
   │
   no
   ↓
bounded REPLAN
```

A task retains one trusted execution context:

```ts
interface AgentExecutionContext {
  taskId: AgentTaskId
  actorContextRef: TrustedContextRef
  organizationId: OrganizationId
  companyScope: readonly CompanyId[]
  correlationId: CorrelationId
  budget: AgentBudget
}
```

Organization/company/role authority is never updated from model output.

---

## 6. Execution budgets

Use deterministic envelopes instead of prompt instructions such as "do not investigate too much".

```ts
interface AgentBudget {
  maxModelCalls: number
  maxToolCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  maxDatasetRows: number
  maxArtifactBytes: number
  maxExternalCalls: number
  maxDurationMs: number
}
```

Budget exhaustion is a typed runtime outcome and can trigger a concise partial result rather than uncontrolled recursion.

---

## 7. Authorization and capability binding

Every selected capability follows one common server pipeline:

```text
CapabilityRequested
        ↓
resolve trusted actor/org/company context
        ↓
validate generated input schema
        ↓
validate capability exists/version matches
        ↓
Casbin authorization
        ↓
risk + confirmation policy
        ↓
traffic/admission + task budget
        ↓
invoke generated application service
        ↓
STDB reducer/read-model authority
        ↓
shape result
        ↓
attach provenance
        ↓
return observation
```

Discovery filtering is UX/context optimization only. It is never treated as authorization proof.

---

## 8. Provenance model

Represent every model-visible context item with explicit provenance/trust metadata.

```ts
type ContextProvenance =
  | { kind: "erp_record"; authoritative: true; entity: EntityKey; version?: string }
  | { kind: "erp_aggregate"; authoritative: true; artifactId: ArtifactId }
  | { kind: "artifact"; authoritative: boolean; artifactId: ArtifactId }
  | { kind: "user_input"; authoritative: false }
  | { kind: "external_research"; authoritative: false; sourceRef: string }
  | { kind: "model_generated"; authoritative: false }
```

Requirements:

- preserve operation/correlation lineage;
- preserve source entity/version where practical;
- keep external/user/model content visually and structurally distinct from authoritative ERP evidence;
- do not allow untrusted content to redefine capability names, permissions, scope, system policy, or trusted runtime instructions;
- verifier can require authoritative provenance for financial/business claims.

---

## 9. Mutation behavior

Generated mutation tools should bias toward draft/preview instead of direct execution.

```text
model
  ↓
actions.search("create purchase order")
  ↓
actions.describe(purchasing.order.create.draft)
  ↓
actions.draft(...typed params...)
  ↓
policy + permission + risk validation
  ↓
AiActionDraft
  ↓
diff/preview + evidence
  ↓
required human approval / SoD
  ↓
normal ERP mutation path
```

Direct execution is only possible for explicitly classified low-risk capabilities and still passes normal server authorization/business validation. Financial/posting/permission/destructive actions remain draft/approval controlled unless a later reviewed policy explicitly changes that.

---

## 10. Avoiding tool explosion

Do not manually expose a unique handwritten agent tool for every reducer/read combination.

Prefer:

```text
IR operation + entity metadata
        ↓ codegen
stable capability descriptor
        ↓
generated adapter
```

and bounded generic families such as `entity.search` / `entity.related` whose possible arguments are determined entirely by generated registry metadata.

A new correctly annotated ERP operation should normally require:

```text
1. implement authoritative STDB/application operation
2. annotate application-contract IR metadata
3. regenerate contracts
```

and automatically update:

```text
frontend service/hook contract
offline operation contract
agent capability descriptor
discovery index
JSON schema
risk/result/provenance metadata
```

without a separate handwritten AI-tool implementation.

---

## 11. What remains handwritten

Some tool classes should remain explicit runtime/provider code because they do not derive from ERP operations:

- external web/research providers;
- document/file retrieval and processing;
- OCR;
- artifact rendering/export;
- model-provider interfaces;
- semantic retrieval providers;
- deterministic verifier implementations;
- analysis execution engine internals.

They still register through the same capability policy/execution envelope where possible.

---

## 12. Reviewed skills and specialists

Reviewed skills remain optional compositions, not the default source of task knowledge.

Use a reviewed skill only when evals show that a stable composition materially improves:

- correctness;
- latency/cost;
- regulatory consistency;
- user-specific repeatability;
- complex domain procedure where free planning repeatedly fails.

Even then, skills cannot carry permissions and every capability invocation re-authorizes normally.

Specialist agents should likewise be introduced only for measured value and receive narrower capability sets/budgets than the parent task.

---

## 13. Evaluation strategy

Create a harness-level ERP benchmark rather than only per-skill fixture tests.

Initial corpus target:

```text
100 representative tasks
  25 accounting
  20 sales/CRM
  20 inventory
  15 purchasing
  10 expenses
  10 cross-domain/research
```

Representative tasks:

```text
Why does this trial balance differ from last month?
Which customers are driving the increase in DSO?
Why has PO-812 not been billed?
Which products are likely to stock out?
Find possible duplicate supplier payments.
Explain why SO-481 has not been invoiced.
Prepare a correction draft for this invoice.
Prepare a purchase-order draft for these low-stock items.
```

Measure:

```text
task success
correct entity/capability discovery
unsupported/hallucinated capability attempts
policy denials
cross-company leakage attempts
wrong-answer rate
claim/evidence agreement
unnecessary tool calls
replan count
human correction rate
latency
tokens/cost
```

A/B at minimum:

```text
A: general reasoning + generated discovery/tools
B: reviewed procedural skill for the same task class
```

Do not promote a more prescriptive architecture without measured improvement.

---

## 14. Feedback / learn-by-doing loop

Persist successful/corrected execution traces as evaluation and retrieval material, not automatically as procedural instructions.

Capture:

```text
task objective
selected capabilities
authoritative evidence refs
artifacts/result
human correction/approval
success/failure metrics
```

Use these for:

- regression/eval fixtures;
- few-shot retrieval where appropriate;
- discovery keyword/tag improvements;
- tool-description improvements;
- verifier test cases;
- deciding whether a reviewed skill is justified.

Do not automatically convert observed sequences into `always call A → B → C` instructions.

---

## 15. Implementation phases

### TOOL0 — generated discovery primitives

- [ ] land entity/domain descriptor generation;
- [ ] generate compact capability/entity indexes;
- [ ] implement `capabilities.search/describe`;
- [ ] implement `entities.search/describe/relationships`;
- [ ] ensure full schemas are lazy-loaded only for selected capabilities;
- [ ] add Casbin-filtered candidate-set helper without treating filtering as authorization.

### TOOL1 — bounded entity read/query surface

- [ ] define queryable/filterable/projectable metadata;
- [ ] generate typed bounded query schemas;
- [ ] expose `entity.get/search/related` through generated adapters;
- [ ] pin org/company scope from trusted server context;
- [ ] enforce row/result limits;
- [ ] route large results into dataset/aggregate-first handling;
- [ ] prove arbitrary SQL is impossible through the model-facing contract.

### TOOL2 — analysis + provenance

- [ ] connect dataset handles to deterministic analysis operations;
- [ ] attach provenance envelopes to all tool results;
- [ ] distinguish authoritative ERP evidence from external/user/model content;
- [ ] verify representative claims against structured evidence;
- [ ] add provenance to action-draft previews and artifacts.

### TOOL3 — generated draft-action surface

- [ ] generate draft-action descriptors for explicitly eligible mutations;
- [ ] expose `actions.search/describe/draft/preview`;
- [ ] reuse `AiActionDraft`, reducer allowlist, permission and confirmation controls;
- [ ] bind source versions/watermarks where stale-write protection matters;
- [ ] prove no generic reducer dispatch is reachable from agent tools.

### TOOL4 — iterative control-plane integration

- [ ] support DISCOVER → PLAN → AUTHORIZE → EXECUTE → OBSERVE → bounded REPLAN;
- [ ] preserve one trusted execution context throughout the task;
- [ ] enforce tool/model/data/time/external-call budgets;
- [ ] emit durable capability/evidence trace events;
- [ ] keep hidden reasoning out of persisted execution traces.

### TOOL5 — ERP harness eval corpus

- [ ] establish representative task corpus across major ERP domains;
- [ ] score general reasoning + generated tools baseline;
- [ ] add adversarial scope/tool/prompt-injection cases;
- [ ] measure discovery precision, unnecessary tool usage, evidence accuracy and human correction;
- [ ] compare against selected reviewed-skill baselines;
- [ ] gate future prescriptive compositions on measured gains.

---

## 16. Explicitly out of scope

- procedural task workflows generated into IR;
- automatic skill generation from successful traces;
- arbitrary model-generated code execution;
- raw SQL as normal agent primitive;
- generic reducer dispatch;
- direct model access to STDB/PG credentials;
- unrestricted filesystem/network access;
- permissions stored in model prompts or skills;
- multi-agent debate/fleet orchestration before eval evidence justifies it;
- self-consistency voting as a substitute for deterministic business validation;
- duplicating STDB business rules inside tool descriptions.

---

## 17. Acceptance criteria

This plan is complete when:

- a general agent can discover relevant ERP concepts/capabilities from generated metadata without a matching procedural skill;
- the agent can inspect entity relationships and perform bounded multi-step investigations;
- model-visible reads use typed/generated operations rather than raw SQL;
- mutations use generated typed draft/action contracts rather than arbitrary reducer names;
- every invocation is re-authorized with trusted server context;
- large results are shaped/dataset-backed instead of blindly injected into prompts;
- authoritative and untrusted evidence are distinguishable through provenance;
- execution budgets prevent unbounded wandering;
- representative cross-entity ERP tasks succeed through iterative tool use;
- the eval suite can compare reasoning-first tooling against reviewed procedural skills;
- adding a new annotated ERP operation automatically updates the generated agent discovery/tool surface from the same contract IR used by other clients.
