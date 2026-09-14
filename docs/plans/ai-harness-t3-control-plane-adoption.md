# AI Harness T3-Inspired Control-Plane Adoption Plan

**Status:** Proposed architecture extension; no implementation completion implied.  
**Applies to:** H5 onward, before the H6 `low_stock` pilot where noted.  
**Authority:** `ai-harness-completion-plan.md` remains the milestone/acceptance authority; `ai-harness-luna-execution-plan.md` owns active sequencing.

## Purpose

Borrow the parts of T3 Code's architecture that improve durable orchestration,
provider isolation, reconnect/resume behavior, and reviewable workspaces without
copying its coding-agent permission model into the ERP harness.

Lumiere already has the stricter ERP-specific foundations that must remain
canonical: generated IR-owned capabilities, tenant/company authorization,
per-call policy, bounded budgets, action-draft approval, evidence gates, and
normal ERP reducer ownership. This plan changes the harness control plane around
those boundaries; it does not weaken or replace them.

Reference material used for the comparison:

- `pingdotgg/t3code/docs/internals/overview.md` — environment ownership,
  durable intent/events, side-effect reactors, compatibility negotiation, and
  settled-turn semantics.
- `pingdotgg/t3code/docs/internals/connection-runtime.md` — single connection
  owner, replay cursors, reconnect behavior, and transport-vs-data freshness.
- `pingdotgg/t3code/docs/internals/providers.md` — provider adapters,
  driver/instance separation, account isolation, and provider capability truth.

## 1. Adopt: durable intent before external side effects

### Decision

All provider calls and consequential tool effects must follow a common pattern:

```text
command/request
  -> authorize + validate
  -> persist accepted intent / idempotency receipt
  -> commit
  -> effect reactor performs external I/O
  -> result command/event
  -> persist success | failure | outcome-unknown
  -> update run projection
```

Do not perform provider/network/filesystem/desktop-host side effects inside the
same decision/transaction that first records their intent.

This is an extension of the H5 persistence work, not a request to introduce a
second generic event-sourcing framework. Prefer existing SpacetimeDB records,
reducers, run steps, reservation rows, and generated contracts where they can
express the invariant cleanly.

### Required semantics

- An acknowledgement means the intent was durably accepted, not that the effect
  completed.
- Every effect has a stable request/effect ID and idempotency semantics.
- `outcome_unknown` is a first-class durable state for timeout/disconnect cases.
- Recovery of an existing reservation/receipt never authorizes blind redispatch.
- Reconciliation decides whether to settle, retry only when proven safe, require
  operator input, or terminate the run.
- Provider/tool results return through the same durable command/event boundary;
  they do not mutate in-memory run state as an authority bypass.
- Persisted history must remain replayable across compatible contract upgrades.

### Run settlement model

Separate model/agent completion from total run settlement:

```text
running
  -> agent_settled
  -> evidence_validating / artifact_settling / effect_reconciling
  -> settled
```

A provider returning candidate prose does not imply that evidence validation,
artifact persistence, budget settlement, draft persistence, or ambiguous effects
have completed.

### H5c acceptance

Before H6 pilot admission:

1. A persisted provider request survives a process restart and completes once.
2. Duplicate dispatch commands do not duplicate a provider/tool effect.
3. A simulated timeout after the external side may have completed produces
   `outcome_unknown`; recovery does not blindly redispatch.
4. Reconciliation settles the known result or stops with a durable blocker.
5. Run state distinguishes `agent_settled` from fully `settled`.
6. Subscribers only observe committed state transitions.

## 2. Adopt: provider driver and provider instance are different concepts

### Decision

Keep provider protocol normalization behind adapters and distinguish a provider
**driver** from an organization/account-specific **instance**.

```text
ProviderDriver
  - mistral
  - gemini
  - openai_compatible
  - ollama

ProviderInstance
  - id
  - organization_id
  - driver
  - credential_ref
  - endpoint/region
  - allowed_models
  - capability_manifest
  - pricing_snapshot_ref
  - lifecycle/status
```

The agent loop selects an authorized instance. The adapter converts the
provider-neutral request/event contract to that driver's protocol.

### Invariants

- Two instances of the same driver never share mutable account/session/catalog
  state unless an explicitly safe immutable cache is designed for it.
- Provider credentials remain owned by the server-side instance.
- Region/data-residency and organization policy participate in instance
  selection before cost fallback.
- Capabilities describe what the effective provider/model instance can actually
  do; cached capability data cannot silently grant a removed capability.
- Provider-specific question/tool-call/result shapes are normalized at the
  adapter boundary instead of leaking conditionals across orchestration/UI.
- Kong remains transport/proxy configuration. It does not erase the identity of
  the effective provider/model/instance used for policy, cost, and audit.

### H5d acceptance

Before H6 pilot admission where a provider is used:

1. Fixture two same-driver instances and prove account/config state isolation.
2. Selection records driver, instance, model, region/policy reason, and pricing
   snapshot used for budget admission.
3. An authoritative capability removal clears/denies the previously cached
   capability.
4. Provider fallback cannot cross an organization, region, policy, or shared
   budget boundary.
5. Orchestration tests operate on normalized provider commands/events rather
   than branching on provider-specific payloads.

## 3. Adopt: explicit harness/environment capability negotiation

Web, desktop, local/offline, and future customer-managed environments can upgrade
independently. Clients must discover server capabilities rather than infer them
from their own version.

Add a generated/versioned descriptor exposed through the normal authorized API:

```ts
type HarnessDescriptor = {
  contractRelease: string;
  capabilityRegistryHash: string;
  environmentId: string;
  features: {
    toolCalling: boolean;
    resumableRuns: boolean;
    evidenceGate: boolean;
    durableQuestions: boolean;
    proposalWorkspaces: boolean;
    specialistDelegation: boolean;
  };
  providers: ProviderCapabilityDescriptor[];
};
```

Rules:

- Absence of a capability means the client hides/denies that path.
- Downgrade/removal overrides stale cached capability state.
- A descriptor is discovery/compatibility information, never authorization.
- Tool/reducer/resource authorization is still rechecked per invocation.
- New wire fields must remain replay-compatible with persisted history or use an
  explicit migration/compatibility boundary.

This should be available by the H6/H8 transition and is required before claiming
multi-environment client compatibility.

## 4. Adopt: resumable sequence-based run streams

Replace the loose "poll or stream" transcript idea with a durable ordered run
stream backed by persisted run-step/event sequence numbers.

```ts
subscribeRun({ runId, afterSequence })
```

Each visible event carries at least:

```ts
type HarnessRunEvent = {
  runId: string;
  sequence: bigint;
  kind: string;
  occurredAt: string;
  redactedPayload: unknown;
};
```

The exact event taxonomy remains generated/reviewed, but must cover provider
requests/results, tool requests/results, denials, questions, approval waits,
candidate answers, validation outcomes, reconciliation, and terminal state.

### Client-runtime rules

Introduce a shared frontend harness runtime rather than letting each React view
own reconnect/poll logic independently.

- One connection/subscription owner per environment/run scope.
- Cache projection state and replay cursor together only after applying an event.
- Reconnect resumes from the last applied sequence.
- Transport health and data freshness are separate states.
- Reconnection never automatically replays mutations/effects; operation-specific
  idempotency/reconciliation owns that decision.
- Old scopes cannot overwrite newer live state after environment/account changes.

### H8 acceptance

- Disconnect after event N, append N+1..N+k, reconnect with `afterSequence=N`,
  and converge without duplicate UI rows or missed durable state.
- Two mounted consumers share the same run stream rather than creating competing
  reconnect loops.
- A stale cached descriptor or projection cannot overwrite authoritative newer
  server state.

## 5. Adopt by translation: ERP proposal workspaces, not Git worktrees

T3's isolated workspace/checkpoint idea maps well to ERP, but Lumiere must not
pretend posted business state can be rolled back like a Git checkout.

Add a first-class proposal/change-set aggregate for multi-step agent work:

```text
AiProposalWorkspace
  - workspace_id
  - parent_workspace_id?
  - run_id
  - organization/company scope
  - base snapshot/watermarks
  - source/decision refs
  - candidate artifact refs
  - action draft refs
  - checkpoint/version
  - status
```

A workspace may group several proposed effects and artifacts, for example a
stock investigation that yields two stock-adjustment drafts, one purchase-order
draft, and a report. The workspace is reviewable as one coherent proposal while
each consequential ERP effect still follows its own normal approval and reducer
contract.

### Workspace operations

- inspect
- checkpoint/version
- fork
- compare
- attach/detach a draft before approval
- accept/reject a candidate artifact
- close/abandon

### Safety rules

- Forks copy proposal lineage, never execution approval.
- A workspace revert changes proposed state only; it never reverses posted ERP
  state.
- Posted ERP actions require explicit correction/reversal operations already
  admitted by the ERP contract.
- A fork reacquires current scope, evidence authorization, budget, and approval.
- Source/record watermarks are revalidated before approval/execution.

This extends AIH-24 rather than replacing `AiActionDraft`.

## 6. Do not copy from T3 Code

Do not import coding-agent `full access` or broad automatic permission modes.
Lumiere's Investigate/Design/Draft/Review mode profiles are capability ceilings
and UX states only; actual authority remains generated policy + current actor/
organization/company scope + reducer/resource authorization.

Also do not copy:

- unrestricted project filesystem ownership into normal ERP agents;
- ambient provider credentials;
- direct model-controlled terminal/network authority;
- Git-style rollback semantics for committed ERP state;
- client-version assumptions as a security or compatibility boundary.

## 7. Integration with the existing harness plan

### Insert before H6 pilot

**H5c — Durable effect orchestration and reconciliation**

- durable accepted-intent/effect receipts;
- side-effect reactors after commit;
- outcome-unknown/reconciliation flow;
- agent-settled vs fully-settled run status.

**H5d — Provider instance/adapters and capability truth**

- driver/instance split;
- account/region isolation;
- normalized provider events;
- provider capability manifest and selection audit.

These are prerequisites for the H6 `low_stock` pilot when the exercised path
uses provider/effect behavior. They should be implemented as small stacked PRs
on top of the H5 persistence release/pin, not folded into the current H5 source
slice retroactively.

### Extend existing AIH items

- **AIH-7:** sequence-based resumable run stream and shared harness client
  runtime replace unspecified poll/stream ownership.
- **AIH-8/9:** read provider instance/model/cost and terminal settlement state
  from durable projections.
- **AIH-20/23:** questions, steering, compaction, and resume use the same event
  cursor and accepted-intent semantics.
- **AIH-24:** add proposal-workspace checkpoint/fork/compare semantics while
  explicitly excluding rollback of posted ERP state.
- **AIH-25:** specialist child work receives bounded child proposal workspaces
  and parent budget/capability shares; no child inherits approval.

### H6 pilot gate additions

The pilot cannot be advertised as fully admitted until its declared path proves:

- no side effect can occur before accepted intent is durable;
- duplicate/restarted execution cannot duplicate an effect;
- ambiguous effects reconcile before resume;
- provider selection is bound to an authorized provider instance;
- candidate answer completion is distinct from fully settled run completion;
- descriptor capability claims match the actually admitted path.

## 8. Validation fixtures to add

1. **Crash after intent commit / before dispatch** — restart dispatches once.
2. **Crash/timeout after dispatch / before result commit** — mark uncertain and
   reconcile; do not blind-retry.
3. **Duplicate command** — same effect ID yields one external effect.
4. **Provider-instance isolation** — two Gemini/Mistral instances cannot share
   mutable auth/catalog/session state.
5. **Capability downgrade** — cached client/provider capability is removed by an
   authoritative descriptor and the operation becomes unavailable.
6. **Run reconnect** — resume from durable sequence without duplicate/missing
   transcript state.
7. **Agent-settled vs run-settled** — late evidence/artifact/budget work cannot
   make the UI claim the provider is still thinking, and cannot expose an
   unvalidated candidate as final.
8. **Workspace fork** — proposal lineage survives, but permissions, budget,
   evidence authorization and action approvals are reacquired.
9. **Workspace revert** — proposed changes revert; already-posted ERP changes are
   untouched and require explicit correction reducers.

## 9. Implementation order

1. Finish H5b generated schema/bindings/storage/projection/reconstruction,
   immutable contract release/pin, gateway budget routing, and live replay gates.
2. H5c durable effect orchestration + reconciliation.
3. H5d provider driver/instance boundary + capability truth.
4. Evidence foundation and answer/recovery gates continue in parallel where
   contract ownership permits.
5. Admit the H6 `low_stock` pilot against the extended gates.
6. Build the sequence-based H8 run stream/shared client runtime before relying on
   live transcripts across web/desktop/local environments.
7. Extend AIH-24 with proposal workspaces before exposing complex multi-draft
   agent workflows.
8. Keep specialist delegation and lifecycle extensions disabled until their
   existing M8/M9 gates pass.
