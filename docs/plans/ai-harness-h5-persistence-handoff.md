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
No durable reservation/settlement primitive exists in the inspected tree.

The next contract slice must add an organization-owned spend reservation with
company, agent, active run, provider/model, billing period, immutable price
version, integer monetary units, bounded input/output allowance, idempotency
key and lifecycle state. An atomic reserve reducer must validate all bindings
and subtract both settled usage and outstanding reservations from the budget.
Identical retries recover the same reservation; conflicting reuse is denied.
Settlement must be idempotent and use the reservation's pricing snapshot.

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
