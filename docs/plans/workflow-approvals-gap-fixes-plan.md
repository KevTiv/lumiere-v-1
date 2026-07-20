# Workflow and approvals gap-fix plan

**Source investigation:** [`../WORKFLOW_APPROVALS_INVESTIGATION.md`](../WORKFLOW_APPROVALS_INVESTIGATION.md)  
**Planning baseline:** 2026-07-19 / `48b006b3a`

## Outcome

Replace the current mutable/inert graph runtime with a versioned, auditable workflow control plane while preserving the working approval-to-domain transaction boundary. The pilot is complete only when financial/human/external decisions are authorized, idempotent, recoverable and drillable.

## Phase 0 — Contracts and safety rails (pilot-critical)

- Define typed status, node, task, condition, action, timer, retry and migration enums. Do not add new stringly typed lifecycle fields.
- Define fixed-point money/percentage condition operands and remove `f64` from new approval contracts.
- Create an action registry mapping a stable action key and versioned input schema to approved in-process domain adapters or external outbox handlers.
- Define semantic idempotency scope and receipt behavior: replay with identical input returns the prior result; key reuse with different input fails.
- Add architecture tests that forbid external I/O from reducers and reject unregistered action keys.

Exit gate: schemas and reducer contracts for the pilot are reviewed against accounting, authorization, audit and concurrency invariants before runtime code lands.

## Phase 1 — Immutable definitions and simulation (pilot-critical)

- Replace the disposable v1 workflow schema with stable definition plus immutable version/node/edge records. Rebuild development data from seeds; do not retain a legacy execution path.
- Implement draft create/edit, validation, publish, retire and clone-to-draft. Published versions are content-hashed and immutable.
- Implement a deterministic typed condition evaluator with explicit missing/null/error behavior and an allowlisted record-field snapshot contract.
- Implement a side-effect-free simulation reducer/query returning ordered node, condition, task and proposed-effect trace.
- Update `/workflows` with draft/published/version state, validation results and simulation. Keep the legacy runtime visibly labeled until cutover.

Exit gate: WF-01 through WF-03 and WF-14 pass; published versions cannot be mutated through reducers, imports or direct lifecycle helpers.

## Phase 2 — Runtime, human tasks and approval convergence (pilot-critical)

- Add version-pinned instances, revisioned tokens, human tasks and append-only decision events with organization/company scope on every row.
- Implement start, signal, claim, approve/reject/complete and cancel reducers using expected revision and idempotency keys.
- Enforce candidate roles/groups/units, self-approval, SOD and company scope at decision time. Add effective-dated, cycle-free organizational delegation.
- Bind approval requests to the record revision/content hash and invalidate or re-evaluate after material changes.
- Move the existing fixed approval action allowlist behind the versioned action registry without weakening the current same-transaction domain execution.
- Replace organization-wide approval inbox reads with authorized user/company task projections and live bounded subscriptions.
- Provide an append-only decision/history UI and record-to-workflow drill-down.

Exit gate: WF-04 through WF-06, WF-16 and WF-17 pass, including concurrent invocations and domain rollback tests.

## Phase 3 — Durable timers, outbox and worker (pilot-critical)

- Add workflow timers, outbox intents, immutable attempts and unique effect receipts.
- Harden `queue_job` with dedupe key, available time, lease owner/expiry, backoff, correlation and dead-letter metadata; retain the generic queue rather than building a parallel transport.
- Build a standalone Rust workflow worker using bounded due queries plus subscription wakeups. On startup and periodically, reconcile due timers, unclaimed work and expired leases.
- Require stable external idempotency keys; record response fingerprints and redacted error summaries through result reducers.
- Add operator views for timer lateness, active leases, retries, dead letters and audited manual retry/cancel.
- Add metrics for reducer duration, claim latency, timer lateness, attempts, lease recovery, duplicate receipts, dead letters and queue depth.

Exit gate: WF-09 through WF-12 pass under worker termination/restart and duplicate callback injection.

## Phase 4 — Enterprise execution depth (competitive)

- Implement validated XOR/OR/AND split and XOR/AND join semantics using unique token lineage and one-shot join receipts.
- Add escalation policies that create/reassign tasks through versioned local working-time calendars.
- Add registered compensation actions with idempotent retry and human exception fallback; cancellation never implies compensation succeeded.
- Implement subflows as explicitly version-pinned child instances with correlation and terminal result mapping.
- Add version migration plans, preflight simulation, compatible node/task mappings and atomic per-instance migration. Bulk migration is worker-coordinated.
- Add definition export/import with schema version, dependency manifest, content hash and validation report.

Exit gate: WF-07, WF-08, WF-13 and WF-15 pass; incompatible migrations leave source instances unchanged.

## Phase 5 — Geography packs (differentiating)

- Add versioned workflow calendar and policy packs for AU, NZ, ZA, BR, AR, CL, SG, MY, ID and PH.
- Model national/subdivision/local/company calendar overlays, observed holidays, optional/collective leave, company workweeks, IANA zones and DST resolution.
- Ship localized procurement, expense, finance escalation and evidence-review templates without embedding statutes in core reducers.
- Translate approval/task/history surfaces; eliminate hard-coded English in `/approvals`.
- Add pack update impact analysis for definitions, active timers and instances. Timers move only through an explicit audited recomputation action.

Exit gate: WF-18 passes for every pack, and every effective-year holiday release cites official national/subdivision sources.

## V1 replacement and lifecycle

- This system has not reached production. Replace the current workflow and approval tables, reducers, bindings, queries, subscriptions, UI and seeds directly; do not build dual-read, shadow, drain, deprecation or rollback-to-legacy paths.
- Rebuild development/test databases from the final seeds after schema replacement. Old stored fields that were never executed (`condition`, split/join, subflow, action and group) are not treated as behavior to preserve.
- Replace the existing approval gate once the new human-task path executes the same guarded domain adapters transactionally. No deprecated reducer aliases are required.
- Keep active-instance version migration as a product capability for future published versions; it is not a migration of today's disposable v1 data.
- Operational rollback disables new starts and external dispatch while allowing running final-engine instances, result recording and history reads to continue. It never restores the old engine.

## Verification suite

- Add `spacetimedb/tests/workflow/` domain suites for definitions, evaluator, runtime, approvals/SOD, concurrency, timers/outbox, branches, compensation, migration and localization.
- Add contract checks that compare Rust reducers, BFF reducer keys, parameter mappers, resource registry entries and subscription builders.
- Add Playwright coverage for definition publish/simulate, task inbox approve/reject/delegate, history drill-down, timer/dead-letter operations and migration UI.
- Add worker integration tests with a controllable fake external service, clock and forced crash points before call, after call and before result commit.
- Add concurrency tests for duplicate starts/signals/completions, join races, approve-vs-record-edit, timer-fire-vs-cancel and lease expiry/reclaim.
- Run `cargo check`/domain reducers, frontend typecheck, contract scripts and focused Playwright suites on every tranche; require the 18 investigation acceptance scenarios before final rollout.

## Rollout

1. Rebuild a clean development database with final workflow, queue and ten-market pack seeds.
2. Internal seed organization in simulation-only mode.
3. One non-financial pilot workflow with human tasks and timers.
4. One company/one low-risk approval action through the final guarded execution path.
5. Add accounting actions only after rollback, SOD, duplicate and drill-down evidence is signed off.
6. Roll out per organization/company and workflow version; monitor queue/timer/decision metrics and retain explicit kill switches for new starts and external dispatch.

## Non-goals

- NetSuite workflow import or UI cloning.
- Arbitrary user code, SQL, JavaScript or reducer names in conditions/actions.
- Cross-database distributed transactions or claims of transport-level exactly-once delivery.
- Preservation or migration of the disposable pre-production workflow/approval data.
- Hard-coded statutory rules in core workflow reducers.

The sub-agent ownership, dependency and merge-wave plan is in [`workflow-approvals-subagent-execution-plan.md`](./workflow-approvals-subagent-execution-plan.md).
