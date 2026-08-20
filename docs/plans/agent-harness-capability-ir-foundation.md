# Agent harness capability IR foundation

**Status:** Proposed — 2026-08-20
**Tracks:** `application-contract-ir`, `agent-harness`, `capability-registry`, `casbin`, `analysis-shaping`, `files`, `presentation`, `provider-seams`, `execution-tracing`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [scaleway-cloudflare-bootstrap-deployment-plan.md](./scaleway-cloudflare-bootstrap-deployment-plan.md) · [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md) · [audit-auth-operation-context-plan.md](./audit-auth-operation-context-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md)

---

## 1. Objective

Make the generated application-contract IR usable as the single typed capability source for the AI harness, ordinary frontend clients, future content/file workflows, analytical shaping, and presentation tooling.

The AI harness must not gain a parallel API surface or a separate authorization model. It should consume generated capability descriptors for the same stable ERP operations used by web/Expo clients, with all effective permissions resolved through the existing Casbin-style server authorization boundary.

The harness should also avoid treating raw ERP query responses as model context. Bulk data remains server-side and is reduced through typed deterministic analysis plans before compact results reach the model.

The runtime may use replaceable provider/plugin seams for inference, retrieval, indexing, sandboxing, research, OCR, telemetry, or rendering, but those seams must terminate at the generated capability boundary. They never redefine authorization, STDB invariants, organization placement, durable sequencing, or ERP contract semantics.

```text
Application-contract IR
        │
        ├── ERP operation descriptors
        ├── analysis/data-shaping descriptors
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
                ↓
       typed server-side result/dataset
                ↓
     deterministic analysis shaping
                ↓
          compact model context
```

---

## 2. Non-negotiable invariants

1. **Casbin-style server policy remains the single authorization authority for capabilities.**
2. **The model never receives or invents trusted actor/org/role/permission context.**
3. **An agent may only invoke capabilities the authenticated user could invoke through the normal application boundary.**
4. **STDB reducers remain authoritative for business mutations and invariants.**
5. **Generated capability metadata is structural; it does not encode authorization policy or business rules.**
6. **Raw SQL, arbitrary reducer dispatch, arbitrary HTTP URLs, bucket keys, or filesystem paths are not agent tools.**
7. **Raw ERP result payloads are not the default LLM context.** Large/bulk results remain server-side and are shaped first.
8. **Sensitive mutations require explicit risk/confirmation semantics in addition to authorization.**
9. **Saved skills/workflows never retain permissions; each step is re-authorized at execution time.**
10. **Content-safety/prompt-safety models may filter or classify requests but never authorize business actions.**
11. **Agent actions and analysis transformations share operation/correlation IDs with audit and telemetry.**
12. **AI/provider failure never blocks ordinary ERP workflows.**
13. **Provider/plugin replacement never changes ERP authority semantics.**
14. **Agent execution tracing is runtime state, not ERP business state.** It correlates with ERP operations but does not replace durable business/audit history.

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
    pub analysis: Option<GeneratedAnalysisCapability>,
    pub presentation: Option<GeneratedPresentationCapability>,
}
```

`required_capability` is a stable policy key consumed by the server-side authorization layer. The IR does **not** generate role membership or policy assignments; admins continue to configure those through Casbin-backed authorization.

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
  resultPolicy?: ToolResultPolicy
}
```

The harness receives only tools that survive server-side capability filtering for the authenticated actor + organization.

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
        ↓
result policy decides direct-small result vs server-side dataset/shaping
```

Tool discovery filtering is an ergonomic optimization, not the security boundary; every invocation is re-authorized.

---

## 5. Harness provider seam boundary

The generated capability registry should remain provider-neutral and feed a small number of runtime seams.

Safe seams may include:

```text
ModelProvider
EmbeddingProvider
SemanticIndexProvider
SandboxProvider
ResearchProvider
DocumentProcessor
OCRProvider
ContextRetriever
TelemetrySink
PresentationRenderer
```

The IR does **not** contain concrete provider names or deployment IDs. It only describes the ERP operation and structural consumption policy.

A provider adapter may transform:

```text
GeneratedCapabilityDescriptor
        ↓
provider-specific tool/function schema
```

but may not change the capability key, risk, confirmation requirement, authorization semantics, or result-shaping constraints.

Intentionally non-pluggable:

```text
Casbin authorization semantics
STDB business invariants
OrganizationPlacement ownership
ordered durable sequencing
ERP contract meaning
```

---

## 6. Guarded tool/capability lifecycle

Every agent capability invocation should emit/flow through the same runtime lifecycle:

```text
CapabilityRequested
      ↓
input/schema validation
      ↓
trusted actor/org resolution
      ↓
Casbin authorization
      ↓
risk / confirmation
      ↓
admission / budget
      ↓
STDB operation
      ↓
result shaping
      ↓
verification/provenance
      ↓
CapabilityResult
```

The generated registry provides the structural metadata needed by this pipeline. Runtime middleware may add timeout, metrics, redaction, safe retry behavior, or telemetry, but it cannot bypass any earlier gate.

---

## 7. Agent execution trace compatibility

The IR should expose enough stable operation identity and provenance hooks for the Agent Control Plane to persist append-only execution events such as capability selected/requested/authorized/completed and artifact created.

Do **not** place the entire event model inside application IR. IR only needs stable identifiers and correlation fields:

```ts
interface GeneratedOperationTraceMetadata {
  operation: OperationName
  capability: CapabilityKey
  risk: OperationRisk
  resultPolicy?: ToolResultPolicy
}
```

The runtime event log links to authoritative ERP operations using `operation_id`, `correlation_id`, and artifact refs. This enables replay/debug/action tracing without making the agent log canonical ERP history.

---

## 8. File/content capability foundation

Do not implement the full file system/import product in this phase. Reserve first-class capability shapes so later Object Storage + dataset/import work uses the same contract vocabulary.

Canonical future resources:

```ts
interface FileAssetRef { id: FileAssetId }
interface DatasetRef { id: DatasetId }
interface ImportProposalRef { id: ImportProposalId }
```

Candidate capabilities include file inspection/extraction/import proposal/apply and content workspace draft/research/export operations. Raw bucket identifiers remain infrastructure details.

---

## 9. Presentation capability foundation

The AI harness should generate presentation intent, not React/Expo/GPUI code. Reserve renderer-neutral presentation operations for metrics, tables, timeseries, comparisons, reports, and workflow proposals.

---

## 10. Content workspace and research-agent boundary

Future drafting experiences should compose generated capabilities rather than expose an unrestricted chat runtime. Research sub-agents return structured findings with source/evidence metadata and cannot approve, sign, send, or bind the organization.

---

## 11. Skill/workflow composition direction

Future skills are reviewed compositions over generated capabilities, not arbitrary executable code. Each step re-authorizes at runtime and old skills immediately respect revoked permissions.

---

## 12. Scaleway AI harness compatibility

The harness implementation may initially use Scaleway Generative APIs, but provider details remain outside application-contract IR.

```text
GeneratedCapabilityDescriptor
        ↓
provider adapter
  ├── Scaleway model/tool schema
  ├── future OpenAI-compatible runtime
  └── future local/offline model runtime
```

Deploy the initial harness near the trusted backend in Paris. Interactive model output should use HTTP/SSE; STDB websocket subscriptions remain responsible for ERP realtime state.

---

## 13. Token-aware result shaping

For analytical workloads, the model decides **which authorized information and transformation it needs**, while deterministic server-side logic performs bulk manipulation.

Avoid raw large JSON model context. Prefer authorized source capability → typed server-side dataset → validated `AnalysisPlan` → compact `AnalysisResult` → model interpretation.

```ts
export interface AnalysisPlan {
  source: DatasetHandle
  steps: readonly AnalysisStep[]
  output: AnalysisOutputSpec
}

type AnalysisStep =
  | FilterStep
  | ProjectStep
  | GroupByStep
  | AggregateStep
  | ComparePeriodsStep
  | TopNStep
  | TimeseriesStep
```

Tool result policy:

```ts
type ToolResultPolicy =
  | { kind: "direct"; maxBytes: number }
  | { kind: "dataset"; maxRows: number }
  | { kind: "aggregate-first"; allowedShapes: AnalysisShape[] }
```

A typed declarative engine is the default. If advanced scripting is later needed, it runs in a constrained sandbox with no raw credentials, arbitrary network/filesystem, or privilege expansion.

---

## 14. Phase H0 — IR/tooling foundation

- [ ] add stable `CapabilityKey` metadata to explicitly approved application operations;
- [ ] add operation risk + confirmation metadata;
- [ ] generate JSON-schema-compatible input/output descriptors from canonical contract types;
- [ ] generate framework-neutral capability/tool registry artifacts;
- [ ] add structural result-policy metadata;
- [ ] add server-side capability filtering backed by Casbin;
- [ ] ensure every invocation re-resolves trusted actor/org context and re-authorizes;
- [ ] define typed dataset/analysis contracts and minimal deterministic shaping engine;
- [ ] reserve presentation/file/content extension namespaces;
- [ ] expose stable operation/correlation metadata required by agent execution tracing;
- [ ] define provider-neutral adapter contracts without concrete provider IDs in IR;
- [ ] add CI checks preventing raw reducer strings, SQL, or bypassing generated operations.

**Exit gate:** one representative read-only operation and one draft/proposal operation can be exposed through generated metadata and executed through authorization → shaping → compact context → presentation intent, while the runtime can trace the capability lifecycle through stable operation/correlation IDs.

---

## 15. Explicitly deferred

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
- automatic financial mutations;
- general-purpose sandbox scripting before the constrained analysis-plan path is proven;
- encoding full agent session/replay orchestration into application IR;
- making authorization/business/durable authority provider-pluggable.

---

## 16. Acceptance criteria

This foundation is successful when:

- frontend and AI harness share the same generated application operations;
- Casbin-backed policy remains the sole capability authorization source;
- capability discovery and invocation cannot elevate user permissions;
- generated tool definitions expose typed inputs/outputs, risk, confirmation, traffic, stable capability keys, and result-shaping policy;
- provider adapters can change without changing ERP operation meaning or authorization;
- large analytical ERP results remain server-side and reach the model only through bounded deterministic shapes;
- STDB remains authoritative for mutations/business invariants;
- presentation/file/content concepts have typed extension points without creating parallel APIs;
- audit/telemetry and the agent execution event stream can correlate agent-originated operations using stable operation/correlation IDs;
- model/provider failure leaves ordinary ERP operation unaffected;
- later Scaleway LLM, file import, content workspace, tracing, replay, and skill systems can be added as consumers rather than forcing another ERP communication layer.
