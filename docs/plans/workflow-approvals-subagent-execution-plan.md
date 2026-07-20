# Workflow and approvals sub-agent execution plan

**Source:** [`../WORKFLOW_APPROVALS_INVESTIGATION.md`](../WORKFLOW_APPROVALS_INVESTIGATION.md)  
**Functional plan:** [`workflow-approvals-gap-fixes-plan.md`](./workflow-approvals-gap-fixes-plan.md)  
**Baseline:** pre-production v1; development data is disposable

## Objective and fixed decisions

Use parallel sub-agents to replace the current workflow and approval scaffolding with the final v1 engine. There is no production data migration, compatibility window, shadow engine, legacy drain, deprecated API, or rollback to the old runtime.

The following decisions are locked before implementation:

- Replace the existing tables/reducers in place and use final unsuffixed names. Do not create a parallel `v2` engine.
- Rebuild development/test databases from seeds after schema changes.
- Authoritative definition/runtime/history/outbox tables are private where SpacetimeDB permits it; clients use organization/company/identity-filtered BFF read models and bounded subscriptions.
- Published workflow versions are immutable and content-hashed. Instances pin a version.
- Every state command carries `expected_revision` and an idempotency key. Same key + same canonical input returns the original receipt; the same key + different input fails.
- Conditions use a bounded typed instruction program, never arbitrary code, SQL, JSON expressions or reducer names.
- Human approvals execute registered domain adapters in the same reducer transaction. External effects use timer/outbox records and a durable worker.
- Delivery is at least once; exactly-once business effects come from semantic receipts and provider idempotency keys.
- The generic queue is replaced in place with leases, attempts, backoff and dead-letter handling; all current callers are updated in the same wave.
- Workflow calendars and geography packs are immutable/versioned and separate from mutable PSA/HR calendars.
- No current-data migration is built. Version-to-version migration of future active instances remains a competitive workflow feature.

## Agent operating rules

The root/integration agent is always the fourth slot; run at most three implementation sub-agents concurrently.

1. Agents work only in their assigned files. If an unlisted shared file is needed, they stop and request the integration owner.
2. Agents do not commit or change branches: all agents share one worktree and Git branch. The integration owner reviews and commits complete waves.
3. Only the integration owner edits module exports, test reducer registrations, shared generated artifacts, reducer allowlists, resource registries, query registries and subscription manifests.
4. Generated Rust/TypeScript bindings are regenerated once after each schema wave; agents never hand-edit them concurrently.
5. Each task delivers a handoff containing changed files, public interfaces, test commands/results, remaining assumptions and follow-on dependencies.
6. A later wave starts only after the integration gate for the previous wave passes. Contract changes after freeze require all dependent agents to acknowledge the revision.
7. Existing unrelated worktree changes are preserved. Before editing, each agent verifies its owned files do not contain overlapping user changes.
8. Every backend task adds focused tests in its own workflow test file. The integration owner alone updates `tests/workflow/mod.rs`, `lib.rs` and the Makefile test-reducer list.

## Shared contracts to freeze in Wave 0

### Definitions and conditions

- `Workflow`: stable organization/company-scoped logical identity and model.
- `WorkflowVersion`: Draft/Published/Retired, version number, schema version, draft revision and SHA-256 content hash.
- `WorkflowNode` / `WorkflowEdge`: stable keys, typed node/branch kinds, sequence, registered action/task policy and typed condition program.
- Condition instructions: typed comparison, Boolean constants, AND/OR/NOT. Values support null, Boolean, integer, fixed-point decimal, money in minor units plus currency, text, date, timestamp and code.
- Publish validation checks graph reachability, deterministic ordering, operand types, allowlisted snapshot fields, condition bounds, action schemas and structured split/join topology.

### Runtime and decisions

- `WorkflowInstance`: organization/company/version, subject model/ID/revision hash, state and revision.
- `WorkflowToken`: node, token state, revision and fork lineage.
- `WorkflowHumanTask`: candidates/assignee, revision, due-time evidence, outcome and subject revision.
- `WorkflowDecisionEvent`: append-only prior/next state, actor/acting-for, role/delegation, condition and authorization outcome, subject/action/revision, correlation/causation, idempotency key and domain receipt.
- `WorkflowCommandReceipt`, `WorkflowFork` and `WorkflowJoinArrival` provide deduplication and branch correctness.
- `ApprovalDecisionCommand` contains task ID, expected revision, idempotency key and optional comment.

### Authorization and guarded actions

- Company access requires an active organization membership whose company is unrestricted or matches the task company; explicit superuser bypass is audited.
- Decision authorization requires company access, resource permission, current candidate membership, no self-approval, current SOD validation and valid delegation when acting for another identity.
- `GuardedActionSnapshot` contains the typed subject, registered action key, canonical input/revision hash, currency and amount in minor units when applicable.
- Initial action registry: PO confirm/send, SO confirm, journal post, payment post, expense-sheet approve and AI-action-draft approve.

### Delivery and calendars

- `WorkflowTimer` stores local due evidence, IANA zone, UTC instant, calendar version, status and revision.
- `WorkflowOutbox` stores registered effect type, validated payload, semantic key/input hash, queue link and correlation data.
- `QueueJob` uses available time, worker/lease token/expiry, attempt count, typed outcome and final Completed/DeadLettered/Cancelled states.
- `QueueAttempt` and `QueueEffectReceipt` are append-only.
- `WorkflowCalendarVersion` stores locale, IANA zone, weekday mask, cutoff, DST policy and content hash; dated exceptions carry category, subdivision/locality and official source metadata.

## Wave 0 — Contract freeze and destructive replacement map

**Owner: integration/architecture agent; reviewers: runtime and controls agents (read-only).**

- Produce the final Rust type/table/reducer signature manifest and the action/snapshot adapter interface.
- Identify every current direct queue constructor/consumer, approval gate call, workflow reducer call, seed row, query resource, hook, UI operation and test fixture that must be removed or replaced.
- Decide the final canonical names; no `v2`, `legacy` or deprecated aliases.
- Map destructive schema changes to a clean database reset/reseed.
- Reserve shared files and publish the ownership manifest before implementation starts.

**Gate G0:** all three reviewers approve the contracts; the repository has a complete deletion/replacement checklist and no unresolved wire-shape decision.

## Wave 1 — Foundations (three agents in parallel)

### Agent D — Definitions and schema

**Owns:** workflow definition/version/node/edge modules and definition tests.

- Replace mutable graph tables with stable definitions and immutable versions.
- Implement draft create/edit, graph validation, canonical hash, publish, clone-to-draft and retire.
- Replace activation semantics with published/retired lifecycle.
- Replace CSV import with validated draft import or remove it if no real caller remains.
- Rewrite workflow seeds and the platform definition smoke test for the final schema.

**Gate D:** publish immutability, deterministic hash, unreachable/cyclic/invalid graph and stale-draft revision tests pass (WF-01/WF-02).

### Agent Q — Queue replacement

**Owns:** `core/queue.rs`, queue status types, all direct queue constructors/current consumers, and core queue tests.

- Replace queue schema in place with company scope, semantic key/input hash, available time, lease worker/token/expiry, correlation/causation and dead-letter/cancel evidence.
- Centralize all insertion through one internal enqueue helper.
- Replace claim/complete APIs with lease-aware signatures; add renew, audited retry and cancel.
- Add append-only attempt and effect-receipt tables.
- Use deterministic capped exponential backoff. Generate jitter/lease tokens outside reducers.
- Update owner-report, embedding and other current queue users atomically; no compatibility reducers remain.

**Gate Q:** current queue consumers compile; concurrent claim, expired lease reclaim, stale completion, replay, dead-letter retry and cancellation tests pass.

### Agent C — Calendar and pack foundation

**Owns:** workflow calendar module, source-controlled pack assets, activation bridge and calendar tests.

- Implement immutable calendars/versions/exceptions and pure local deadline calculation with `chrono`/`chrono-tz`.
- Store IANA zone, local value, UTC instant and DST resolution. Gaps move to the first valid instant; overlaps use the earlier instant unless a pack explicitly overrides it.
- Create source/effective-year metadata structure for AU, NZ, ZA, BR, AR, CL, SG, MY, ID and PH.
- Keep HR/PSA calendars for their domains only; do not treat partial HR holiday seeds as workflow authority.
- Seed idempotently by content hash.

**Gate C:** fixtures cover all ten markets, regional/state overlays, observed days, NZ Chatham, AU/CL DST, MY state workweeks and ID collective-leave classification.

### Wave 1 integration

The integration owner updates workflow exports, test registrations and shared dependency declarations, then performs the first binding/codegen regeneration.

**Gate G1:** Rust format/check passes; queue consumer regression tests pass; a clean database publishes and seeds the new definition/queue/calendar schemas.

## Wave 2 — Deterministic core (three agents in parallel)

### Agent E — Typed evaluator and simulation

**Owns:** condition evaluator, simulation module and tests.

- Validate and execute bounded typed condition instructions against immutable snapshots from registered adapters.
- Define explicit missing/null/type/currency failure behavior.
- Implement simulation using the same pure evaluator/graph planner as runtime.
- Simulation may write only simulation result/step rows and can never create runtime, timer, outbox or domain effects.

**Gate E:** identical snapshots yield byte-identical ordered traces; type/null/currency cases pass; all non-simulation table counts remain unchanged (WF-03/WF-14).

### Agent R — Runtime, events and idempotency

**Owns:** runtime instance/token/event/receipt module and runtime concurrency tests.

- Implement start, signal and cancel with version pinning, company/model checks, expected revision and command receipts.
- Store a canonical subject revision hash supplied by a registered snapshot adapter.
- Implement bounded token transitions and append-only decision events.
- Enforce singleton trigger keys where configured and deterministic terminal behavior.
- Expose an internal `apply_runtime_event` interface for human tasks, timers/outbox and branches.

**Gate R:** duplicate and concurrent start/signal calls produce one result; mismatched key reuse/stale revision/cross-company/terminal commands fail without partial state (WF-06/WF-16).

### Agent P — Permission and delegation primitives

**Owns:** reusable company-access/role/SOD helpers, workflow delegation records and authorization tests.

- Implement company access and effective current role resolution.
- Add effective-dated, role-optional workflow delegation; reject self, cross-company, overlapping duplicate and cyclic delegation.
- Re-evaluate role expiry and SOD at decision time.
- Return an authorization decision containing actor, acting-for, matched role and delegation.

**Gate P:** wrong/expired role, inactive member, self-approval, SOD conflict, invalid delegation and cross-company access fail; valid delegation records both identities (WF-04/WF-08).

### Wave 2 integration

The integration owner connects the pure evaluator to runtime and regenerates bindings/resources once.

**Gate G2:** all Wave 2 domain suites pass together; no runtime reducer uses arbitrary condition/action strings or `check_permission` alone for a task decision.

## Wave 3 — Human and durable effects (three agents in parallel)

### Agent H — Human tasks and approval replacement

**Owns:** human-task/candidate/decision policy and approval replacement tests.

- Replace `approval_rule`, `approval_request`, approval gate and their reducers with version-pinned human tasks and decisions.
- Implement candidate assignment, claim, approve/reject/complete, invalidation and comments.
- Recheck current authorization, delegation, SOD and subject revision at completion.
- Preserve the existing transactional property: approval consumption and guarded domain effect commit or roll back together.

**Gate H:** zero backend references to old approval tables/reducers remain; claim/decision races, self/SOD/company denial, invalidation and rollback tests pass (WF-04–WF-06).

### Agent A — Guarded accounting/domain action registry

**Owns:** action registry, targeted guarded domain adapters and adapter tests.

- Implement typed `snapshot()` and `execute()` adapters for the seven initial actions.
- Hash materially relevant headers and child rows in stable ID order; recheck immediately before execution.
- Add missing organization ownership enforcement to journal posting and retain fiscal lock, balance, currency, credit and lifecycle rules.
- Bind receipts to subject, action, revision and input. Duplicate approval cannot double-confirm/post/pay.
- Reject arbitrary action keys and payloads.

**Gate A:** edit-versus-approve races have one valid outcome; locked/unbalanced/cross-company actions roll back cleanly; all seven actions pass duplicate execution tests (WF-05/WF-17).

### Agent T — Timers and outbox

**Owns:** workflow delivery module and timer/outbox tests.

- Create/cancel timers and outbox intents through internal helpers called in the runtime reducer transaction.
- Timer firing checks status/revision, appends history and advances once.
- Outbox creation and its queue job share the semantic key/input hash.
- Result recording verifies lease/effect receipt before advancing runtime.
- Mark ambiguous non-idempotent outcomes for reconciliation rather than blindly retrying.

**Gate T:** timer-fire/cancel race has one winner; repeated fire/dispatch/result returns the original receipt; runtime + timer/outbox/history creation rolls back atomically (WF-09–WF-11).

### Wave 3 integration

The integration owner joins human tasks, action adapters and delivery to runtime, removes old approval exports/seeds/tests, and regenerates bindings.

**Gate G3:** every guarded action enters through the new human-task engine; no old approval query/resource/reducer remains; Rust/domain suites pass from request through domain receipt.

## Wave 4 — Enterprise depth and service boundary (three agents in parallel)

### Agent B — Structured branches and joins

**Owns:** branch module and race tests.

- Restrict OR/AND splits to paired, nested, non-crossing joins.
- XOR chooses the first true edge by `(sequence, edge_key)`; OR emits every true edge; AND emits all declared edges.
- Persist expected fork branch keys and unique join arrivals; a join advances once.

**Gate B:** XOR/OR/AND, nesting, duplicate/out-of-order arrival and concurrent last-arrival tests pass (WF-07).

### Agent W — Workflow worker

**Owns:** new API-server worker module/binary, configuration, Cargo binary declaration, Compose service and worker tests.

- Bounded cycle: heartbeat, reconcile leases, fire timers, dispatch outbox, claim by shard, execute registered adapter, record result.
- Polling is correctness; subscriptions only wake the loop early.
- Use bounded `JoinSet`; do not hold locks across `.await`.
- Generate fresh lease tokens outside reducers; keep adapter timeout below lease and renew supported long calls.
- Stop new claims on shutdown and allow unfinished leases to expire safely.
- External dispatch defaults disabled.

**Gate W:** fake-clock/provider tests cover crash before call, after call and before result commit, timeout, lease renewal, duplicate callback, restart, shutdown and two replicas without duplicate committed effects (WF-10–WF-12).

### Agent DQ — Scoped reads, history and inbox

**Owns:** workflow/approval BFF read models, query hooks/contracts and read-model tests. It is the sole owner of `api-server/src/query_exec.rs` in this wave.

- Expose selected-company/identity-filtered task inbox, instance history and record history.
- Return only assigned/candidate/delegated tasks the caller can view or act on.
- Keep list projections free of internal payloads and unrelated comments.
- Add bounded operator resources for late timers, leases, retries, dead letters and reconciliation.

**Gate DQ:** direct API and subscription tests prove cross-org/company/identity isolation; no client-only security filtering or organization-wide end-user inbox remains (WF-16/WF-17).

### Wave 4 integration

The integration owner adds metrics and permission/resource registry entries, regenerates all bindings/query metadata and runs codegen drift checks.

**Gate G4:** worker crash/replay suite, branch races and scoped query tests pass; operational metrics avoid high-cardinality organization/company/job labels.

## Wave 5 — Product surface, packs and future lifecycle (three agents in parallel)

### Agent UI — Workflow and approvals UI

**Owns:** `/workflows`, `/approvals`, shared decision-history component, i18n strings and focused Playwright tests.

- Replace the old workflow/approval screens directly; no legacy tabs or feature switch.
- Add draft validation/publish, simulation trace, authorized task inbox, decision/history drill-down, branch state and operator recovery views.
- Pass the row's company to decisions; switching operating company changes query keys and rows.
- Remove hard-coded approval English and display delegation/revision/invalidation evidence.

**Gate UI:** publish/simulate, approve/reject/delegate, company switch, record drill-down and dead-letter recovery journeys pass.

### Agent PK — Ten-market workflow packs

**Owns:** pack materialization, localized workflow templates, impact analysis and pack tests.

- Complete AU/NZ/ZA/BR/AR/CL/SG/MY/ID/PH calendar and workflow template assets with official source metadata.
- Materialize enabled pack versions without mutating existing timers.
- Implement authorized explicit timer recomputation with before/after evidence and expected revision.
- Ship localized procurement, expense, finance escalation and evidence-review templates without statutory code in reducers.

**Gate PK:** all market fixtures and source metadata pass; pack update leaves active timers unchanged until audited recomputation (WF-18).

### Agent M — Future active-version migration

**Owns:** migration plan/preflight/per-instance reducer and tests.

- This is not a migration of current v1 data. It moves future running instances between final-engine published versions.
- Require explicit node/task/fork mappings, compatible action/task schemas, preflight simulation, operator reason and expected instance revision.
- Migrate one instance atomically; worker-coordinated bulk operation is a later orchestration over that reducer.
- Leave incompatible instances unchanged and never rewrite history.

**Gate M:** compatible mapping succeeds once; stale, unpublished, missing/incompatible and fork-topology cases fail without mutation (WF-15).

### Wave 5 integration

The integration owner performs the final regeneration and complete verification matrix.

**Gate G5:** WF-01 through WF-18 pass except scenarios explicitly outside enabled adapters; UI, domain, worker and localization evidence are linked in the runbook.

## Final verification and deployment

Run after each relevant wave and require all at G5:

- `cargo fmt --check`
- `cargo check --manifest-path spacetimedb/Cargo.toml`
- `cargo check -p api-server`
- Publish to an isolated disposable SpacetimeDB module and run `run_all_workflow_tests` plus queue/accounting regressions.
- Regenerate TypeScript and Rust SpacetimeDB bindings, then run repository codegen drift checks.
- `pnpm typecheck` from `frontend/`.
- Workflow reducer/BFF/resource/subscription contract tests.
- Focused Playwright workflow, approval, operations and history specs on a freshly seeded E2E database.
- Fake-provider worker crash/replay suite with two replicas.

Deployment order:

1. Land final schema and all queue callers atomically; rebuild a clean database and seed final definitions/calendars/packs.
2. Deploy the workflow worker with external dispatch disabled.
3. Validate simulation and a non-financial human/timer workflow.
4. Enable one idempotent external adapter for one company.
5. Enable one low-risk guarded approval, then financial actions only after SOD, revision, rollback, replay and drill-down sign-off.
6. Expand by company, workflow version, pack and adapter while monitoring queue depth, oldest job age, timer lateness, retries, lease recovery, duplicate receipts and dead letters.

Operational kill switches disable new starts and external dispatch independently. Result recording, recovery and history remain available. There is no rollback to the replaced workflow or queue schemas.
