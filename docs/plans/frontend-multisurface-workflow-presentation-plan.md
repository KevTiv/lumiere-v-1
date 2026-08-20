# Frontend multi-surface workflow and presentation architecture

**Status:** Proposed — 2026-08-20
**Tracks:** `frontend-architecture`, `workflow-ir`, `presentation-ir`, `nextjs`, `expo`, `gpui-readiness`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [overview-dashboard-subagent-plan.md](./overview-dashboard-subagent-plan.md)

---

## 1. Objective

Make Lumiere's frontend architecture surface-independent enough to support:

- Next.js as the primary dense desktop/web ERP surface;
- Expo / React Native as the mobile and field-work surface;
- a future lean native shell (for example GPUI) without reimplementing business workflows;
- dashboarding, reporting, forms, approvals, list/detail flows, and workflow state using shared behavior and presentation intent rather than copied page implementations.

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

---

## 2. Architectural rules

1. **Share behavior and presentation intent before sharing components.**
2. **Next.js and Expo may use different component implementations.**
3. **No workflow/business decision may exist only inside a React component tree.**
4. **Backend application contracts remain the only data/command source.**
5. **Presentation metadata must not duplicate backend authorization/business logic.**
6. **Platform renderers own layout, accessibility, density, gestures, keyboard behavior, and native interaction details.**
7. **A future non-React renderer must be possible without redesigning the workflow model.**
8. **Custom UI is allowed where a workflow truly benefits from it; metadata-driven rendering is a default, not a prison.**

---

## 3. Layer model

### 3.1 Contracts

Source: generated `@lumiere/contracts` / Rust contract crate.

Owns:

- typed queries;
- typed commands;
- subscriptions;
- operation names;
- transport serialization;
- cache/invalidation metadata.

Does not own presentation.

### 3.2 Workflow model

Framework-neutral definitions describing how users complete domain work.

Example:

```ts
export interface WorkflowDefinition<TState extends string> {
  id: string;
  states: readonly TState[];
  actions: readonly WorkflowActionDefinition[];
  surfaces: WorkflowSurfaceBindings;
}
```

Representative definitions:

- sales order lifecycle;
- purchase approval;
- invoice review;
- inventory receipt;
- CRM follow-up;
- offline changeset review.

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

Create a renderer-neutral token package containing semantic tokens only:

- spacing;
- typography;
- semantic colors/status;
- density;
- radius;
- motion timing where meaningful;
- breakpoints/categories as semantics, not CSS implementation.

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

Optimize for:

- dense data tables;
- keyboard-first workflows;
- split panes;
- drag/drop where useful;
- print/export;
- complex reporting;
- large-screen dashboards;
- accessibility and browser-native behavior.

### Expo / native

Optimize for:

- mobile-first workflows;
- field/warehouse/service tasks;
- camera/document capture;
- offline-first interaction;
- push/deep links;
- step-driven workflows;
- bottom sheets / native navigation;
- adaptive list/detail layouts on tablets.

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

Example target:

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

The renderer decides whether this becomes a web split-pane, mobile stack, tablet master/detail, or future GPUI inspector.

---

## 7. Migration strategy

Do not rewrite all existing UI.

### Phase F0 — inventory and primitives

- [ ] inventory existing page shells, dashboard cards, tables, form frames, detail layouts, action bars, and workflow-specific wrappers;
- [ ] classify each as token / primitive / presentation pattern / domain-specific component;
- [ ] identify duplicated frames whose differences are only layout/transport wiring;
- [ ] define minimal `workflow-core` and `presentation-core` types;
- [ ] define design-token package boundary.

**Exit gate:** one canonical model exists for list, detail, workflow action, metric, dashboard section, and report table intent.

### Phase F1 — web renderer proof

- [ ] implement presentation renderers using existing web components where possible;
- [ ] wrap rather than rewrite stable existing components;
- [ ] prove list/detail/action composition through presentation definitions;
- [ ] ensure direct backend usage remains through generated contracts only.

**Exit gate:** one existing Next.js workflow is rendered from shared workflow/presentation definitions without losing current capability.

### Phase F2 — Overview Dashboard proof

Use the Overview Dashboard sub-plan as the first overall UI architecture proof.

- [ ] model dashboard sections declaratively;
- [ ] reuse existing metrics/reports through generated contracts;
- [ ] implement web renderer;
- [ ] ensure dashboard definitions contain no DOM/CSS-specific layout decisions;
- [ ] define mobile priority/stack behavior in presentation metadata where needed.

### Phase F3 — Expo starter surface

- [ ] add Expo workspace/app;
- [ ] consume the same private contract package;
- [ ] consume shared workflow/presentation definitions;
- [ ] implement native renderers for metric, list, detail, form/action, workflow queue, and dashboard sections;
- [ ] prove one real workflow end-to-end on iOS/Android;
- [ ] keep platform-specific navigation and interaction details native.

**Exit gate:** one workflow and the Overview Dashboard operate from the same shared definitions on web and Expo without sharing layout components.

### Phase F4 — reporting and dashboard composition

- [ ] extract repeated report/table/filter patterns;
- [ ] define report input/filter/sort/drill-down semantics;
- [ ] support responsive dashboard section ordering;
- [ ] add export/print capability at the web renderer layer;
- [ ] add mobile drill-down behavior at the native renderer layer.

### Phase F5 — legacy frame removal

- [ ] remove duplicated page shells superseded by presentation renderers;
- [ ] remove feature-local table/form/dashboard wrappers that encode only reusable composition;
- [ ] retain bespoke domain components where they carry genuine workflow value;
- [ ] add CI/import rules preventing new direct dependencies from feature code into transport or raw generated STDB bindings.

### Phase F6 — renderer independence check

- [ ] serialize a representative workflow/presentation definition into a renderer-neutral test fixture;
- [ ] prove it can be consumed without React assumptions;
- [ ] optionally build a tiny Rust/CLI/native proof consuming the same conceptual contract;
- [ ] do **not** build a production GPUI client in this phase.

---

## 8. Component composition guidance

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

Avoid creating domain-specific wrappers when they only change labels or spacing.

Keep bespoke components when they provide domain-specific interaction, for example:

- warehouse barcode receiving;
- accounting reconciliation canvas;
- manufacturing scheduling board;
- complex drag/drop planning;
- custom analytical visualization.

---

## 9. Required tests

1. shared workflow definitions contain no React/DOM/native imports;
2. presentation definitions contain no raw transport paths or reducer names;
3. web and Expo renderers can consume the same dashboard definition;
4. web and Expo actions resolve the same generated contract operations;
5. renderer-specific layout changes do not alter workflow semantics;
6. business authorization remains backend-owned;
7. one migrated workflow retains parity with the current web implementation;
8. Overview Dashboard data sources are contract-driven and renderer-independent;
9. shared packages do not import `next`, `react-dom`, or `react-native`;
10. future non-React consumption remains possible from serialized/typed presentation definitions.

---

## 10. Acceptance criteria

This plan is successful when:

- Next.js remains a first-class dense ERP surface;
- Expo can be added without duplicating workflow/business logic;
- shared frontend architecture centers on workflow/presentation definitions, not universal components;
- Overview Dashboard proves dashboard/report composition from shared definitions;
- existing stable components are reused behind renderer boundaries rather than rewritten by default;
- repeated custom page frames are reduced materially;
- contract access stays generated and surface-independent;
- a future GPUI/native client would need a renderer, not a redesign of the application workflow model.
