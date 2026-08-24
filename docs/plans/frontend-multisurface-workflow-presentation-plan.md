# Frontend multi-surface workflow, presentation, and reusable-work architecture

**Status:** Proposed — 2026-08-24
**Tracks:** `frontend-architecture`, `workflow-ir`, `presentation-ir`, `work-programs`, `runtime-extensions`, `nextjs`, `expo`, `gpui-readiness`, `client-resilience`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [overview-dashboard-subagent-plan.md](./overview-dashboard-subagent-plan.md) · [organization-onboarding-workflow-subagent-plan.md](./organization-onboarding-workflow-subagent-plan.md) · [work-program-ui-harness-convergence-plan.md](./work-program-ui-harness-convergence-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

---

## 1. Objective

Make Lumiere's frontend architecture surface-independent enough to support Next.js, Expo / React Native, and a future lean native shell without reimplementing business workflows or creating dangerous transport behavior independently per surface.

Extend that same architecture so successful AI-assisted work can become **normal reusable ERP UI** instead of remaining trapped in chat or a separate agent interface.

Shared workflow/presentation definitions must be paired with generated client resilience defaults and runtime `WorkProgram` presentation contracts so a surface cannot accidentally create uncontrolled retry, refetch, reconnect, subscription, AI/sandbox execution, or dashboard fanout behavior.

```text
Application-contract IR / @lumiere/contracts
  typed queries / commands / subscriptions
  capability/entity/schema metadata
  traffic / retry / risk / result semantics
        │
        ├──────────────────────────────┐
        ▼                              ▼
workflow + presentation definitions   WorkProgram registry
  authoritative UI intent               versioned reusable work
  list/detail/form/workflow              code/model/research/docs/actions
  dashboard/report/navigation            typed input/output presentation
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

### 3.4 WorkProgram presentation model

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

### 3.5 Design foundations

Create a renderer-neutral token package containing semantic tokens only:

- spacing;
- typography;
- semantic colors/status;
- density;
- radius;
- motion timing where meaningful;
- breakpoints/categories as semantics, not CSS implementation.

### 3.6 Platform renderers

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

## 8. AI-created work → UI promotion

Make successful agent work a frontend lifecycle:

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

### Phase F0 — inventory and primitives

- [ ] inventory existing page shells, dashboard cards, tables, form frames, detail layouts, action bars, and workflow-specific wrappers;
- [ ] classify each as token / primitive / presentation pattern / domain-specific component;
- [ ] identify duplicated frames whose differences are only layout/transport wiring;
- [ ] define minimal `workflow-core`, `presentation-core`, and `work-program-core` types;
- [ ] define design-token package boundary.

**Exit gate:** one canonical model exists for list, detail, workflow action, metric, dashboard section, report table, program input/run/output intent.

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
- [ ] reserve `WorkProgramSection` support without forcing dynamic program execution into the initial Overview.

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
- [ ] implement native renderers for metric, list, detail, form/action, workflow queue, dashboard sections, ProgramRun, and ProgramOutput;
- [ ] prove Organization Onboarding end-to-end on iOS/Android;
- [ ] render the same Overview Dashboard definition with native composition;
- [ ] implement jittered reconnect/backoff and deliberate background refetch defaults from generated policy;
- [ ] recover ProgramRun state from server after reconnect instead of replaying steps;
- [ ] keep platform-specific navigation and interaction details native.

**Exit gate:** onboarding, Overview and a WorkProgram fixture operate from the same shared definitions on web and Expo without sharing layout components or creating independent transport/retry behavior.

### Phase F4 — reporting + WorkProgram convergence

- [ ] extract repeated report/table/filter patterns;
- [ ] define report input/filter/sort/drill-down semantics;
- [ ] implement ProgramCatalog + ProgramRunForm + ProgramRunProgress + ProgramOutputViewer on web;
- [ ] bind a real published report WorkProgram to module/report placement;
- [ ] support `WorkProgramSection` for last-output/freshness/run-now dashboard presentation;
- [ ] ensure expensive program execution is admission/task-driven rather than render-driven;
- [ ] add export/print capability at the web renderer layer;
- [ ] add mobile drill-down behavior at the native renderer layer;
- [ ] load-test dashboard/program fanout against admission-control budgets.

**Exit gate:** one AI-created report can be published and used as a normal module tool without a bespoke React page.

### Phase F5 — import/document reusable-work proof

- [ ] present a historical Excel/CSV `ImportProposal` through shared program/workflow UI;
- [ ] present a contract/OCR review output through the same ProgramRun/Output primitives;
- [ ] support approval/action-preview handoff into authoritative STDB operations;
- [ ] prove report/import/document programs share version/run/history UI;
- [ ] keep sandbox/provider details absent from renderer packages.

### Phase F6 — program versioning/publishing/placement

- [ ] add version history/diff/publish/deprecate UI;
- [ ] add `Save as reusable tool` promotion from eligible agent results;
- [ ] add module/report/entity/command-palette placement picker;
- [ ] add manual schedule binding UI after runtime automation contract exists;
- [ ] require immutable published version refs for schedules;
- [ ] present compatibility/migration warnings when application-contract changes invalidate a program.

### Phase F7 — legacy frame removal

- [ ] remove duplicated page shells superseded by presentation renderers;
- [ ] remove feature-local table/form/dashboard/program wrappers that encode only reusable composition;
- [ ] retain bespoke domain components where they carry genuine workflow value;
- [ ] add CI/import rules preventing new direct dependencies from feature code into transport, raw generated STDB bindings, Daytona, or model-provider SDKs.

### Phase F8 — renderer independence check

- [ ] serialize representative workflow/presentation/WorkProgram definitions into renderer-neutral fixtures;
- [ ] prove they can be consumed without React assumptions;
- [ ] optionally build a tiny Rust/CLI/native proof consuming the same conceptual contracts;
- [ ] do **not** build a production GPUI client in this phase.

---

## 10. Component composition guidance

Prefer composition primitives over custom page frames.

Good:

```text
Page
  Header
  FilterBar
  EntityList
  Inspector
  WorkflowActions
```

and:

```text
ProgramPage
  ProgramHeader
  ProgramRunForm
  ProgramRunProgress
  ProgramOutputViewer
  RunHistory
```

Avoid creating domain-specific wrappers when they only change labels, spacing, or program placement.

Keep bespoke components when they provide domain-specific interaction, for example:

- warehouse barcode receiving;
- accounting reconciliation canvas;
- manufacturing scheduling board;
- complex drag/drop planning;
- custom analytical visualization.

---

## 11. Required tests

1. shared workflow definitions contain no React/DOM/native imports;
2. presentation/WorkProgram definitions contain no raw transport paths or reducer names;
3. web and Expo renderers can consume the same dashboard and ProgramPresentation definitions;
4. web and Expo actions resolve the same generated contract operations;
5. renderer-specific layout changes do not alter workflow/program semantics;
6. business authorization remains backend-owned;
7. one migrated workflow retains parity with the current web implementation;
8. Overview Dashboard data sources are contract-driven and renderer-independent;
9. shared packages do not import `next`, `react-dom`, `react-native`, Daytona, or model-provider SDKs where prohibited;
10. future non-React consumption remains possible from serialized/typed presentation definitions;
11. Overview does not duplicate identical requests/subscriptions across widgets;
12. reconnect/refetch behavior is bounded under simulated network restoration;
13. 429/503 responses do not trigger uncontrolled immediate retry loops;
14. onboarding resume/replay preserves idempotency and server-authoritative workflow state;
15. published program placement cannot bypass current authorization;
16. dashboard `WorkProgramSection` does not automatically rerun an expensive program on render;
17. ProgramRun resume restores authoritative step/output state rather than replaying blindly;
18. one report/import/document WorkProgram can share common run/output/version UI primitives.

---

## 12. Acceptance criteria

This plan is successful when:

- Next.js remains a first-class dense ERP surface;
- Expo can be added without duplicating workflow/business logic;
- shared frontend architecture centers on workflow/presentation definitions, not universal components;
- runtime reusable work enters the same presentation architecture instead of creating an agent-only frontend island;
- Overview Dashboard proves dashboard/report composition from shared definitions;
- Organization Onboarding proves workflow/state composition from shared definitions;
- one published WorkProgram can appear as a normal module/report/tool surface without bespoke page code;
- report/import/document programs share common UI lifecycle primitives;
- existing stable components are reused behind renderer boundaries rather than rewritten by default;
- contract access stays generated and surface-independent;
- retry/reconnect/fanout/AI-task behavior is contract/admission-driven and bounded across surfaces;
- WorkProgram placement remains presentation intent while STDB/Casbin remain authority;
- a future GPUI/native client would need renderers, not a redesign of workflows or reusable-work semantics.
