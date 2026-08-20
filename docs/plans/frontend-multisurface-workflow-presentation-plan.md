# Frontend multi-surface workflow and presentation architecture

**Status:** Proposed — 2026-08-20
**Tracks:** `frontend-architecture`, `workflow-ir`, `presentation-ir`, `nextjs`, `expo`, `gpui-readiness`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [overview-dashboard-subagent-plan.md](./overview-dashboard-subagent-plan.md) · [organization-onboarding-workflow-subagent-plan.md](./organization-onboarding-workflow-subagent-plan.md)

---

## 1. Objective

Make Lumiere's frontend architecture surface-independent enough to support:

- Next.js as the primary dense desktop/web ERP surface;
- Expo / React Native as the mobile and field-work surface;
- a future lean native shell (for example GPUI) without reimplementing business workflows;
- dashboarding, reporting, forms, approvals, list/detail flows, onboarding, and workflow state using shared behavior and presentation intent rather than copied page implementations.

The goal is **not** one universal component tree. The goal is one shared application/workflow/presentation model with platform-specific renderers.

```text
@lumiere/contracts
  typed queries / commands / subscriptions
        │
        ▼
workflow + presentation definitions
        │
        ├── workflow state / actions / permissions
        ├── list/detail/form intent
        ├── dashboard/report definitions
        └── navigation / action semantics
        │
        ▼
platform renderer
   ├── Next.js / React DOM
   ├── Expo / React Native
   └── future GPUI / Rust
```

Two complementary proofs anchor the architecture:

```text
Organization Onboarding
  -> workflow/state/form/resume proof

Overview Dashboard
  -> dashboard/report/composition proof
```

---

## 2. Architectural rules

1. **Share behavior and presentation intent before sharing components.**
2. **Next.js and Expo may use different component implementations.**
3. **No workflow/business decision may exist only inside a React component tree.**
4. **Backend application contracts remain the only data/command source.**
5. **Presentation metadata must not duplicate backend authorization/business logic.**
6. **Workflow progress must derive from authoritative application state, not renderer-local step indexes.**
7. **Platform renderers own layout, accessibility, density, gestures, keyboard behavior, navigation mechanics, and native interaction details.**
8. **A future non-React renderer must be possible without redesigning the workflow model.**
9. **Custom UI is allowed where a workflow truly benefits from it; metadata-driven rendering is a default, not a prison.**

---

## 3. Layer model

### 3.1 Contracts

Source: generated `@lumiere/contracts` / Rust contract crate.

Owns typed queries, commands, subscriptions, operation names, transport serialization, and cache/invalidation metadata. It does not own presentation or workflow policy.

### 3.2 Workflow model

Framework-neutral definitions describing how users complete domain work.

```ts
export interface WorkflowDefinition<TState extends string> {
  id: string;
  states: readonly TState[];
  steps?: readonly WorkflowStepDefinition[];
  actions: readonly WorkflowActionDefinition[];
  surfaces: WorkflowSurfaceBindings;
}
```

Representative definitions include organization onboarding, sales order lifecycle, purchase approval, invoice review, inventory receipt, CRM follow-up, and offline changeset review.

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

### 3.4 Design foundations

Create a renderer-neutral token package containing semantic spacing, typography, colors/status, density, radius, motion timing where meaningful, and breakpoint/category semantics rather than CSS implementation details.

### 3.5 Platform renderers

Target package boundaries:

```text
packages/
  workflow-core/
  presentation-core/
  design-tokens/
  ui-web/
  ui-native/
```

Future optional:

```text
crates/
  lumiere-workflow/
  lumiere-presentation/
  lumiere-gpui/
```

Do not force React packages into the Rust/native path.

---

## 4. Surface responsibilities

### Next.js / web

Optimize for dense data tables, keyboard-first workflows, split panes, drag/drop where useful, print/export, complex reporting, large-screen dashboards, and browser accessibility.

### Expo / native

Optimize for mobile-first workflows, field/warehouse/service tasks, offline interaction, push/deep links, step-driven workflows, native navigation/sheets, and adaptive list/detail layouts on tablets.

### Future GPUI/native desktop

Optimize for low-memory fast startup, native virtualization, command-palette/keyboard usage, multi-pane workspace, and long-lived operational sessions.

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
  | ReportTableSection;
```

Renderers decide layout:

```text
web      -> responsive/resizable grid
mobile   -> stacked priority-ordered sections
native   -> touch-first cards / drill-down
future   -> pane-based native workspace
```

Do not encode CSS grid positions as canonical dashboard semantics.

---

## 6. Workflow composition model

Organization onboarding is the first workflow proof because it exercises forms, state transitions, resumability, validation, backend provisioning status, and renderer-specific navigation.

Target shape:

```ts
const organizationOnboarding = defineWorkflow({
  id: "organization.onboarding",
  states: ["draft", "profile", "team", "provisioning", "review", "active"],
  actions: {
    saveProfile: contracts.organization.onboarding.saveProfile,
    inviteTeam: contracts.organization.onboarding.inviteTeam,
    continue: contracts.organization.onboarding.continue,
    activate: contracts.organization.onboarding.activate,
  },
  surfaces: {
    form: organizationOnboardingForm,
    progress: organizationOnboardingProgress,
    completion: organizationWorkspaceIntent,
  },
});
```

The exact states/actions must follow existing backend truth; the frontend model must not invent business transitions. The renderer decides whether this becomes a web stepper/split-pane, mobile native stack, tablet adaptive flow, or future GPUI inspector.

---

## 7. Migration strategy

Do not rewrite all existing UI.

### Phase F0 — inventory and primitives

- [ ] inventory existing page shells, onboarding frames, dashboard cards, tables, form frames, detail layouts, action bars, and workflow-specific wrappers;
- [ ] classify each as token / primitive / presentation pattern / workflow primitive / domain-specific component;
- [ ] identify duplicated frames whose differences are only layout/transport wiring;
- [ ] define minimal `workflow-core` and `presentation-core` types;
- [ ] define design-token package boundary.

**Exit gate:** one canonical model exists for workflow step/action/progress, list, detail, metric, dashboard section, navigation intent, and report table intent.

### Phase F1 — web renderer proof

- [ ] implement presentation/workflow renderers using existing web components where possible;
- [ ] wrap rather than rewrite stable existing components;
- [ ] prove list/detail/action/form composition through shared definitions;
- [ ] ensure direct backend usage remains through generated contracts only.

### Phase F2A — Organization Onboarding workflow proof

Use `organization-onboarding-workflow-subagent-plan.md`.

- [ ] map existing onboarding reducers/queries and current UI steps;
- [ ] make authoritative workflow state resumable from STDB-backed contracts;
- [ ] model step/form/action/progress/navigation semantics framework-neutrally;
- [ ] render the workflow through Next.js using existing form primitives where suitable;
- [ ] remove client-only workflow authority and raw transport/reducer usage from the migrated flow;
- [ ] prove retry/recovery/idempotency for interruption and provisioning failure.

**Exit gate:** onboarding can refresh/restart and resume from authoritative state; renderer navigation cannot bypass reducer-owned transitions.

### Phase F2B — Overview Dashboard presentation proof

Use `overview-dashboard-subagent-plan.md`.

- [ ] model dashboard sections declaratively;
- [ ] reuse existing metrics/reports through generated contracts;
- [ ] include at least one actionable workflow queue;
- [ ] implement web renderer;
- [ ] ensure dashboard definitions contain no DOM/CSS-specific layout decisions;
- [ ] define mobile priority/stack behavior semantically where needed.

**Exit gate:** Overview is useful operationally and is rendered from a framework-neutral dashboard definition.

### Phase F3 — Expo starter surface

- [ ] add Expo workspace/app;
- [ ] consume the same private contract package;
- [ ] consume shared workflow/presentation definitions;
- [ ] implement native renderers for metric, list, detail, form/action, workflow progress, workflow queue, and dashboard sections;
- [ ] implement Organization Onboarding end-to-end on iOS/Android;
- [ ] render Overview Dashboard from the same definition;
- [ ] keep platform-specific navigation and interaction details native.

**Exit gate:** Organization Onboarding and Overview Dashboard both operate from the same shared definitions on web and Expo without sharing layout components.

### Phase F4 — reporting and dashboard composition

- [ ] extract repeated report/table/filter patterns;
- [ ] define report input/filter/sort/drill-down semantics;
- [ ] support responsive dashboard section ordering;
- [ ] add export/print capability at the web renderer layer;
- [ ] add mobile drill-down behavior at the native renderer layer.

### Phase F5 — legacy frame removal

- [ ] remove duplicated page/onboarding/dashboard shells superseded by presentation/workflow renderers;
- [ ] remove feature-local table/form/dashboard wrappers that encode only reusable composition;
- [ ] retain bespoke domain components where they carry genuine workflow value;
- [ ] add CI/import rules preventing new direct dependencies from feature code into transport or raw generated STDB bindings.

### Phase F6 — renderer independence check

- [ ] serialize representative onboarding workflow and dashboard definitions into renderer-neutral test fixtures;
- [ ] prove they can be consumed without React assumptions;
- [ ] optionally build a tiny Rust/CLI/native proof consuming the same conceptual contract;
- [ ] do **not** build a production GPUI client in this phase.

---

## 8. Component composition guidance

Prefer composition primitives over custom page frames.

```text
Page
  Header
  Progress / FilterBar
  Content
  Inspector
  WorkflowActions
```

Avoid domain-specific wrappers when they only change labels or spacing. Keep bespoke components when they provide domain-specific interaction such as warehouse barcode receiving, accounting reconciliation, manufacturing scheduling, complex planning, or specialized analytical visualization.

---

## 9. Required tests

1. shared workflow definitions contain no React/DOM/native imports;
2. presentation definitions contain no raw transport paths or reducer names;
3. onboarding progress derives from authoritative application state;
4. web and Expo renderers can consume the same onboarding workflow definition;
5. web and Expo renderers can consume the same dashboard definition;
6. web and Expo actions resolve the same generated contract operations;
7. renderer-specific layout/navigation changes do not alter workflow semantics;
8. business authorization and validation remain backend-owned;
9. onboarding survives refresh/interruption and resumes correctly;
10. Overview Dashboard data sources are contract-driven and renderer-independent;
11. shared packages do not import `next`, `react-dom`, or `react-native`;
12. future non-React consumption remains possible from serialized/typed workflow/presentation definitions.

---

## 10. Acceptance criteria

This plan is successful when:

- Next.js remains a first-class dense ERP surface;
- Expo can be added without duplicating workflow/business logic;
- shared frontend architecture centers on workflow/presentation definitions, not universal components;
- Organization Onboarding proves stateful/resumable workflow composition from shared definitions;
- Overview Dashboard proves dashboard/report composition from shared definitions;
- existing stable components are reused behind renderer boundaries rather than rewritten by default;
- repeated custom page frames are reduced materially;
- contract access stays generated and surface-independent;
- a future GPUI/native client would need a renderer, not a redesign of the application workflow model.
