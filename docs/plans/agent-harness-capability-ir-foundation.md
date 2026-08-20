# Agent harness capability IR foundation

**Status:** Proposed — 2026-08-20
**Tracks:** `application-contract-ir`, `agent-harness`, `capability-registry`, `casbin`, `files`, `presentation`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md) · [audit-auth-operation-context-plan.md](./audit-auth-operation-context-plan.md)

---

## 1. Objective

Make the generated application-contract IR usable as the single typed capability source for the AI harness, ordinary frontend clients, future content/file workflows, and presentation tooling.

The AI harness must not gain a parallel API surface or a separate authorization model. It should consume generated capability descriptors for the same stable ERP operations used by web/Expo clients, with all effective permissions resolved through the existing Casbin-style server authorization boundary.

```text
Application-contract IR
        │
        ├── ERP operation descriptors
        ├── file/content capability descriptors
        ├── presentation capability descriptors
        └── risk / confirmation / traffic metadata
                ↓
        Generated capability registry
                ↓
      web / Expo / AI harness / future GPUI
                ↓
        server auth + Casbin evaluation
                ↓
        STDB reducer/view/procedure boundary
```

The branch should generate enough structural tooling now that later Scaleway-hosted LLM orchestration can discover and invoke approved ERP capabilities without bespoke adapters for every domain.

---

## 2. Non-negotiable invariants

1. **Casbin-style server policy remains the single authorization authority for capabilities.**
2. **The model never receives or invents trusted actor/org/role/permission context.**
3. **An agent may only invoke capabilities the authenticated user could invoke through the normal application boundary.**
4. **STDB reducers remain authoritative for business mutations and invariants.**
5. **Generated capability metadata is structural; it does not encode authorization policy or business rules.**
6. **Raw SQL, arbitrary reducer dispatch, arbitrary HTTP URLs, bucket keys, or filesystem paths are not agent tools.**
7. **Sensitive mutations require explicit risk/confirmation semantics in addition to authorization.**
8. **Saved skills/workflows never retain permissions; each step is re-authorized at execution time.**
9. **Content-safety/prompt-safety models may filter or classify requests but never authorize business actions.**
10. **Agent actions share operation/correlation IDs with audit and telemetry.**

---

## 3. Capability IR extension

Extend application-contract IR with harness-safe structural metadata.

```rust
pub enum GeneratedOperationRisk {
    ReadOnly,
    Presentation,
    Draft,
    BusinessMutation,
    FinancialMutation,
}

pub struct GeneratedCapabilityDescriptor {
    pub operation: OperationName,
    pub input: GeneratedTypeRef,
    pub output: GeneratedTypeRef,
    pub required_capability: CapabilityKey,
    pub risk: GeneratedOperationRisk,
    pub requires_confirmation: bool,
    pub traffic: GeneratedOperationTrafficPolicy,
    pub presentation: Option<GeneratedPresentationCapability>,
}
```

`required_capability` is a stable policy key consumed by the server-side authorization layer. The IR does **not** generate role membership or policy assignments; admins continue to configure those through Casbin-backed authorization.

Example keys:

```text
accounting.receivables.read
reporting.visualize
files.dataset.inspect
contracts.draft
legal.research
payments.initiate
payments.refund
```

---

## 4. Generated tool registry

Generate a framework-neutral registry from the same application-contract IR.

```ts
export interface AgentToolDefinition<TInput, TOutput> {
  operation: OperationName
  capability: CapabilityKey
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  risk: OperationRisk
  requiresConfirmation: boolean
}
```

The harness receives only tools that survive server-side capability filtering for the authenticated actor + organization.

Conceptual flow:

```text
agent asks for tool catalog
        ↓
server resolves TrustedOperationContext
        ↓
Casbin evaluates capability keys
        ↓
filtered generated registry
        ↓
LLM chooses typed tool
        ↓
server re-authorizes invocation
        ↓
STDB operation executes
```

Tool discovery filtering is an ergonomic optimization, not the security boundary; every invocation is re-authorized.

---

## 5. File/content capability foundation

Do not implement the full file system/import product in this phase. Reserve first-class capability shapes so later Object Storage + dataset/import work uses the same contract vocabulary.

Canonical future resources:

```ts
interface FileAssetRef {
  id: FileAssetId
}

interface DatasetRef {
  id: DatasetId
}

interface ImportProposalRef {
  id: ImportProposalId
}
```

Candidate capabilities:

```text
files.asset.inspect
files.dataset.extract
files.dataset.preview
files.import.propose
files.import.apply
content.workspace.draft
content.workspace.research
content.workspace.export
```

Raw Scaleway Object Storage bucket/object identifiers remain infrastructure details. Agents and frontend clients operate on organization-scoped file resource IDs resolved by trusted services.

Import application must remain proposal/reducer driven:

```text
file → dataset → mapping/validation → ImportProposal → user/reviewer approval → STDB reducer
```

---

## 6. Presentation capability foundation

The AI harness should generate presentation intent, not React/Expo/GPUI code.

Reserve typed presentation capabilities such as:

```text
presentation.metric
presentation.table
presentation.timeseries
presentation.comparison
presentation.report
presentation.workflow_proposal
```

They should map onto the renderer-neutral presentation definitions introduced by the multi-surface frontend plan.

Example:

```ts
presentation.timeseries({
  title: "Revenue trend",
  datasetId,
  x: "month",
  y: "revenue",
})
```

Next.js, Expo, and future renderers remain free to render the same intent differently.

---

## 7. Content workspace and research-agent boundary

Future drafting experiences such as contracts, policies, tenders, and reports should compose generated capabilities rather than expose an unrestricted chat runtime.

```text
Content workspace
  ├── organization/resource lookups
  ├── file/dataset inspection
  ├── research capability
  ├── draft capability
  ├── presentation/document preview
  └── explicit finalize/export workflow
```

Research sub-agents return structured findings with source/evidence metadata. They do not approve, sign, send, or bind the organization.

Suggested future structural type:

```ts
interface ResearchFinding {
  question: string
  jurisdiction?: string
  summary: string
  sources: SourceReference[]
  confidence: "low" | "medium" | "high"
  requiresProfessionalReview: boolean
}
```

This is a later consumer of the capability registry, not a Phase 0 business-logic implementation.

---

## 8. Skill/workflow composition direction

Future introspection or power-user automation should produce reviewed compositions over existing capabilities, not arbitrary executable code.

```ts
interface SkillDefinition {
  id: SkillId
  version: number
  requiredCapabilities: CapabilityKey[]
  steps: SkillStep[]
  owner: "system" | "organization" | "user"
}
```

Each step is re-authorized at runtime. Removing a permission must immediately constrain old saved skills.

Candidate future pipeline:

```text
observed repeated workflow
        ↓
candidate skill proposal
        ↓
human/admin review
        ↓
versioned skill composition
        ↓
runtime Casbin checks per step
```

Automatic skill creation/execution from observation is out of scope for this branch.

---

## 9. Scaleway AI harness compatibility

The harness implementation may initially use Scaleway Generative APIs, but provider details remain outside application-contract IR.

The generated registry should be provider-neutral and serializable into the function/tool schema expected by the chosen model runtime.

Keep separate:

```text
GeneratedCapabilityDescriptor
        ↓
provider adapter
  ├── Scaleway tool/function schema
  ├── future OpenAI-compatible runtime
  └── future local/offline model runtime
```

This prevents provider/model changes from changing ERP capability semantics.

---

## 10. Phase H0 — IR/tooling foundation

- [ ] add stable `CapabilityKey` metadata to explicitly approved application operations;
- [ ] add operation risk + confirmation metadata;
- [ ] generate JSON-schema-compatible input/output descriptors from canonical contract types;
- [ ] generate framework-neutral `AgentToolDefinition`/capability registry artifacts in the private npm package and Rust contract crate where useful;
- [ ] add server-side capability filtering adapter backed by existing Casbin-style authorization;
- [ ] ensure every tool invocation re-resolves trusted actor/org context and re-authorizes the capability;
- [ ] propagate operation/correlation context into agent invocations, audit, and telemetry;
- [ ] reserve typed presentation capability descriptors compatible with presentation-core;
- [ ] reserve file/content resource references and capability namespaces without implementing raw bucket access;
- [ ] add CI checks preventing agent/harness code from dispatching raw reducer strings or bypassing generated operations.

**Exit gate:** one read-only representative operation and one draft/proposal operation can be exposed to a harness through generated tool metadata, filtered by server-side Casbin policy, invoked through the normal STDB contract boundary, and correlated in audit/telemetry without any harness-specific business API.

---

## 11. Explicitly deferred

- autonomous skill generation from user behavior;
- production legal-research agents;
- contract signing/sending automation;
- direct model access to Object Storage;
- arbitrary filesystem access;
- unrestricted code execution;
- raw SQL/query generation;
- AI-authored authorization decisions;
- provider-specific model policy in application IR;
- full Excel/PDF import implementation;
- automatic financial mutations.

---

## 12. Acceptance criteria

This foundation is successful when:

- frontend and AI harness share the same generated application operations;
- Casbin-backed policy remains the sole capability authorization source;
- capability discovery and invocation cannot elevate user permissions;
- generated tool definitions expose typed inputs/outputs, risk, confirmation, traffic, and stable capability keys;
- STDB remains authoritative for mutations/business invariants;
- presentation/file/content concepts have typed extension points without creating parallel APIs;
- audit/telemetry can identify agent-originated operations using the same operation context as ordinary clients;
- later Scaleway LLM, file import, content workspace, and skill systems can be added as consumers rather than forcing another ERP communication layer.
