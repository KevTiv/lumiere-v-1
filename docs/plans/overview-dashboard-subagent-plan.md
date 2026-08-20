# Overview Dashboard subagent plan

**Status:** Proposed — 2026-08-20
**Parent:** [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md)

## Mission

Use the Overview Dashboard as the first **presentation/reporting** proof of the multi-surface frontend architecture. It must be a framework-neutral dashboard definition rendered by Next.js first and Expo second, not a bespoke page.

The dashboard should answer, in order: what needs attention now, which queues are blocked, what changed, what is performing well or poorly, and where the user should drill down next.

## Starter composition

Keep the first version deliberately small:

- attention/exceptions;
- actionable work queues;
- 3–5 cross-functional health metrics;
- 1–2 compact trends;
- recent activity / drill-down.

Candidate metrics/queues include approvals waiting, overdue receivables, open orders, inventory exceptions, workflow backlog, sales/revenue trend, and offline changesets awaiting review.

## Canonical model

```ts
export interface DashboardDefinition {
  id: string;
  title: string;
  sections: readonly DashboardSection[];
}

export interface DashboardSectionBase {
  id: string;
  title?: string;
  priority: number;
  visibility?: PresentationVisibility;
  navigation?: NavigationIntent;
}

export type DashboardSection =
  | MetricGroupSection
  | WorkflowQueueSection
  | TimeSeriesSection
  | ExceptionListSection
  | ActivitySection
  | ReportTableSection;
```

Do not encode CSS grid coordinates, React component references, raw URLs, reducer names, or business authorization in dashboard metadata.

## Data rules

- all data comes through generated application contracts;
- visibility metadata may describe presentation capability, but backend authorization remains authoritative;
- each drill-down/action resolves a typed navigation or application intent;
- loading, stale, error, empty, and partial states are first-class;
- metric formatting is semantic (currency, duration, count, percentage), not renderer-specific styling.

## Web proof

- reuse existing web KPI/table/chart components behind renderers where suitable;
- support dense desktop layout and keyboard navigation;
- allow renderer-owned responsive/resizable composition;
- avoid rewriting stable visual components solely for architectural purity.

## Expo proof

- consume the exact same dashboard definition;
- stack sections by semantic priority;
- allow cards to drill into native screens/sheets;
- do not attempt to mirror the desktop grid pixel-for-pixel.

## Investigation tasks

1. inventory the current Overview/dashboard implementation and all data sources;
2. classify current cards as metric, queue, exception, trend, activity, or bespoke;
3. find duplicated dashboard/card shells that can become renderer primitives;
4. identify metrics currently computed in presentation code and move their authoritative definition to the proper application/query contract where needed;
5. identify any raw transport/reducer usage that Phase 0.5 must migrate;
6. propose the smallest useful initial Overview composition for an organization admin/operator.

## Acceptance criteria

- the Overview Dashboard is described by renderer-neutral definitions;
- Next.js renders it without losing current useful behavior;
- the same definition can drive an Expo layout;
- data/actions use generated contracts only;
- no dashboard metadata duplicates authorization/business logic;
- at least one actionable workflow queue is present, so the dashboard is operational rather than a KPI wall;
- renderer-specific layout can change without changing dashboard semantics.
