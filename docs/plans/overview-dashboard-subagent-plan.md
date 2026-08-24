# Overview Dashboard subagent plan

**Status:** Proposed — 2026-08-24
**Parent:** [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md)
**Related:** [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md) · [work-program-ui-harness-convergence-plan.md](./work-program-ui-harness-convergence-plan.md) · [agent-performance-admission-cost-plan.md](./agent-performance-admission-cost-plan.md)

## Mission

Use the Overview Dashboard as the first **presentation/reporting** proof of the multi-surface frontend architecture. It must be a framework-neutral dashboard definition rendered by Next.js first and Expo second, not a bespoke page.

The dashboard should answer, in order: what needs attention now, which queues are blocked, what changed, what is performing well or poorly, and where the user should drill down next.

It must also prove two convergence properties:

1. dashboard composition does not become a traffic footgun: shared data dependencies are coalesced, expensive sections are staged/lazy-loaded when appropriate, redundant subscriptions are avoided, and generated traffic/retry policy is respected;
2. a published reusable `WorkProgram` can surface as a normal dashboard/report affordance without making dashboard rendering itself an implicit AI/sandbox execution trigger.

## Starter composition

Keep the first version deliberately small:

- attention/exceptions;
- actionable work queues;
- 3–5 cross-functional health metrics;
- 1–2 compact trends;
- recent activity / drill-down.

Candidate metrics/queues include approvals waiting, overdue receivables, open orders, inventory exceptions, workflow backlog, sales/revenue trend, and offline changesets awaiting review.

After the basic dashboard proof is stable, add one `WorkProgramSection` proof using a published report program. A farm/manufacturing management report is a representative candidate because it combines ERP evidence, sandbox analysis, external research and a durable report artifact without changing dashboard authority semantics.

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
  | ReportTableSection
  | WorkProgramSection;

export interface WorkProgramSection extends DashboardSectionBase {
  kind: "work-program";
  program: WorkProgramRef;
  presentation: "latest-output" | "status" | "run-action";
  freshness?: FreshnessPresentation;
}
```

Do not encode CSS grid coordinates, React component references, raw URLs, reducer names, business authorization, model providers, or sandbox providers in dashboard metadata.

## WorkProgram dashboard semantics

A `WorkProgramSection` is a presentation binding, not an execution engine.

Preferred default:

```text
dashboard render
  ↓
resolve published program binding + last verified output metadata
  ↓
show latest artifact/freshness/run status
  ↓
optional explicit Run now intent
  ↓
Agent/WorkProgram execution admission
```

Avoid:

```text
dashboard render
  ↓
start model
  ↓
start sandbox
  ↓
run report automatically
```

The section may present:

```text
last successful output
freshness timestamp
last/next scheduled run
program status
artifact drill-down
explicit run-now action
```

If no valid output exists, render an empty/not-yet-run state rather than silently running expensive work.

## Data and traffic rules

- all authoritative ERP data comes through generated application contracts;
- WorkProgram outputs come through typed ProgramRun/artifact contracts rather than direct sandbox access;
- visibility metadata may describe presentation capability, but backend authorization remains authoritative;
- each drill-down/action resolves a typed navigation/application/program intent;
- loading, stale, error, empty, partial, throttled, queued, and temporarily-unavailable states are first-class;
- metric formatting is semantic (currency, duration, count, percentage), not renderer-specific styling;
- identical operations across multiple sections must share/coalesce the same query/subscription where semantics permit;
- expensive durable/report sections should not all execute at initial render unless their traffic class/budget explicitly permits it;
- `WorkProgramSection` uses latest persisted verified output by default and does not implicitly rerun the program;
- explicit reruns pass through the AI performance/admission controller;
- dashboard sections must not override generated retry/backoff semantics;
- 429/503 is rendered as recoverable capacity state and must not trigger immediate retry loops;
- mobile/background resume must not refetch every section or restart ProgramRuns simultaneously without jitter/staging.

## Web proof

- reuse existing web KPI/table/chart/report components behind renderers where suitable;
- support dense desktop layout and keyboard navigation;
- allow renderer-owned responsive/resizable composition;
- avoid rewriting stable visual components solely for architectural purity;
- verify one dashboard render cannot accidentally open duplicate identical subscriptions;
- render one `WorkProgramSection` from shared metadata using latest output/status plus explicit run action;
- drill into ProgramRun/output/version UI rather than creating a dashboard-specific AI experience.

## Expo proof

- consume the exact same dashboard definition;
- stack sections by semantic priority;
- allow cards to drill into native screens/sheets;
- render the same `WorkProgramSection` semantics using native program-output/progress views;
- do not attempt to mirror the desktop grid pixel-for-pixel;
- use generated reconnect/backoff semantics after app/network resume;
- stage lower-priority/expensive sections where appropriate;
- app resume queries current ProgramRun/output state and never restarts an expensive run automatically.

## Investigation tasks

1. inventory the current Overview/dashboard implementation and all data sources;
2. classify current cards as metric, queue, exception, trend, activity, or bespoke;
3. find duplicated dashboard/card shells that can become renderer primitives;
4. identify metrics currently computed in presentation code and move their authoritative definition to the proper application/query contract where needed;
5. identify any raw transport/reducer usage that Phase 0.5 must migrate;
6. identify duplicate queries/subscriptions currently issued by independent widgets;
7. classify each dashboard operation by generated traffic class and expected cost;
8. propose the smallest useful initial Overview composition for an organization admin/operator;
9. define `WorkProgramSection` binding/freshness/status semantics without provider/runtime leakage;
10. select one published report WorkProgram as the convergence proof after the base dashboard is stable;
11. prove latest-output rendering does not create an implicit sandbox/model run;
12. classify explicit program rerun traffic through the AI admission/cost plan.

## Required tests

1. the same operation referenced by multiple widgets is coalesced where semantics permit;
2. expensive dashboard sections respect staged/lazy execution policy;
3. 429/503 responses do not create immediate retry storms;
4. reconnect/background resume does not trigger simultaneous unbounded fanout;
5. dashboard actions still resolve the correct generated operation/navigation intents;
6. a `WorkProgramSection` render does not start a new ProgramRun;
7. latest program output displays explicit freshness/version metadata;
8. explicit Run now creates one typed program intent and passes through admission rather than bypassing it;
9. web and Expo render the same WorkProgram section semantics without sharing layout code;
10. program authorization/placement changes do not become client-side authority.

## Acceptance criteria

- the Overview Dashboard is described by renderer-neutral definitions;
- Next.js renders it without losing current useful behavior;
- the same definition can drive an Expo layout;
- data/actions use generated contracts only;
- no dashboard metadata duplicates authorization/business logic;
- at least one actionable workflow queue is present, so the dashboard is operational rather than a KPI wall;
- one published WorkProgram can be represented through shared dashboard presentation intent after the base proof;
- the dashboard can show latest verified WorkProgram output/status without rerunning the program;
- explicit WorkProgram execution remains task/admission driven;
- renderer-specific layout can change without changing dashboard/program semantics;
- duplicate data dependencies are coalesced and traffic behavior is bounded under normal, reconnect, AI-capacity, and degraded-backend scenarios.
