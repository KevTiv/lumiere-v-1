# Overview Dashboard subagent plan

**Status:** Proposed — 2026-08-20
**Parent:** [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md)
**Related:** [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

## Mission

Use the Overview Dashboard as the first **presentation/reporting** proof of the multi-surface frontend architecture. It must be a framework-neutral dashboard definition rendered by Next.js first and Expo second, not a bespoke page.

The dashboard should answer, in order: what needs attention now, which queues are blocked, what changed, what is performing well or poorly, and where the user should drill down next.

It must also prove that dashboard composition does not become a traffic footgun: shared data dependencies are coalesced, expensive sections are staged/lazy-loaded when appropriate, redundant subscriptions are avoided, and generated traffic/retry policy is respected.

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

## Data and traffic rules

- all data comes through generated application contracts;
- visibility metadata may describe presentation capability, but backend authorization remains authoritative;
- each drill-down/action resolves a typed navigation or application intent;
- loading, stale, error, empty, partial, throttled, and temporarily-unavailable states are first-class;
- metric formatting is semantic (currency, duration, count, percentage), not renderer-specific styling;
- identical operations across multiple sections must share/coalesce the same query/subscription where semantics permit;
- expensive durable/report sections should not all execute at initial render unless their traffic class/budget explicitly permits it;
- dashboard sections must not override generated retry/backoff semantics;
- 429/503 is rendered as recoverable capacity state and must not trigger immediate retry loops;
- mobile/background resume must not refetch every section simultaneously without jitter/staging.

## Web proof

- reuse existing web KPI/table/chart components behind renderers where suitable;
- support dense desktop layout and keyboard navigation;
- allow renderer-owned responsive/resizable composition;
- avoid rewriting stable visual components solely for architectural purity;
- verify one dashboard render cannot accidentally open duplicate identical subscriptions.

## Expo proof

- consume the exact same dashboard definition;
- stack sections by semantic priority;
- allow cards to drill into native screens/sheets;
- do not attempt to mirror the desktop grid pixel-for-pixel;
- use generated reconnect/backoff semantics after app/network resume;
- stage lower-priority/expensive sections where appropriate.

## Investigation tasks

1. inventory the current Overview/dashboard implementation and all data sources;
2. classify current cards as metric, queue, exception, trend, activity, or bespoke;
3. find duplicated dashboard/card shells that can become renderer primitives;
4. identify metrics currently computed in presentation code and move their authoritative definition to the proper application/query contract where needed;
5. identify any raw transport/reducer usage that Phase 0.5 must migrate;
6. identify duplicate queries/subscriptions currently issued by independent widgets;
7. classify each dashboard operation by generated traffic class and expected cost;
8. propose the smallest useful initial Overview composition for an organization admin/operator.

## Required tests

1. the same operation referenced by multiple widgets is coalesced where semantics permit;
2. expensive dashboard sections respect staged/lazy execution policy;
3. 429/503 responses do not create immediate retry storms;
4. reconnect/background resume does not trigger simultaneous unbounded fanout;
5. dashboard actions still resolve the correct generated operation/navigation intents.

## Acceptance criteria

- the Overview Dashboard is described by renderer-neutral definitions;
- Next.js renders it without losing current useful behavior;
- the same definition can drive an Expo layout;
- data/actions use generated contracts only;
- no dashboard metadata duplicates authorization/business logic;
- at least one actionable workflow queue is present, so the dashboard is operational rather than a KPI wall;
- renderer-specific layout can change without changing dashboard semantics;
- duplicate data dependencies are coalesced and traffic behavior is bounded under normal, reconnect, and degraded-backend scenarios.
