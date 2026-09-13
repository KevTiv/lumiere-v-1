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
- The C0/C1 census moves from 463 to 467 organization-owned relations (462
  application + 5 protocol). The four tables take bootstrap storage defaults:
  organization-owned roots with tombstone deletes; `ai_price_snapshot` and
  `ai_spend_budget` are organization-wide (no company column). Reviewing
  reservation/draft-request durability classes and aggregate parents remains
  open before release.
- Operation identities and classifications: `configure_ai_spend` operator /
  non-idempotent; `reserve_ai_spend` and `create_ai_run_action_draft` internal /
  request-guarded; `settle_ai_spend` internal / state-guarded. None has a
  reducer-exposure entry, so all four are `Denied` to session BFF dispatch and
  remain trusted-principal operations.
- Operation history moves to schema v4: `added_after_revision` explicitly lists
  the four IDs added after the C8 release-bound revision, which keeps binding its
  exact 1316-operation baseline. A later bulk revision absorbs the additions and
  records `previous_baseline_fingerprint` so the revision chain also survives
  applied compatibility exceptions.
- Local gates: codegen, contract IR, agent capability artifact, tenant
  ownership, storage policy, C2 commit coverage, C8 ratchet, trusted-route and
  reducer-literal lints, operation history (current and pinned v0.3.42 IR),
  `lumiere-codegen` tests and `stdb-client` check pass.

Gate 2 (transaction/concurrency/replay tests, immutable contracts publication and
consumer pin) has not started.

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
