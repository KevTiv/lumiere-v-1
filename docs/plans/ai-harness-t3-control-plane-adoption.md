# AI Harness T3-Inspired Control-Plane Adoption Plan

**Status:** Proposed architecture extension; no implementation completion implied.  
**Updated:** 2026-10-27 — §7 adds T3 Code Orchestrator V2 (stable v0.1.0,
2026-10-15; current stable v0.1.1) patterns and a current-state snapshot.  
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
- `pingdotgg/t3code` v0.1.0/v0.1.1 release notes, `docs/user/portable-handoffs.md`,
  `docs/user/outside-agents.md`, and
  `apps/server/src/mcp/toolkits/orchestrator/tools.ts` — Orchestrator V2:
  cross-provider `delegate_task`, server-side steer/queue, usage-limit
  auto-resume, scheduled/webhook tasks, permission inheritance for delegated
  children, budgeted provider handoffs, and an MCP surface for outside agents.

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

From Orchestrator V2 specifically, also do not copy:

- `Full access` as the default mode for new runs or for delegated children;
- mid-run provider switching as a user-facing default — T3 itself documents the
  switch as lossy and steers users to delegation instead (§7.5);
- agent-initiated thread creation with arbitrary provider/model choice — child
  runs choose only among authorized provider instances (§2, §7.4);
- an outside-agent surface that bypasses generated policy (§7.6).

## 7. Adopt from T3 Code Orchestrator V2

Orchestrator V2 (T3 Code v0.1.0, stable 2026-10-15) moves agent coordination
from the client into the server. The items below are the parts that strengthen
Lumiere's governed runtime. Each one rides on the H5c accepted-intent pattern
(§1) and none of them widens authority.

### 7.0 Current-state snapshot (2026-10-27)

Observed in source at `main` 5ada7d0; this is a starting point for the work
below, not an acceptance claim.

| Concept | State |
|---|---|
| `outcome_unknown` effect state (H5c) | Present: spend admission, governed services, restart probe |
| `agent_settled` vs settled (§1) | Present in `orchestrator/run.rs` |
| Steer / interrupt / resume / fork / compare (AIH-20, AIH-24) | Partial: reducers + gateway routes with event cursors, concurrency versions and idempotency |
| Provider driver/instance split (H5d) | Not found; `providers/factory.rs` is a flat `Providers` struct |
| `HarnessDescriptor` (§3) | Partial (branch `feat/harness-descriptor`, not on `main`): gateway route `GET /v1/harness/descriptor` in `ai-gateway/src/routes/harness_descriptor.rs`, gated by the gateway secret plus a current `ai.harness.descriptor.read` actor grant (read-only; in the owner baseline with 1 row / 64 KiB bounds). Flags derive from build admission and config; `proposalWorkspaces`/`specialistDelegation` are `false`. `etag` is content-addressed (equality only, not ordered); clients replace cached state on mismatch. Provider list comes from the flat `Providers` struct with a marked integration point for H5d instances. Not done: BFF route, generated TS type, client consumption, org-specific model-profile providers. `resolve_ai_run_budget_park` requires the separate default-deny `ai.run.budget.resolve` grant (not in the owner baseline) |
| `subscribeRun({ afterSequence })` + shared client runtime (§4) | Not found; lifecycle events carry cursors but no subscription contract |
| AI proposal workspace aggregate (§5) | Not found (the `proposal-workspace` UI is the tenders feature) |
| Server-side follow-up queue (§7.1) | Not found |
| Budget-blocked park/resume (§7.2) | Not found |
| Scheduled/event-triggered governed runs (§7.3) | Not found as governed runs |
| Outside-agent MCP surface (§7.6) | Not found |

### 7.1 Server-side follow-up queue next to steer

T3 V2 lets a user either steer the running turn or queue a follow-up, with the
queue owned by the server so it survives restarts and can be edited and
reordered.

Lumiere already has durable steering (AIH-20). Add a queue for follow-ups that
should run after the current objective settles rather than revise it:

```text
AiRunQueuedInput
  - queued_input_id
  - run_id
  - position / revision
  - author identity (from ctx.sender, never an argument)
  - payload (redacted on read)
  - status: queued | promoted | withdrawn | superseded
  - idempotency key
```

Rules:

- Enqueue, edit, reorder and withdraw are reducers with payload-bound
  idempotency, like the existing steer command.
- Promotion happens only at a settled boundary (`settled`, not merely
  `agent_settled`) and starts a new checked continuation. It reacquires scope
  and budget; it never inherits an approval from the previous turn.
- A queued item is authored input, not authority: it is re-authorized against
  the author's current grants when promoted, and denied if those grants lapsed.
- Steer stays the only way to change the running objective. A queued item never
  interrupts a turn.

### 7.2 Park and resume on budget limits

T3 V2 resumes threads stopped by a provider usage limit once the limit resets.

Lumiere's equivalent is spend admission. Today a budget denial ends the attempt.
Add a parked state instead:

```text
running -> budget_parked(reason, window_resets_at, required_reservation)
budget_parked -> running        (admission succeeds after reset)
budget_parked -> waiting_input  (operator must raise budget or choose)
budget_parked -> terminated     (deadline or operator cancel)
```

Rules:

- Parking happens only at a step boundary where no effect is `dispatched` or
  `outcome_unknown`. An in-flight effect reconciles first (§1).
- The resume trigger is a scheduled reducer at `window_resets_at` that records a
  resume intent; the gateway reactor then re-runs full spend admission. A
  schedule firing grants nothing on its own.
- Provider rate limits (HTTP 429 / retry-after) use the same parked state with a
  provider-supplied reset time, bounded by a maximum park duration.
- Parked runs keep their reservation released; resume reserves again at
  current pricing (pricing snapshot recorded per §2).
- The UI shows parked runs with the reason and expected resume time, separate
  from failed runs.

### 7.3 Scheduled and event-triggered governed runs

T3 V2 adds scheduled tasks and webhook triggers that run on the server.

Several harness programs are naturally scheduled or event-driven:
`daily_briefing`, `low_stock`, `insights_scan`, and finance review. They must
enter through the same governed run pipeline as an interactive run, not through
a side path.

```text
AiRunSchedule
  - schedule_id
  - organization/company scope
  - program / skill reference (generated capability ID)
  - run-as principal: a dedicated service binding, never the creator's session
  - mode profile ceiling (Investigate/Design/Draft only; never Review approval)
  - cadence (SpacetimeDB scheduled table with `ScheduleAt::Time`, re-armed
    after each run, as existing modules already do)
  - budget envelope per run and per period
  - status / last_run_id / next_due
```

Rules:

- The scheduled reducer only records a run-start intent; provider and tool I/O
  happen in the gateway reactor after commit (§1). Reducers stay deterministic.
- Event triggers (record changed, threshold crossed, inbound webhook) are
  recorded as typed trigger events with their source watermark, then start a run
  the same way. Inbound webhooks authenticate at the API layer and never carry
  authority into the run.
- Scheduled runs can only produce answers, reports and action drafts. Any
  consequential effect still waits for human approval.
- Overlap policy is explicit per schedule: skip, queue (§7.1) or coalesce.
- Disabling a schedule, revoking the service binding, or exhausting the period
  budget stops new runs; in-flight runs settle normally.

### 7.4 Delegation invariants (extends AIH-25)

T3 V2's `delegate_task` lets an agent start a child on another provider/model
and wait for the result. Delegated children inherit permission modes unless
overridden, a thread cannot message another thread with broader permissions,
and agents cannot approve their own permission requests.

AIH-25 already plans bounded children. Make these invariants explicit and
testable:

- **Ceiling inheritance:** a child's capability set and mode ceiling are a
  subset of the parent's at the moment of delegation. An override can only
  narrow.
- **No upward messaging:** a run cannot send input to, steer, or promote queued
  input into a run with a broader capability set, scope, or budget.
- **No self-approval:** an approval request created by run R (or any descendant
  of R) can never be satisfied by R, its ancestors, or its descendants. Model
  review is evidence for a human approver, not approval.
- **Cross-instance delegation:** a child may run on a different authorized
  provider instance (§2), for example a cheaper instance drafting and a
  stronger instance reviewing, provided the instance is allowed for the same
  organization, region and budget.
- **Result integration:** child output returns as a typed, evidence-bearing
  result through the durable event boundary, never as free text merged into the
  parent transcript.

### 7.5 Budgeted handoff on provider fallback

When T3 V2 switches provider mid-thread, the new provider receives only a
budgeted selection of messages, not the previous provider's reasoning, tool
calls or attachments.

Once H5d exists, provider fallback between authorized instances needs the same
discipline:

- The handoff carries a deterministic, context-budgeted selection: objective,
  current decision graph state, admitted evidence references and recent turns.
  Evidence travels by reference and is re-authorized for the new instance.
- The run records a `handoff` event naming source and target instance, the
  selection policy, what was dropped, and the token budget used.
- A handoff never carries pending approvals, uncertain effects, or raw provider
  reasoning.
- Fallback that crosses region, organization or policy boundaries is denied
  (§2, H5d acceptance 4), not degraded into a lossy handoff.

### 7.6 Outside-agent access through MCP (deferred)

T3 V2 exposes an MCP server so agents it did not start (Claude Code, Codex in
a terminal) can use its environment once the user approves their sign-in.

For Lumiere this would mean external agents calling governed ERP read tools and
proposing action drafts. It is useful for developers and power users, but it is
also the largest new attack surface in this section. Defer until P1 and treat it
as its own admission:

- every MCP tool maps 1:1 to a generated capability and goes through the same
  policy engine, data-scope resolver, privacy guard and spend admission;
- sessions are scoped, short-lived, revocable, and bound to a human principal;
- MCP clients can create action drafts but never approve them;
- every call is recorded as a run with the external client identified.

## 8. Integration with the existing harness plan

### 7.0 Implementation status

| Item | Status | Present | Remaining |
| --- | --- | --- | --- |
| H5d provider instances + capability truth | Partial (gateway-side library only) | `ai-gateway/src/providers/instance.rs`: `ProviderDriver`, `ProviderInstance`, `CapabilityManifest`, in-memory `ProviderRegistry` (one platform default instance per configured driver from existing env config), selection with org/region/driver/budget-scope policy before cost ordering and a serializable `SelectionRecord` (driver, instance, model, region, policy reason, pricing snapshot ref), authoritative manifest replacement with stale-revision rejection, boundary-denying fallback. `handoff.rs`: pure budgeted handoff (section 7.5). `events.rs`: provider-neutral `ProviderEvent`. Fixtures 4, 5 and 15 plus selection/handoff tests. | The agent loop and `LlmClient` still dispatch through one shared client and do not yet call the registry; instance-to-credential binding (per-instance clients) is not built. `SelectionRecord` and `HandoffRecord` are not persisted (needs a SpacetimeDB table/reducer). No organization-defined instances are loaded (registry holds env defaults only). Pricing snapshots are not yet fed from `ModelProfile`/spend admission. Region/residency policy input is not yet sourced from organization policy. Descriptor route (section 3) not included. |

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
  and parent budget/capability shares; no child inherits approval. Add the
  §7.4 invariants (ceiling inheritance, no upward messaging, no self-approval,
  cross-instance delegation, typed result integration) to its acceptance.
- **AIH-20:** add the §7.1 server-side follow-up queue beside steering.
- **AIH-24:** resume also covers §7.2 `budget_parked` runs.
- **New AIH-27:** scheduled and event-triggered governed runs (§7.3).
- **New AIH-28:** outside-agent MCP surface (§7.6), deferred until after P1.
- **H5d:** budgeted handoff on provider fallback (§7.5) is part of the
  driver/instance work, not a separate milestone.

### H6 pilot gate additions

The pilot cannot be advertised as fully admitted until its declared path proves:

- no side effect can occur before accepted intent is durable;
- duplicate/restarted execution cannot duplicate an effect;
- ambiguous effects reconcile before resume;
- provider selection is bound to an authorized provider instance;
- candidate answer completion is distinct from fully settled run completion;
- descriptor capability claims match the actually admitted path.

## 9. Validation fixtures to add

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
10. **Queue across restart** — queued follow-ups survive a gateway and module
    restart, promote once at a settled boundary, and are re-authorized against
    the author's current grants.
11. **Queue vs steer** — a queued item never interrupts a running turn; a steer
    during a queued backlog revises only the running objective.
12. **Budget park and resume** — a run denied by spend admission parks with an
    expected reset time and resumes once after reset; an effect in flight at the
    limit reconciles before parking.
13. **Schedule fires with revoked binding** — no run starts and the denial is
    recorded; a schedule overlapping its previous run follows its declared
    skip/queue/coalesce policy.
14. **Delegation ceiling** — a child cannot exceed the parent's capabilities,
    scope or budget share; a child cannot steer its parent; no run in a lineage
    can satisfy an approval request raised in that lineage.
15. **Fallback handoff** — fallback to a second authorized instance records a
    handoff event with dropped items and budget; pending approvals and uncertain
    effects never cross; a cross-region fallback is denied.

## 10. Implementation order

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
8. Add the §7.1 follow-up queue and §7.2 budget park/resume on top of the
   existing steer and spend-admission code; both are small once H5c holds.
9. AIH-27 scheduled/event-triggered runs, starting with `daily_briefing` and
   `low_stock` after the H6 pilot is admitted.
10. Keep specialist delegation (with the §7.4 invariants) and lifecycle
    extensions disabled until their existing M8/M9 gates pass.
11. AIH-28 outside-agent MCP surface only after P1, as its own admission.


## Integration readiness — 2026-10-28

PR #291 is stacked on Finance #279 and includes current main. Merge Finance
first, then the harness integration after the combined contracts workflow and
same-head CI/P0 checks pass. The earlier Finance migration 27 stays byte-identical;
the harness delta uses migration 28 (521 tables total). Published archives and
tags are never edited. The gateway parks no run until a production resume
consumer is admitted; current budget/rate-limit errors retain terminal failure
behavior. Provider instances, handoff persistence, descriptor client consumption
and live queue/restart acceptance retain their documented follow-up scope.


### Combined contracts release

[Release run 40653208672](https://github.com/KevTiv/lumiere-v-1/actions/runs/40653208672)
completed successfully and pinned v0.3.154 in `8713f74e6b330997b836b4640da5dd0256f81c6f`.
Both generation passes and fresh post-pin verification passed. Finance migration
27 remains unchanged and the harness delta is migration 28. Source validation
passed 822 gateway tests (eight existing ignored), 136 codegen tests (one existing
ignored), 168 script tests, 12 tenant-ownership tests and both changed-file Rust
formatting checks. Those local test binaries used the Finance v0.3.153 baseline
plus the regenerated reducer contract; hosted CI must validate the final v0.3.154
pin. The PostgreSQL 18 Finance-to-harness upgrade regression passed, preserving
exact rows, previous migration records and replay. The older v13 matrix expected
list must remain sorted when adding the three harness relations.


### Final-pin acceptance

At `4e7dd7ff2a1c4f7d69e51ad5eeece6f20b1daf44`, the complete hosted
[CI run 40656628589](https://github.com/KevTiv/lumiere-v-1/actions/runs/40656628589)
passed, including Rust/gateway, C3/C4/C5, native module/tests, frontend checks and
contracts drift. All ten local PostgreSQL compatibility tests also passed with
the final v0.3.154 pin, using the same serial setting as CI. The disposable local
database was removed after verification.

The base change selected only edited browser specs. PR #291 therefore carries
`e2e:full` to require the complete sharded P0 lane for the final acceptance head.
The targeted run does not establish that full-P0 gate.
