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

## Execution board

| Order | Workstream | Branch / parent | Owner | Exit gate | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | H2a capability contract source | `codex/ai-harness-capability-ir` / PR #15 | Luna IR agent; coordinator integrates | Explicit fail-closed metadata, generator/verifier tests, no pin change | Ready |
| 2 | H2b companion generation and release | companion contracts branch / H2a | Coordinator | Rust, TypeScript, package, history and drift gates green; publish reviewed immutable version | Corrected checksum release published as `v0.3.42` |
| 3 | H2c consumer pin | `codex/ai-harness-capability-pin` / PR #20 | Coordinator | Pin/provenance updated; pinned and source-drift gates green | In review |
| 4 | [H3 registry adapter](./ai-harness-h3-registry-adapter-plan.md) | new child / H2c PR #20 | Luna registry agent | Generated descriptors convert to `ToolSpec`; allowlist and denial fixtures pass | Coordination started; implementation blocked on H2c |
| 5 | [H4 pure agent loop](./ai-harness-h4-loop-handoff.md) | `codex/ai-harness-h4-loop` / H3 PR #22 | Luna loop agent | Durable nonzero run; two calls plus candidate answer; malformed/cap stops persisted | Core and recorder adapter implemented; live persistence and production admission pending |
| 6 | H5 per-call policy | new child / H4 | Luna policy agent | Every call reauthorized; denial cannot reach execution; action draft stops loop | Blocked on H4 |
| 7 | H5 budget/model routing | new child / policy slice | Luna routing agent; coordinator owns STDB integration | Atomic reservation/charge, allowed-model routing, bounded Mistral-to-Gemini fallback | Blocked on policy slice |
| 8 | Evidence foundation | parallel child after stable generated IDs | Luna provenance agent | Versioned source/passage/contribution/claim/decision/component records and invalidation tests | Blocked on contract IDs |
| 9 | Answer and recovery gates | child / evidence foundation | Luna validation agent | Publication gate, questions, repair, non-progress, compaction and resume fixtures | Blocked on evidence |
| 10 | H6 `low_stock` pilot | child / H5 plus applicable evidence gates | Luna pilot agent | Persisted scoped certification through authorized API/UI; explicit path deferrals | Blocked on H5/evidence |
| 11 | H7 bounded migrations | one child per skill/batch / pilot | Luna skill agents | Per-skill certification; legacy fence changes only after admission | Blocked on pilot |
| 12 | H8 operator surfaces | child / durable run and evidence reads | Luna UI/BFF agents | Authorized redacted transcript, sources, run/cost views | Blocked on durable reads |
| 13 | H8 usage/evidence metrics | child / admitted volume | Luna read-model agent | Seeded aggregates match scoped records and verification classes remain distinct | Blocked on admitted data |

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

## H3–H5 interface stop rules

- `ToolRegistry::run_named` cannot be called from a model-selected name unless
  the name resolves from the authorized registry view for that invocation.
- Bundled skills with `run_id == 0` cannot enter the loop; create a durable run
  or fail before the first provider/tool call.
- Existing whole-plan policy evaluation is not silently treated as per-tool
  authorization. Add a typed invocation decision that reuses the same manifest,
  resource, review, scope and limit rules.
- A local monthly-spend read is not concurrency-safe admission. H5 requires an
  atomic reservation/charge boundary before it claims fail-closed budgets.
- Kong is transport/proxy configuration; provider/model selection and recorded
  reasoning remain explicit.
- Ollama remains explicit single-shot only for this stack.

## Pilot and migration order

`low_stock` v1 is the pilot because it is green, read-only, one-step,
one-tool-call, company-scoped and already has immutable certification fixtures.
Its admitted matrix explicitly excludes web research, files, intellectual
sources and mutations.

After the pilot:

1. `report_composer` after virtual-file/report evidence gates;
2. deterministic green skills such as `insights_scan` and `daily_briefing`;
3. `import_mapping` after file/CSV privacy and evidence gates;
4. governed LLM/search skills after answer, provenance and recovery gates;
5. amber/red draft-producing skills last, with no automatic mutation.

No new skill may be added to `run_skill_unlocked`. Existing governed wrappers
that still call it are not considered migrated.

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
- Pilot/UI: authorized API/UI replay, cross-company denial, redaction and no
  premature candidate-answer publication.

## Handoffs

Every agent handoff records:

- parent commit and owned files;
- implemented versus deferred paths;
- commands and exact results;
- warnings, ignored tests and unavailable live dependencies;
- generated/pin status;
- next child branch and unresolved stop rules.
