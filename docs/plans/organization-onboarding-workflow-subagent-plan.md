# Organization Onboarding workflow subagent plan

**Status:** Proposed — 2026-08-20
**Parent:** [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md)
**Related:** [traffic-resilience-admission-control-plan.md](./traffic-resilience-admission-control-plan.md)

## Mission

Use organization onboarding as the first **workflow** proof of the multi-surface frontend architecture. It should exercise step/state progression, forms, validation, permissions, resumability, recovery, navigation intents, generated application contracts, and safe retry/admission behavior across Next.js and Expo without embedding workflow semantics in either renderer.

## Why onboarding

Onboarding is a stronger workflow test than a dashboard because it naturally exercises:

- multi-step state transitions;
- partial completion and resume;
- validation and backend rejection;
- role/capability-dependent steps;
- organization-scoped setup;
- asynchronous side effects;
- error/retry/recovery paths;
- web versus mobile navigation differences;
- completion handoff into the normal ERP workspace.

It is also a useful resilience proof because provisioning/activation commands must not be duplicated by retries, refreshes, app resume, or offline replay.

## Starter workflow

The exact steps must be reconciled with the existing onboarding implementation, but the shared workflow model should support a flow such as:

```text
organization identity
      ↓
company / operating profile
      ↓
country / locale / currency
      ↓
admin + team setup
      ↓
core module preferences
      ↓
durable tenant placement / backend provisioning status
      ↓
review
      ↓
activate organization
```

Do not invent new business requirements merely to fit this sequence. The subagent must map the existing backend/onboarding truth into the workflow model.

## Canonical workflow model

```ts
export interface WorkflowDefinition<TState extends string> {
  id: string;
  states: readonly TState[];
  steps: readonly WorkflowStepDefinition[];
  actions: readonly WorkflowActionDefinition[];
  recovery: WorkflowRecoveryDefinition;
  completion: NavigationIntent;
}

export interface WorkflowStepDefinition {
  id: string;
  title: string;
  fields?: readonly FieldPresentation[];
  actions: readonly ActionIntent[];
  visibility?: PresentationVisibility;
}
```

The shared definition may describe fields, semantic validation presentation, available actions, progress, and navigation intent. It must not reproduce authoritative validation, permissions, tenant placement logic, activation rules, quota/admission identity, or retry semantics owned by generated contracts/server policy.

## Contract integration

- every mutation maps to a generated named command operation;
- reads/provisioning status map to generated queries/subscriptions;
- no raw reducer strings, transport URLs, or positional arrays in feature code;
- frontend validation is ergonomic only; reducer validation remains authoritative;
- durable tenant placement remains runtime backend configuration and is never selected by the client;
- provisioning/activation operations declare explicit idempotency/retry semantics;
- onboarding feature code must not add independent mutation retry loops.

## Resumability

Onboarding must be resumable from authoritative server state.

```text
open onboarding
    ↓
query current workflow state
    ↓
render current valid step
    ↓
command
    ↓
STDB state transition
    ↓
subscription/query refresh
```

Do not make the client-local step index authoritative.

Refresh/reconnect should recover current state rather than blindly replay the last mutation.

## Web renderer proof

- desktop stepper or split-pane composition is renderer-owned;
- support keyboard/form-heavy input efficiently;
- preserve deep-link/resume behavior where appropriate;
- reuse existing form primitives behind the renderer;
- duplicate submit gestures are disabled/debounced locally while server idempotency remains authoritative.

## Expo renderer proof

- native stack/step flow;
- mobile-friendly forms and keyboard handling;
- optional camera/document/location affordances only where real onboarding requirements justify them;
- preserve the same workflow state/actions as web;
- allow interruption and resume without local workflow divergence;
- reconnect/app resume uses jittered/bounded query refresh and never blindly replays activation/provisioning commands.

## Investigation tasks

1. inventory existing organization onboarding pages/components/actions and backend reducers;
2. identify all current local-only step state and hardwired defaults;
3. map each step to generated queries/commands/subscriptions;
4. identify validation duplicated in UI versus authoritative reducer validation;
5. identify setup/provisioning steps that need explicit asynchronous states;
6. define recovery behavior for failed provisioning, stale state, duplicate submission, and interrupted onboarding;
7. identify reusable form/step/action-shell composition that should move behind presentation renderers;
8. prove organization durable-store placement is fully backend-owned during onboarding;
9. classify onboarding operations by traffic class/idempotency requirements;
10. identify any current retry/refetch behavior that could duplicate provisioning or activation side effects.

## Required tests

1. refresh/restart resumes from authoritative onboarding state;
2. web and Expo consume the same workflow definition and generated operations;
3. renderer navigation cannot skip an invalid backend state transition;
4. duplicate command submission is safe/idempotent where required;
5. backend validation errors map to stable field/workflow errors;
6. organization activation cannot occur before required reducer-owned prerequisites;
7. tenant PG placement is never caller-selectable;
8. no raw transport/reducer strings remain in migrated onboarding feature code;
9. completion navigation is renderer-specific while completion semantics are shared;
10. app/network reconnect never blindly replays a state-changing onboarding command;
11. 429/503 admission responses become recoverable workflow states rather than immediate retry loops.

## Acceptance criteria

- organization onboarding is driven by a renderer-neutral workflow definition;
- workflow progress derives from STDB state rather than client-only step state;
- Next.js and Expo can present different UX while invoking identical generated operations;
- failures are recoverable and resumable;
- business validation and authorization remain reducer-owned;
- provisioning/activation retry behavior is explicitly idempotent and admission-aware;
- onboarding proves the workflow abstraction while Overview Dashboard proves the presentation/reporting abstraction.
