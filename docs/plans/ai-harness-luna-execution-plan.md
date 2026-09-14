# AI Harness Luna Execution Plan

**Status:** Active coordination — 2026-09-12  
**Stack base:** `codex/ai-harness-tool-calling` / PR #15  
**Scope:** H2–H8 from the AI harness completion plan.  
**Authority:** This ledger coordinates implementation; milestone acceptance
remains owned by `ai-harness-completion-plan.md` and immutable contract gates.

The H3 implementation handoff is bounded in
[ai-harness-h3-registry-adapter-plan.md](./ai-harness-h3-registry-adapter-plan.md).
It starts only from the H2c consumer pin at PR #20 / `lumiere-contracts`
`v0.3.42`.

The T3-inspired control-plane additions are bounded in
[ai-harness-t3-control-plane-adoption.md](./ai-harness-t3-control-plane-adoption.md).
They add durable effect orchestration, provider-instance isolation, capability
negotiation, resumable run streams, and ERP proposal workspaces without
weakening generated ERP authorization or approval boundaries.

## Operating rules

1. One reviewable PR per row or smaller risk-bounded slice.
2. Luna agents own bounded files; the coordinator owns shared Cargo/lockfiles,
   generated outputs, migrations, branch stacking, and final integration.
3. Generated contract changes are serialized: source generator, verification,
   companion package publication, then consumer pin.
4. No agent edits generated staging or pinned package output by hand.
5. Every model-selected invocation is reauthorized from trusted actor and
   organization context. Tool discovery is never the security boundary.
6. Mutations remain action drafts until a separately admitted approval path
   executes the normal ERP operation.
7. A focused/unit test is not live-provider, persisted-runtime, certification,
   UI, or full admission evidence.
8. External/provider effects execute only after their accepted intent is durable;
   recovery of a receipt/reservation never implies authorization to redispatch.
9. Client/runtime capability discovery is compatibility information only and
   cannot grant ERP authority.

## Execution board

| Order | Workstream | Branch / parent | Owner | Exit gate | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | H2a capability contract source | `codex/ai-harness-capability-ir` / PR #15 | Luna IR agent; coordinator integrates | Explicit fail-closed metadata, generator/verifier tests, no pin change | Ready |
| 2 | H2b companion generation and release | companion contracts branch / H2a | Coordinator | Rust, TypeScript, package, history and drift gates green; publish reviewed immutable version | Corrected checksum release published as `v0.3.42` |
| 3 | H2c consumer pin | `codex/ai-harness-capability-pin` / PR #20 | Coordinator | Pin/provenance updated; pinned and source-drift gates green | In review |
| 4 | [H3 registry adapter](./ai-harness-h3-registry-adapter-plan.md) | new child / H2c PR #20 | Luna registry agent | Generated descriptors convert to `ToolSpec`; allowlist and denial fixtures pass | Coordination started; implementation blocked on H2c |
| 5 | [H4 pure agent loop](./ai-harness-h4-loop-handoff.md) | `codex/ai-harness-h4-loop` / H3 PR #22 | Luna loop agent | Durable nonzero run; two calls plus candidate answer; malformed/cap stops persisted | Core and recorder adapter implemented; live persistence and production admission pending |
| 6 | [H5 per-call policy](./ai-harness-h5-persistence-handoff.md) | `codex/ai-harness-h5-policy` / H4 PR #23 | Luna policy agent | Every call reauthorized; denial cannot reach execution; action draft stops loop | Policy and approval-stop slice implemented; validation tracked in handoff; no draft creation or production activation |
| 7 | [H5 budget/model routing](./ai-harness-h5-persistence-handoff.md#h5b-durable-budget-contract) | `codex/ai-harness-h5-persistence` / H5a PR #24 | Luna persistence agents; coordinator owns STDB integration | Atomic reservation/charge, allowed-model routing, bounded Mistral-to-Gemini fallback | Reservation and exact draft-correlation source implemented; generated release, live replay and gateway/fallback wiring remain |
| 8 | [H5c durable effect orchestration](./ai-harness-t3-control-plane-adoption.md#1-adopt-durable-intent-before-external-side-effects) | new child / completed H5b release+pin | Luna orchestration agent; coordinator owns persistence contracts | Accepted intent commits before external I/O; duplicate dispatch is idempotent; ambiguous outcomes reconcile; agent-settled differs from fully-settled | Blocked on H5b generated release/pin and gateway wiring |
| 9 | [H5d provider instances + capability truth](./ai-harness-t3-control-plane-adoption.md#2-adopt-provider-driver-and-provider-instance-are-different-concepts) | new child / H5c | Luna provider agent | Driver/instance split, account/region isolation, normalized provider events, authoritative capability downgrade and auditable selection | Blocked on H5c |
| 10 | Evidence foundation | parallel child after stable generated IDs | Luna provenance agent | Versioned source/passage/contribution/claim/decision/component records and invalidation tests | Blocked on contract IDs |
| 11 | Answer and recovery gates | child / evidence foundation | Luna validation agent | Publication gate, questions, repair, non-progress, compaction and resume fixtures | Blocked on evidence |
| 12 | H6 `low_stock` pilot | child / H5d plus applicable evidence gates | Luna pilot agent | Persisted scoped certification through authorized API/UI; extended effect/provider settlement gates and explicit path deferrals | Blocked on H5/evidence/control-plane gates |
| 13 | H7 bounded migrations | one child per skill/batch / pilot | Luna skill agents | Per-skill certification; legacy fence changes only after admission | Blocked on pilot |
| 14 | H8 resumable run stream + operator surfaces | child / durable run and evidence reads | Luna UI/BFF agents | Authorized redacted sequence-based transcript, reconnect cursor, capability descriptor, sources, run/cost/settlement views | Blocked on durable reads and H5c/H5d |
| 15 | H8 usage/evidence metrics | child / admitted volume | Luna read-model agent | Seeded aggregates match scoped records and verification classes remain distinct | Blocked on admitted data |
| 16 | AIH-24 ERP proposal workspace extension | child / checked continuation + H8 stream | Luna workflow agent | Checkpoint/fork/compare coherent multi-draft proposals; no inherited approvals; no fake rollback of posted ERP state | Blocked on AIH-20/23/24 prerequisites |

## H2 contract boundary

H2 is generator-first and fail-closed. Application-contract IR is canonical
for ERP operations/resources. A dedicated reviewed metadata source may annotate
stable contract IDs, but it cannot invent operations or roles. Omitted entries
are not agent-visible.

Minimum structural fields:

- stable operation/resource ID and capability key;
- JSON-schema-compatible input/output references;
- risk and confirmation policy;
- idempotency and bounded result policy;
- provenance expectations;
- optional discovery tags that do not assert unknown business semantics.

Runtime-native tools use reviewed versioned descriptors in the same generated
catalog vocabulary. They do not overwrite ERP contract facts.

H2a does not publish or pin a new `lumiere-contracts` release. H2b may begin
only after generator, verifier, history and drift evidence is recorded.

## H3–H5d interface stop rules

- `ToolRegistry::run_named` cannot be called from a model-selected name unless
  the name resolves from the authorized registry view for that invocation.
- Bundled skills with `run_id == 0` cannot enter the loop; create a durable run
  or fail before the first provider/tool call.
- Existing whole-plan policy evaluation is not silently treated as per-tool
  authorization. Add a typed invocation decision that reuses the same manifest,
  resource, review, scope and limit rules.
- A local monthly-spend read is not concurrency-safe admission. H5 requires an
  atomic reservation/charge boundary before it claims fail-closed budgets.
- Provider/network/filesystem/desktop-host effects cannot execute in the same
  decision/transaction that first records accepted intent. Commit intent first,
  then dispatch through a reactor/effect boundary.
- `outcome_unknown` after a timeout/disconnect is durable. Recovering its effect
  receipt or budget reservation does not authorize blind redispatch.
- Candidate provider prose may mark the agent portion settled but cannot mark the
  run fully settled while evidence, artifacts, spend, drafts, or effects remain
  unresolved.
- A provider driver identifies protocol behavior; a provider instance identifies
  an organization/account/endpoint/region lifecycle. Same-driver instances do
  not share mutable auth/session/catalog state by default.
- Provider capability manifests are descriptive compatibility input, not
  authorization. Authoritative capability removal overrides cached capability
  state.
- Kong is transport/proxy configuration; provider/model/instance selection and
  recorded reasoning remain explicit.
- Ollama remains explicit single-shot only for this stack.

## Pilot and migration order

`low_stock` v1 is the pilot because it is green, read-only, one-step,
one-tool-call, company-scoped and already has immutable certification fixtures.
Its admitted matrix explicitly excludes web research, files, intellectual
sources and mutations.

The pilot must use the H5c/H5d control-plane semantics for every provider/effect
path it declares: durable accepted intent before I/O, idempotent duplicate
handling, ambiguous-outcome reconciliation, provider-instance binding, and
agent-settled versus fully-settled status. A capability descriptor must not claim
paths the pilot has not admitted.

After the pilot:

1. `report_composer` after virtual-file/report evidence gates;
2. deterministic green skills such as `insights_scan` and `daily_briefing`;
3. `import_mapping` after file/CSV privacy and evidence gates;
4. governed LLM/search skills after answer, provenance and recovery gates;
5. amber/red draft-producing skills last, with no automatic mutation;
6. multi-draft workflows only after the proposal-workspace extension preserves
   independent approval/correction semantics for every consequential effect.

No new skill may be added to `run_skill_unlocked`. Existing governed wrappers
that still call it are not considered migrated.

## Client compatibility and run streaming

H8 must follow the control-plane adoption plan rather than leave transcript
transport as an unspecified poll/stream choice.

- Expose an authorized, generated/versioned harness descriptor containing the
  contract release, capability registry hash, environment identity, admitted
  feature flags, and provider capability summaries.
- Missing or removed features hide/deny client paths; cached capability state
  cannot override the authoritative descriptor after downgrade.
- Use persisted monotonically ordered run event/step sequences and resume with an
  `afterSequence` cursor.
- Share one frontend harness connection/subscription owner per environment/run
  scope so multiple React views do not create competing reconnect loops.
- Cache projection state and replay cursor atomically after applying events.
- Reconnection resumes observation only; mutation/effect replay remains owned by
  operation-specific idempotency and reconciliation.

## Validation matrix

Each PR runs the smallest applicable set plus its parent gates:

- Rust: `cargo fmt --all -- --check`, focused tests, package `cargo check`, and
  full package tests.
- Contract source: `cargo test --locked -p lumiere-codegen`,
  `make check-contract-ir`, operation history and verifier tests.
- Generated release: generator, Rust, TypeScript, package exports, immutable
  provenance and source/pinned drift checks.
- Runtime: deterministic provider fixtures; persisted run/step, denial,
  malformed-call, cap, cancellation and budget-race fixtures.
- H5c: crash-before-dispatch, timeout-after-dispatch, duplicate command,
  outcome-unknown reconciliation, replay compatibility, and separate
  agent-settled/run-settled fixtures.
- H5d: same-driver multi-instance isolation, region/policy selection, capability
  downgrade, provider fallback within shared budget, and normalized adapter
  event fixtures.
- H8: disconnect/reconnect from a persisted sequence cursor, two-consumer shared
  subscription ownership, descriptor downgrade, stale-cache rejection, and no
  mutation replay caused by transport reconnect.
- Proposal workspace: fork/compare preserves lineage but reacquires scope,
  evidence, budget and approval; workspace revert never changes posted ERP state.
- Pilot/UI: authorized API/UI replay, cross-company denial, redaction and no
  premature candidate-answer publication.

## Handoffs

Every agent handoff records:

- parent commit and owned files;
- implemented versus deferred paths;
- commands and exact results;
- warnings, ignored tests and unavailable live dependencies;
- generated/pin status;
- accepted-intent/effect/reconciliation status where external I/O is involved;
- effective provider instance/capability status where provider work is involved;
- next child branch and unresolved stop rules.
