# AI run lifecycle and usage source repair

Task / base SHA

REVIEW: A2 source candidate from `1b842603d950c6c94bb91c845c4cfbe5f8c5e1ec`.
No production change or new live acceptance is claimed.

Files changed

- `spacetimedb/src/ai/run_lifecycle_reads.rs` and `ai/mod.rs` add five narrow read views.
- Gateway `routes/run_lifecycle.rs`, `orchestrator/skill_loader.rs`, `orchestrator/budget_park.rs` and `orchestrator/run.rs` separate the existing reader and writer paths.
- Gateway `routes/evidence.rs` retains unknown/in-flight/malformed provider usage as unknown.
- Web `run-observation.ts`, its test, and its panel, plus lifecycle metadata display/tests show complete provider totals for waiting runs and omit an unknown counter.

Before path

Component/action: RunLifecyclePanel inspect or checked lifecycle intent.
Hook/application service: session-owned `/api/ai/runs/lifecycle` BFF.
Generated operation: existing closed lifecycle reducer names and continuation params.
Server route: gateway `post_run_lifecycle`, actor company check and `ai.run.lifecycle` grant.
STDB owner: private lifecycle state, events, questions, queue and budget-park tables.
Stable effect identity: exact organization/company/run and checked checkpoint/cursor/version tuple.
Result readback: gateway queried private base tables through its writer, which a normal service credential cannot read.
Operator E2E: prior live inspection reported unavailable; that prior evidence does not certify this candidate.

The saved run counter stays zero on nonterminal wait states; provider attempts already record real tokens. The UI displayed contradictory totals. This candidate does not mutate the persisted run counter.

After path

Current actor/company/capability checks and an exact bounded pre-read run before any intent is dispatched. A configured token alone is not treated as proof of readback availability. Writes still use existing generated reducers. Readback uses five sender-scoped views through `spend_read_stdb`, with exact organization/company/run filters. Resume and budget-park continuation reads use that same reader. No writer fallback is added.

Private tables remain private. Each view uses the existing `authorized_organization_ids` filter, which requires an active `ai_spend_reader` service binding for the sender. Queue payloads/authors and event payloads are absent from the read types. Question prompts and answers are omitted as well. The UI marks question content unavailable and excludes metadata-only questions from reply selection; it preserves answered status without an answer body. Content-bearing question UX needs a separately authorized reader.

The UI uses an exact run's complete provider usage when attempts and reservations are settled. Unknown outcomes, in-flight attempts, incomplete rows, overflow and truncated responses do not become zero or a partial total. Terminal legacy runs without a provider summary retain their recorded counter. The gateway stops defaulting missing usage fields to zero.

Canonical owners reused

Existing service identity binding, private lifecycle reducers, actor grants, provider attempts and spend reservations. No new service identity or broader grant. No spend or waiting-state mutation is added.

Effect identity + cardinality

Existing checked run identity and reducer idempotency remain unchanged. This source adds read projections only. No new business effect or runtime run is created.

Resulting record ref

No new live record. The operator reopens the same exact run ID after the eventual release.

Typed outcomes/errors

An absent configured reader fails before dispatch. Private view/read failures remain failures. Waiting runs retain their status. Unknown economics produce nullable usage instead of zero.

Tests run (command + result)

- `node --import <existing-web-node_modules>/tsx/dist/loader.mjs --test 'frontend/web/app/(modules)/ai-harness/run-observation.test.ts'`: 6 passed.
- `node --import <existing-web-node_modules>/tsx/dist/loader.mjs --test 'frontend/web/app/(modules)/ai-harness/run-lifecycle.test.ts'`: 4 passed, including metadata-only question content and answered status.
- `cargo test --manifest-path /private/tmp/lumiere-run-usage-owner-test/Cargo.toml --offline`: 4 passed in an isolated extraction of the exact owner structs, functions and four regression tests from `routes/evidence.rs`. This proves the pure economics owner only, not gateway integration or the full module build.
- `rustfmt --check --edition 2021` on the five modified gateway/loader files and new view file: passed.
- `git diff --check`: passed.
- Source checks: all five views use the existing organization/sender filter; base tables remain private; queue/event payload fields are omitted. These checks do not replace native authorization execution.

Operator proof

Pending deployment. No new browser or provider call was made by this packet. Metadata-only questions do not offer a reply control without a separately authorized content read.

Compatibility/debt retired

Source candidate removes private-table read assumptions and contradictory wait-state token display. Persisted run-row usage is unchanged; it is not relabelled as a repaired native counter. Existing frontend and gateway response shapes remain compatible.

Remaining blocker/deferral

New read views require module schema generation, immutable contract release/pin alignment and full compilation through the owning release lane before merge/deployment. Regenerate any required schema ledger/catalog artifact through existing tooling. This branch does not hand-edit generated bindings. Native tests must prove no rows for unknown, inactive or wrong-organization readers, and exact scoped readback for an active reader. Gateway missing-reader and end-to-end checked continuation tests also remain required. Full gateway/module compilation was not attempted in the disk-constrained local environment. Existing run-row counter updates can be a later canonical operation change if the owner requires persisted nonterminal totals; this candidate changes read presentation only.

Contract release required: yes/no

Yes: five new sender-scoped read views. No publication or deployment was performed. Gate the runtime switch on that released module and keep compatible artifacts for rollback.

Next bounded task

Generate and validate the schema/contract candidate; execute native reader-scope and gateway lifecycle integration tests; then deploy through the approved ordered release and repeat live inspection/continuation and token reconciliation.
