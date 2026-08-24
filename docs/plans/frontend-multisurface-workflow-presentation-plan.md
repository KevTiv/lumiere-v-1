# Frontend multi-surface workflow, presentation, and reusable-work architecture

**Status:** Proposed — 2026-08-24
**Tracks:** `frontend-architecture`, `workflow-ir`, `presentation-ir`, `work-programs`, `runtime-extensions`, `admin-ui-composition`, `nextjs`, `expo`, `gpui-readiness`, `client-resilience`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [overview-dashboard-subagent-plan.md](./overview-dashboard-subagent-plan.md) · [organization-onboarding-workflow-subagent-plan.md](./organization-onboarding-workflow-subagent-plan.md) · [work-program-ui-harness-convergence-plan.md](./work-program-ui-harness-convergence-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Objective

Make Lumiere's frontend architecture surface-independent enough to support Next.js, Expo / React Native, and a future lean native shell without reimplementing business workflows or creating dangerous transport behavior independently per surface.

Extend that same architecture so successful AI-assisted work can become **normal reusable ERP UI** instead of remaining trapped in chat or a separate agent interface.

Before implementing AI-created UI convergence, first investigate and prove an **admin-driven UI composition path** over the same presentation foundations. Organization admins should be able to configure supported UI composition such as module tools, reports, dashboard sections, entity actions, field/table visibility, ordering, and other safe presentation choices without writing code. This is the non-AI proving ground for the runtime-configurable UI model that AI-created WorkPrograms will later consume.

Shared workflow/presentation definitions must be paired with generated client resilience defaults and runtime `WorkProgram` presentation contracts so a surface cannot accidentally create uncontrolled retry, refetch, reconnect, subscription, AI/sandbox execution, or dashboard fanout behavior.

```text
Application-contract IR / @lumiere/contracts
  typed queries / commands / subscriptions
  capability/entity/schema metadata
  traffic / retry / risk / result semantics
        │
        ├──────────────────────────────┐
        ▼                              ▼
workflow + presentation definitions   Runtime presentation registry
  authoritative UI intent               admin-authored composition
  list/detail/form/workflow              WorkProgram placements
  dashboard/report/navigation            versioned reusable work surfaces
        │                              │
        └──────────────┬───────────────┘
                       ▼
              platform renderer
        ├── Next.js / React DOM
        ├── Expo / React Native
        └── future GPUI / Rust
```

The goal is **not** one universal component tree and **not** an AI-specific UI tree. The goal is one shared application/workflow/presentation model with platform-specific renderers and one typed path for runtime-created reusable work.

---

## 2. Architectural rules

1. **Share behavior and presentation intent before sharing components.**
2. **Next.js and Expo may use different component implementations.**
3. **No workflow/business decision may exist only inside a React component tree.**
4. **Backend application contracts remain the only authoritative data/command source.**
5. **Presentation metadata must not duplicate backend authorization/business logic.**
6. **Platform renderers own layout, accessibility, density, gestures, keyboard behavior, and native interaction details.**
7. **A future non-React renderer must be possible without redesigning the workflow model.**
8. **Custom UI is allowed where a workflow truly benefits from it; metadata-driven rendering is a default, not a prison.**
9. **Generated transport policy owns retry/reconnect defaults; feature code must not invent competing retry loops.**
10. **Dashboard/report composition must coalesce identical dependencies and avoid uncontrolled fanout.**
11. **Runtime WorkPrograms compose generated capabilities; they never redefine application-contract authority.**
12. **Program placement is UI intent, not permission.** Every run/action is re-authorized server-side.
13. **Reusable AI work must graduate into shared UI primitives, not bespoke agent-only pages.**
14. **Published WorkProgram versions are immutable and surface-neutral.** Web/mobile renderers consume the same semantics.
15. **Expensive program execution is task/admission-driven.** A dashboard render must not implicitly rerun an expensive sandbox/report program.
16. **Admin-driven UI composition must be explored before AI-generated UI convergence.** The same runtime presentation registry should first support explicit human/admin configuration so dynamic UI semantics, validation, audit, compatibility, and renderer behavior are proven independently from AI generation.
17. **Admin composition is presentation, not business authority.** Admins may arrange supported surfaces and bind approved capabilities/programs, but cannot create new reducer semantics, bypass Casbin, or make hidden backend operations executable merely by placing them in UI metadata.

---

## 3. Layer model

### 3.1 Contracts

Source: generated `@lumiere/contracts` / Rust contract crate.

Owns:

- typed queries;
- typed commands;
- subscriptions;
- capability/entity/schema descriptors;
- operation names;
- transport serialization;
- cache/invalidation metadata;
- traffic class/idempotency/retry semantics;
- result/risk/confirmation metadata useful to presentation/runtime validation.

Does not own tenant WorkPrograms, presentation layout, or business policy.

### 3.2 Workflow model

Framework-neutral definitions describing authoritative domain workflows.

```ts
export interface WorkflowDefinition<TState extends string> {
  id: string;
  states: readonly TState[];
  actions: readonly WorkflowActionDefinition[];
  surfaces: WorkflowSurfaceBindings;
}
```

Representative definitions:

- organization onboarding;
- sales order lifecycle;
- purchase approval;
- invoice review;
- inventory receipt;
- CRM follow-up;
- offline changeset review.

These remain especially appropriate where progress/state is canonical STDB domain state.

### 3.3 Presentation model

Framework-neutral descriptions for common ERP surfaces:

```text
EntityList
EntityDetail
EntityEditor
WorkflowPanel
ApprovalQueue
Metric
MetricSeries
Dashboard
Report
ActivityFeed
CommandBar
ProgramCatalog
ProgramRun
ProgramOutput
```

Example list intent:

```ts
export interface EntityListPresentation {
  columns: readonly ColumnDefinition[];
  filters: readonly FilterDefinition[];
  actions: readonly ActionDefinition[];
  selection?: SelectionDefinition;
  sort?: readonly SortDefinition[];
  pagination: PaginationDefinition;
}
```

The definition describes *what* should be available, not DOM/native layout details.

### 3.4 Runtime/admin presentation registry

Before AI-created WorkPrograms are allowed to alter what appears in normal ERP surfaces, introduce a runtime presentation registry that admins can manage explicitly.

Conceptual shape:

```ts
export interface RuntimePresentationEntry {
  id: PresentationEntryId;
  organizationId: OrganizationId;
  placement: ProgramPlacementIntent | AdminPlacementIntent;
  source:
    | { kind: "static-presentation"; ref: PresentationRef }
    | { kind: "work-program"; ref: WorkProgramVersionRef }
    | { kind: "generated-capability"; ref: CapabilityKey };
  visibility?: PresentationVisibility;
  ordering?: number;
  status: "draft" | "published" | "disabled";
  version: number;
}
```

The first proof should be human/admin-authored, for example:

```text
admin chooses Manufacturing → Reports
admin adds approved Feed Production report
admin orders it after Monthly Output
admin publishes presentation version
web/mobile render same placement semantics
```

This registry provides the runtime UI insertion seam that later AI-driven `Save as reusable tool` flows use. AI should not get a separate path for dynamically adding UI.

Admin-configurable scope to investigate:

```text
module tool/report placement
entity action placement
dashboard section selection/order
command-palette/workspace-tool placement
column/filter/default-view preferences where safe
field visibility/grouping where backend contracts permit it
role/capability-based presentation visibility hints
```

Do not allow runtime presentation metadata to define:

```text
new reducer names
raw URLs/transport calls
business state transitions
permissions
unbounded query shapes
arbitrary React/component code
arbitrary sandbox execution on render
```

### 3.5 WorkProgram presentation model

Runtime-created reusable work has its own renderer-neutral descriptor rather than creating a dynamic React component tree.

```ts
export interface ProgramPresentation {
  title: string;
  description?: string;
  input: ProgramInputPresentation;
  run: ProgramRunPresentation;
  outputs: readonly ProgramOutputPresentation[];
  placements?: readonly ProgramPlacementIntent[];
  allowManualRun: boolean;
  allowSchedule: boolean;
  allowFork: boolean;
}
```

A published `WorkProgramVersion` may surface as:

```text
module tool
module report
entity action
command-palette action
dashboard section
workspace tool
```

Placement does not grant access. The server resolves current actor/org/company scope and re-authorizes execution.

### 3.6 Design foundations

Create a renderer-neutral token package containing semantic tokens only:

- spacing;
- typography;
- semantic colors/status;
- density;
- radius;
- motion timing where meaningful;
- breakpoints/categories as semantics, not CSS implementation.

### 3.7 Platform renderers

Target package boundaries:

```text
packages/
  workflow-core/
  presentation-core/
  work-program-core/
  design-tokens/
  ui-web/
  ui-native/
```

`work-program-core` owns types/helpers only. It must not import React, Next.js, React Native, Daytona/model-provider SDKs, or raw STDB bindings.

Future optional:

```text
crates/
  lumiere-workflow/
  lumiere-presentation/
  lumiere-work-program/
  lumiere-gpui/
```

Do not force React packages into the Rust/native path.

---

## 4. Surface responsibilities

### Next.js / web

Optimize for:

- dense data tables;
- keyboard-first workflows;
- split panes;
- drag/drop where useful;
- print/export;
- complex reporting;
- large-screen dashboards;
- admin presentation configuration/publishing;
- program catalog/version inspection;
- rich import/document review;
- accessibility and browser-native behavior.

### Expo / native

Optimize for:

- mobile-first workflows;
- field/warehouse/service tasks;
- camera/document capture for compatible Program inputs;
- offline-first interaction;
- push/deep links;
- step-driven workflows;
- bottom sheets / native navigation;
- adaptive list/detail layouts on tablets;
- program run/progress/output viewing without assuming cloud sandbox work can execute offline.

Expo should consume published admin/runtime presentation configuration, but initial admin authoring/publishing UI may remain web-first.

Expo/background behavior must use generated reconnect/refetch policy rather than aggressive default replay after network restoration.

### Future GPUI/native desktop

Optimize for:

- low-memory fast startup;
- native virtualization;
- command palette / keyboard-driven usage;
- multi-pane workspace;
- long-lived operational sessions.

The GPUI path is a future proof, not branch scope.

---

## 5. Dashboard and reporting model

Dashboard composition should be described as data rather than hardcoded page structure.

```ts
export interface DashboardDefinition {
  id: string;
  title: string;
  sections: readonly DashboardSection[];
}

export type DashboardSection =
  | MetricGroupSection
  | TimeSeriesSection
  | RankedListSection
  | WorkflowQueueSection
  | ReportTableSection
  | WorkProgramSection;
```

A `WorkProgramSection` may display:

```text
last verified output
output freshness
run-now action
scheduled-run state
artifact drill-down
```

It must not execute an expensive program merely because the dashboard rendered.

Renderers decide layout:

```text
web      -> responsive/resizable grid
mobile   -> stacked priority-ordered sections
native   -> touch-first cards / drill-down
future   -> pane-based native workspace
```

Do not encode CSS grid positions as canonical dashboard semantics.

Dashboard execution rules:

- coalesce identical operation dependencies across sections;
- stage/lazy-load expensive durable/report sections where appropriate;
- do not open redundant subscriptions per widget;
- reuse persisted WorkProgram outputs with explicit freshness where appropriate;
- reruns are explicit task intents governed by AI/sandbox admission;
- honor generated traffic class/retry policy;
- treat 429/503 as recoverable capacity states, not immediate retry triggers.

---

## 6. Workflow composition model

Example authoritative workflow:

```ts
const purchaseApproval = defineWorkflow({
  id: "purchasing.order.approval",
  states: ["draft", "submitted", "approved", "rejected"],
  actions: {
    submit: contracts.purchasing.orders.submit,
    approve: contracts.purchasing.orders.approve,
    reject: contracts.purchasing.orders.reject,
  },
  surfaces: {
    list: purchaseOrderList,
    detail: purchaseOrderDetail,
    activity: purchaseOrderActivity,
  },
});
```

A WorkProgram may *compose* these existing generated operations or draft actions around sandbox/research/document work, but it does not become the source of lifecycle truth.

```text
WorkProgram
  analyze / extract / research
      ↓
  typed draft/action intent
      ↓
normal generated capability
      ↓
STDB reducer / authoritative workflow
```

The renderer decides whether this becomes a web split-pane, mobile stack, tablet master/detail, or future GPUI inspector.

---

## 7. Reusable-work UI primitives

The web/native renderer layers should converge on these semantic surfaces:

```text
ProgramCatalog
ProgramCard / ProgramSummary
ProgramRunForm
ProgramRunProgress
ProgramOutputViewer
ProgramRunHistory
ProgramVersionHistory
ProgramVersionDiff
ProgramPublishReview
ProgramPlacementPicker
AutomationBindingEditor
AdminPresentationEditor
AdminDashboardComposer
AdminModuleToolManager
```

The same primitives should support:

```text
report program
Excel/CSV import program
contract/OCR review program
document-generation program
composed action workflow
```

Do not create separate frontend runtimes for "AI reports", "AI imports", and "AI document tools".

---

## 8. Admin composition before AI-created work → UI promotion

Before implementing the `Save as reusable tool` AI promotion flow, prove that the same UI/runtime path works when configured directly by an authorized organization admin.

Required progression:

```text
static developer-defined presentation
        ↓
admin-configurable runtime placement/composition
        ↓
published versioned presentation registry
        ↓
AI-created WorkProgram promotion uses same registry
```

The admin-driven proof should answer:

- can supported module/report/entity/dashboard placements be changed without React code changes?
- can one published configuration render consistently on web and Expo?
- are incompatible/deleted capability or WorkProgram references detected before publish?
- is every change versioned/audited/rollbackable?
- can presentation visibility be expressed without pretending to be authorization?
- can the renderer safely handle unknown/disabled/runtime-added entries?
- do runtime additions preserve traffic/admission semantics?

Only after this seam is proven should AI-created work use it automatically or semi-automatically.

AI-assisted lifecycle then becomes:

```text
exploratory agent task
        ↓
artifact/evidence/program produced
        ↓
Save as reusable tool
        ↓
WorkProgramDraft
        ↓
test / choose inputs / output presentation / placement
        ↓
publish immutable version
        ↓
insert through same runtime presentation registry
        ↓
normal ERP UI
```

Example:

```text
chat: "Build our monthly feed manufacturing report"
        ↓
successful report
        ↓
Save as reusable tool
        ↓
Manufacturing → Reports → Feed production review
```

The published UI should invoke the known WorkProgram skeleton rather than ask an LLM to rediscover the procedure each time.

---

## 9. Migration strategy

Do not rewrite all existing UI.

### Phase F0 — inventory, primitives, and admin-composition investigation

Before implementation-heavy convergence work, investigate the smallest safe admin-driven runtime UI model.

- [ ] inventory existing page shells, dashboard cards, tables, form frames, detail layouts, action bars, and workflow-specific wrappers;
- [ ] classify each as token / primitive / presentation pattern / domain-specific component;
- [ ] identify duplicated frames whose differences are only layout/transport wiring;
- [ ] inventory existing organization/admin customization controls and any feature flags/preferences already affecting UI;
- [ ] identify which current module tools/reports/entity actions/dashboard cards could become runtime placement entries without changing business semantics;
- [ ] define minimal `workflow-core`, `presentation-core`, and `work-program-core` types;
- [ ] define minimal `RuntimePresentationEntry` / admin placement/version contract;
- [ ] define design-token package boundary;
- [ ] decide which admin-driven configuration belongs in STDB active state versus durable history/artifact metadata;
- [ ] define publish/version/rollback/audit behavior before AI promotion is introduced;
- [ ] explicitly list UI choices that remain developer-only/bespoke and must not become runtime configurable.

**Exit gate:** one canonical model exists for list, detail, workflow action, metric, dashboard section, report table, program input/run/output intent, and runtime admin placement; at least one existing static UI element is shown to be safely representable as admin-configurable presentation metadata.

### Phase F0.5 — admin-driven runtime UI proof

- [ ] implement a web-first admin presentation editor for a narrowly scoped proof;
- [ ] allow an authorized admin to add/remove/reorder one safe module/report/dashboard placement from approved registry entries;
- [ ] publish immutable/versioned runtime presentation configuration;
- [ ] render the published result through normal web renderer primitives;
- [ ] consume the same published configuration in a renderer-neutral fixture and/or Expo proof;
- [ ] validate referenced generated capability/WorkProgram contracts at publish time;
- [ ] audit author/version/change/revert events;
- [ ] prove admin placement cannot bypass server authorization or generated traffic policy;
- [ ] prove disabled/invalid entries fail closed without breaking the whole module/page.

**Exit gate:** runtime-configurable UI works without AI involvement and without arbitrary component/code injection. This is a prerequisite for AI-created WorkProgram placement.

### Phase F1 — web renderer proof

- [ ] implement presentation renderers using existing web components where possible;
- [ ] wrap rather than rewrite stable existing components;
- [ ] prove list/detail/action composition through presentation definitions;
- [ ] add minimal ProgramRunForm/Progress/Output renderers from static fixture data;
- [ ] ensure direct backend usage remains through generated contracts only;
- [ ] ensure renderer code cannot override generated retry/idempotency semantics casually.

**Exit gate:** one existing Next.js workflow and one serialized WorkProgram fixture render through shared presentation models without losing current capability.

### Phase F2 — paired proofs: Overview Dashboard + Organization Onboarding

Use the two existing sub-plans together:

- Overview Dashboard proves presentation/reporting composition;
- Organization Onboarding proves authoritative workflow/state composition.

For Overview:

- [ ] model dashboard sections declaratively;
- [ ] reuse existing metrics/reports through generated contracts;
- [ ] implement web renderer;
- [ ] ensure dashboard definitions contain no DOM/CSS-specific layout decisions;
- [ ] coalesce duplicate data dependencies and stage expensive sections;
- [ ] reserve `WorkProgramSection` support without forcing dynamic program execution into the initial Overview;
- [ ] use the admin-composition proof to add/reorder at least one safe Overview section through runtime presentation metadata.

For Onboarding:

- [ ] drive workflow progress from authoritative STDB state;
- [ ] model step/action/navigation semantics independently of renderer;
- [ ] use generated commands/queries/subscriptions only;
- [ ] preserve recovery/resume behavior;
- [ ] ensure repeated/resumed submissions respect idempotency/admission rules.

### Phase F3 — Expo starter surface

- [ ] add Expo workspace/app;
- [ ] consume the same private contract package;
- [ ] consume shared workflow/presentation/work-program definitions;
- [ ] consume published runtime/admin presentation configuration;
- [ ] implement native renderers for metric, list, detail, form/action, workflow queue, dashboard sections, ProgramRun, and ProgramOutput;
- [ ] prove Organization Onboarding end-to-end on iOS/Android;
- [ ] render the same Overview Dashboard definition with native composition;
- [ ] implement jittered reconnect/backoff and deliberate background refetch defaults from generated policy;
- [ ] recover ProgramRun state from server after reconnect instead of replaying steps;
- [ ] keep platform-specific navigation and interaction details native.

**Exit gate:** onboarding, Overview and a WorkProgram fixture operate from the same shared definitions on web and Expo without sharing layout components or creating independent transport/retry behavior; published admin presentation configuration produces equivalent semantic placement on both surfaces.

### Phase F4 — reporting + WorkProgram convergence

- [ ] extract repeated report/table/filter patterns;
- [ ] define report input/filter/sort/drill-down semantics;
- [ ] implement ProgramCatalog + ProgramRunForm + ProgramRunProgress + ProgramOutputViewer on web;
- [ ] bind a real published report WorkProgram to module/report placement through the same runtime presentation registry proven in F0.5;
- [ ] support `WorkProgramSection` for last-output/freshness/run-now dashboard presentation;
- [ ] ensure expensive program execution is admission/task-driven rather than render-driven;
- [ ] add export/print capability at the web renderer layer;
- [ ] add mobile drill-down behavior at the native renderer layer;
- [ ] load-test dashboard/program fanout against admission-control budgets.

**Exit gate:** one AI-created report can be published and used as a normal module tool without a bespoke React page or AI-specific placement mechanism.

### Phase F5 — import/document reusable-work proof

- [ ] present a historical Excel/CSV `ImportProposal` through shared program/workflow UI;
- [ ] present a contract/OCR review output through the same ProgramRun/Output primitives;
- [ ] support approval/action-preview handoff into authoritative STDB operations;
- [ ] prove report/import/document programs share version/run/history UI;
- [ ] keep sandbox/provider details absent from renderer packages.

### Phase F6 — program versioning/publishing/placement

- [ ] add version history/diff/publish/deprecate UI;
- [ ] add `Save as reusable tool` promotion from eligible agent results;
- [ ] reuse the admin presentation editor/registry for module/report/entity/command-palette placement;
- [ ] add manual schedule binding UI after runtime automation contract exists;
- [ ] require immutable published version refs for schedules;
- [ ] present compatibility/migration warnings when application-contract changes invalidate a program.

### Phase F7 — legacy frame removal

- [ ] remove duplicated page shells superseded by presentation renderers;
- [ ] remove feature-local table/form/dashboard/program wrappers that encode only reusable composition;
- [ ] retain bespoke domain components where they carry genuine workflow value;
- [ ] add CI/import rules preventing new direct dependencies from feature code into transport or raw generated STDB bindings.

### Phase F8 — renderer independence check

- [ ] serialize representative workflow/presentation/runtime-placement definitions into renderer-neutral test fixtures;
- [ ] prove they can be consumed without React assumptions;
- [ ] optionally build a tiny Rust/CLI/native proof consuming the same conceptual contract;
- [ ] do **not** build a production GPUI client in this phase.

---

## 10. Required tests

1. shared workflow definitions contain no React/DOM/native imports;
2. presentation definitions contain no raw transport paths or reducer names;
3. runtime/admin presentation entries contain only approved typed refs/placement semantics, never arbitrary code/components/URLs;
4. web and Expo renderers can consume the same dashboard definition and published runtime placement configuration;
5. web and Expo actions resolve the same generated contract operations;
6. renderer-specific layout changes do not alter workflow semantics;
7. business authorization remains backend-owned;
8. one migrated workflow retains parity with the current web implementation;
9. Overview Dashboard data sources are contract-driven and renderer-independent;
10. shared packages do not import `next`, `react-dom`, or `react-native`;
11. future non-React consumption remains possible from serialized/typed presentation definitions;
12. Overview does not duplicate identical requests/subscriptions across widgets;
13. reconnect/refetch behavior is bounded under simulated network restoration;
14. 429/503 responses do not trigger uncontrolled immediate retry loops;
15. onboarding resume/replay preserves idempotency and server-authoritative workflow state;
16. admin add/remove/reorder/publish/revert operations are audited and versioned;
17. an admin cannot expose or execute a capability they are not authorized to invoke merely by placing it in the UI;
18. invalid/stale runtime presentation entries fail closed and render a recoverable admin-facing state rather than crashing a surface;
19. AI-created WorkProgram placement goes through the same validation/publish/runtime registry path as admin-created placement;
20. dashboard rendering never implicitly triggers sandbox/model execution for runtime-added WorkProgram sections.

---

## 11. Acceptance criteria

This plan is successful when:

- Next.js remains a first-class dense ERP surface;
- Expo can be added without duplicating workflow/business logic;
- shared frontend architecture centers on workflow/presentation definitions, not universal components;
- a narrow admin-driven UI composition proof exists before AI-driven placement/convergence is implemented;
- admins can safely configure supported presentation placement without writing React or changing backend authority;
- admin/runtime presentation changes are versioned, auditable, rollbackable, validated, and renderer-neutral;
- Overview Dashboard proves dashboard/report composition from shared definitions;
- Organization Onboarding proves workflow/state composition from shared definitions;
- existing stable components are reused behind renderer boundaries rather than rewritten by default;
- repeated custom page frames are reduced materially;
- contract access stays generated and surface-independent;
- retry/reconnect/fanout behavior is contract-driven and bounded across surfaces;
- AI-created WorkPrograms reuse the exact runtime presentation seam already proven with human/admin configuration;
- a future GPUI/native client would need a renderer, not a redesign of the application workflow model.
