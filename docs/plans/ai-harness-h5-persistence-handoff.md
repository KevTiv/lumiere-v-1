# H5 policy and persistence handoff

H5a adds a required per-call policy dependency to the H4 loop. Every admitted
call is evaluated using a reviewed tool/resource mapping and the existing
PolicyEngine; the decision is recorded before execution. Deny stops execution.
DraftOnly stops as PendingApproval before generic execution and does not claim
that an action draft has been persisted. Successful tool data passes controlled
output/privacy validation before entering the transcript. Unvalidated summaries
and citations are not passed through by the production policy adapter.

This is not full H5 acceptance. Production skill routing remains disabled.

## H5b durable budget contract

The current `record_ai_spend` reducer charges after completion using floating
point mutable pricing and only warns about overspend. Snapshot reads and the
gateway's process-local limiter cannot prevent concurrent budget admission.
H5b now adds a separate reservation/settlement contract in `ai/spend.rs`.
It is not yet released or used by the gateway; legacy spend remains unchanged.

The new contract defines an organization-owned spend reservation with
company, agent, active run, provider/model, billing period, immutable price
version, integer monetary units, bounded input/output allowance, idempotency
key and lifecycle state. The atomic reserve reducer validates these bindings
and subtracts both settled usage and outstanding reservations from the budget.
Identical retries recover the same reservation; conflicting reuse is denied.
Settlement is idempotent and uses the reservation's pricing snapshot.

Provider timeouts are ambiguous: a request may already have incurred charges.
Do not refund or expire its reservation automatically. Preserve committed funds
until usage is reconciled or non-dispatch is proven. A fallback attempt needs
its own allowed-model validation and atomic reservation, including outstanding
cost from the first attempt. Exhausted shared budget must deny fallback.

Bounded ownership: a new `spacetimedb/src/ai/spend.rs` owns transactional state;
`ai/skills.rs` verifies run/agent/config ownership; the coordinator owns IR,
contracts release and consumer pins. Gateway reserve/settle wiring follows the
immutable release. Legacy routes are a separate migration, not part of H5a.

Required evidence: concurrent admission cannot overspend, idempotent reserve
and settlement, cross-tenant/run/model denial, ambiguous-timeout reconciliation,
fallback under remaining budget, and durable reconstruction/replay. An in-memory
test store is fixture evidence only, never the production budget guarantee.

## Correlated approval drafts

`tools/action_draft.rs` and the route bridge currently recover draft IDs using
latest-ID queries. Before creating approval drafts from the loop, persist a
unique organization/run/request key and return or recover that exact draft.
Creation retries must not create another draft or return another invocation's
draft. Approval must independently validate the resulting draft and scope.

The policy stop can be tested now. Draft creation, budget settlement and live
end-to-end approval remain separate persistence acceptance gates.

## H5b source implementation

The persistence slice adds four private, organization-owned tables. They are
not public SQL/subscription surfaces; gateway ID recovery needs an explicitly
authorized scoped read path (or owner-authorized service lookup) at activation:

- `ai_price_snapshot`: immutable versioned input/output prices, denominated in
  millionths of the named currency per 1,000 tokens. New reservations require
  the latest version for the selected agent/provider/model/currency.
- `ai_spend_budget`: one shared agent budget per UTC calendar month, across
  companies. Currency is immutable; limit changes cannot undercut commitments.
- `ai_spend_reservation`: exact organization/request-key binding to company,
  agent, run, model, price, month and token allowances. Admission updates shared
  outstanding units transactionally. Settlement stores token counts and rejects
  conflicting retries; ambiguous outcomes retain their outstanding amount.
- `ai_action_draft_request`: immutable organization/company/run/request mapping
  to the exact inserted draft and its original creation-payload hash. The draft,
  mapping and run association are written in one transaction. Existing manual
  draft parameters and the legacy reducer API are unchanged.

`create_ai_agent_run` now checks active skill/agent/team/config ownership while
preserving valid organization-wide optional company scope. Existing step appends
recover identical run/step payloads and reject conflicting or out-of-order writes.
Completion is idempotent and preserves previously associated draft IDs.

Spend reservation and settlement require separate `ai_spend/reserve` and
`ai_spend/settle` grants. Provision these only to the trusted gateway/accounting
principal: ordinary run writers must not self-report usage to release funds.
Configuration requires `ai_agent/write`. There is no default permission grant.
The new governed path requires an explicit model allowlist; an empty list denies.

## Remaining release and activation gates

1. Generate schema, Rust/TypeScript bindings, storage/projection/reconstruction
   coverage and canonical IR for these four tables and four new reducers; review
   ownership and reducer exposure. The currently pinned v0.3.42 is unchanged.
2. Run the module transaction/concurrent-client tests and fresh durable replay,
   then the complete contracts release gates. Publish a new immutable version
   and pin its gateway consumers; do not edit generated staging by hand.
3. Add durable provider-attempt dispatch/reconciliation state. Recovering a
   reservation does **not** authorize dispatching the same attempt again. Bind
   allowances to the exact provider request and account for prompt usage before
   dispatch. Every fallback attempt needs its own reservation and an explicitly
   allowed provider/model pair; cross-provider fallback is not implemented here.
4. Wire gateway reserve/settle and exact draft lookup through released contracts.
   Replace legacy latest-ID lookups only in a separately verified migration.
5. Persist approval-wait/terminal run states and validate candidate final answers.
   Prove permitted, denied, exhausted-budget, ambiguous-timeout and fallback
   behavior end-to-end before enabling production skill routing.

The native helper tests are not evidence of live concurrent admission or
PostgreSQL-to-fresh-SpacetimeDB reconstruction. H5 remains partial until these
gates pass.

### Gate 1 source generation (`codex/ai-harness-h5b-release`)

Generated from this module published to a disposable local database and
snapshotted over HTTP; nothing was hand-edited in `.contracts-staging`.

- Rust/TypeScript bindings, schema/storage/reconstruction manifests, canonical
  IR (1320 operations, 467 tables) and the checked-in reducer contract and
  reconstruction apply outputs are regenerated.
- Reviewed storage policies (bootstrap source): `ai_spend_reservation` is
  durable operational state and `ai_action_draft_request` a durable business
  record, both children of `ai_agent_run` via `run_id`; `ai_spend_budget` is
  durable operational state; `ai_price_snapshot` remains an organization-wide
  tombstoned business record.
- Operation identities and classifications: `configure_ai_spend` operator /
  non-idempotent; `reserve_ai_spend` and `create_ai_run_action_draft` internal /
  request-guarded; `settle_ai_spend` internal / state-guarded. None has a
  reducer-exposure entry, so all four are `Denied` to session BFF dispatch and
  remain trusted-principal operations.

### Gate 2 combined contracts release (`codex/contracts-v0.3.44-integration`)

`lumiere-contracts` v0.3.43 was already published from the presentation
saved-drafts stack. Because a release replaces every generated output, H5b is
released together with that stack from an integration merge of
`codex/frontend-ir-saved-drafts` into `codex/ai-harness-h5b-release`.

- The C0/C1 census becomes 469 organization-owned relations (464 application +
  5 protocol): the four H5b tables plus `presentation_module` and
  `presentation_module_version`.
- Operation history follows the precedent released in v0.3.43: a third
  release-bound revision chains from the v0.3.43 operation baseline and binds
  the combined operation set. The H5b-only schema-v4 verifier change is not
  carried into the integration.
- The consumer pin updates Cargo, frontend packages, lockfiles, the release
  compatibility manifest, the health-route release assertion and the presentation
  dictionary `CONTRACT_PIN`, which is also the approved draft
  `applicationContract`.

No concurrent-client spend admission test or PostgreSQL-to-fresh-SpacetimeDB
replay for these tables exists yet; those remain H5 acceptance gates and are not
claimed by this release.

### Gate 4 gateway primitives (`codex/ai-harness-h5b-gateway`)

The four H5b tables are private, so the gateway reads them through a dedicated
`AI_SPEND_READ_STDB_TOKEN` identity (rejected when it equals `STDB_TOKEN` or the
certification token), following the api-server `workflow_reads` pattern.
Writes stay on the gateway principal.

- `ai-gateway/src/ai_spend.rs` derives deterministic run-scoped request keys,
  sizes a conservative pre-dispatch allowance, wraps `reserve_ai_spend`,
  `settle_ai_spend` and `create_ai_run_action_draft`, and performs scoped reads
  with numeric-only SQL filters; string bindings are matched in gateway code and
  foreign-organization, duplicate or cross-company rows fail closed.
- `run_recorded_loop` requires a spend ledger and binding and dispatches every
  provider attempt through `SpendAdmittedLlm`. After the loop, failure stops
  (malformed call, denied tool, policy or tool failure, provider failure, round,
  tool or token limit) finalize the durable run as `failed` with a fixed
  `agent_loop_stop:*` code, the highest persisted step and the saturated token
  total. A candidate answer (answer gate pending) and a pending approval leave
  the run open; the module has no approval-wait status yet. A loop error leaves
  the run untouched because its state is uncertain.
- The action draft tool resolves exact draft ids for durable runs through
  `create_ai_run_action_draft` and a SHA-256 input-derived request key. No
  production path reaches it today: skill runs dispatch fixed tools and the
  governed loop adapter rejects `action_draft` calls.
- Not yet done: a governed route or skill that calls `run_recorded_loop`; the
  route-level draft bridge, which has no durable run; provisioning the
  `ai_spend/reserve` and `ai_spend/settle` grants (an explicit admin step). The
  approval-wait status and gate 3 attempt state are added by v0.3.45 below.
  Recovering a reservation still does not authorize redispatch.

### v0.3.45 contract release (`codex/contracts-v0.3.45`)

- Run wait states: `set_ai_agent_run_wait_state` moves a `running` or `pending`
  run to `awaiting_approval` (an action draft needs approval) or `agent_settled`
  (a candidate answer awaits the answer gate); replaying the same state is a
  no-op. Open runs (running, pending or waiting) can still be completed or
  cancelled; only running or pending runs accept new steps, drafts or spend
  reservations.
- Gate 3 attempt state: private `ai_provider_attempt` rows, children of
  `ai_agent_run` and bound 1:1 to a spend reservation by request key, move
  `accepted` → `dispatched` (claimed once) → `succeeded` | `failed` |
  `outcome_unknown`; `outcome_unknown` resolves to `succeeded` or `failed` only
  through `reconcile_ai_provider_attempt` with a required resolution
  (`ai_spend/settle`). Accept, dispatch and result need `ai_spend/reserve`.
  Usage is bounded by the reservation allowance, every transition is
  replay-strict, and a recovered attempt never authorizes redispatch.
- Presentation contracts: module-draft and preview-contract JSON schemas are
  generated from `crates/presentation-core` into `manifests/presentation/`
  (checked by contracts drift with only cargo) and, with their TypeScript
  types, into the contracts package under `src/presentation/`. After the pin,
  `@lumiere/presentation-core` consumes them from `@lumiere/contracts` and the
  checked-in local copies and their CI drift step are removed.
- Not yet done in the gateway: using attempt rows around dispatch in
  `SpendAdmittedLlm` and setting wait states from loop stops; both follow the
  v0.3.45 pin.

### H5b local validation

- Final native `cargo test --offline --locked --manifest-path spacetimedb/Cargo.toml
  --lib`: 61 passed, 0 failed. This includes arithmetic limits, outstanding
  reservation accounting, exact settlement replay, UTC/Unicode handling,
  draft creation-payload hashes, and step/completion payload matching.
- Final `cargo check --offline --locked --manifest-path spacetimedb/Cargo.toml
  --target wasm32-unknown-unknown`: passed with 9 warnings. This is a target
  compilation check, not a deployed WASM runtime or contracts publication gate.
- Edited Rust files pass `rustfmt --check`; `git diff --check` passes.
  Whole-module formatting remains red on unrelated existing differences in
  `src/core/reconstruction.rs` and `src/generated_reconstruction_apply.rs`;
  this slice does not change those files.

## Execution and recovery boundary

Calls in a batch are sequential, not transactional: an allowed read can finish
before a later call is denied or requires approval. Its policy and protected
result remain recorded. The reviewed adapter forbids ActionExecute and does not
execute DraftOnly calls. This is not an atomic mixed-side-effect batch contract.

Before production activation, add idempotent event keys and resume-safe step
allocation, map every terminal loop outcome to a durable run status, and admit
candidate final text through the separate answer gate. The current adapter is
for a fresh invocation only and does not finalize the durable run.

## Local validation

- `cargo test --offline --locked -p ai-gateway`: 195 passed, 1 existing integration test ignored.
- `cargo check --offline --locked -p ai-gateway`: passed with warnings (including
  gated, currently unused harness seams); workspace formatting and diff checks passed.
- Policy fixtures cover reviewed low-stock admission, unknown tools, cumulative
  steps, scope overrides, cross-company output rejection and metadata scrubbing.
- Loop fixtures cover per-call denial, approval stops, policy/recorder failures,
  and protected output propagation. No live persistence or production activation
  is claimed by these tests.
