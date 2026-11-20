# AI harness chat remediation plan (AIH-30 to AIH-38)

Recorded 2026-11-18 against `main` at #444 (`fcde3069`). Issue entries live in
[`ai-harness-completion-issues.md`](./ai-harness-completion-issues.md). This plan
makes no infrastructure change and performs no deployment.

## Invariants

- AI never writes to SpacetimeDB directly. Every read is re-authorized for the
  current actor. Earlier answers and conversation are never current ERP facts.
  Fail closed.
- Repository-owned skills need no certification, activation or manifest refresh
  ([skill ownership and lifecycle](../plan/skill-ownership-and-lifecycle.md)).
- Contract changes (tables or reducers) require a contracts regenerate/release and
  pin; prefer designs that avoid them.

## Decisions made

| Topic | Decision |
|---|---|
| Indexing identity (AIH-30) | Index on each real user's write with that actor's credentials, plus a capped, operator-started bulk reindex. Retrieval still re-authorizes every hit for the asking user. |
| Migration 51 (AIH-37) | Split into expand and contract so rollback stays safe. |
| Planner (AIH-32) | Lexicon-only. No router model; leave a named trait/hook for one later. |
| Delivery | One PR per workstream, each based on `main`. AIH-34 is stacked on AIH-32's branch. |
| Qdrant 1.12.6 to 1.17 cutover | Still open (ops decision). A runbook is written; no infra changes. |

## Waves and gates

| Wave | Work | Gate to leave the wave |
|---|---|---|
| 0 | AIH-37; AIH-36 baseline; AIH-33 reasons; AIH-35 | Pilot verified |
| 1 | AIH-30; AIH-31 | Fixture hits |
| 2 | AIH-32 en/fr, then rw/sw/pt-BR; AIH-33 repair; AIH-34 | Parity passes |
| 3 | AIH-32 router removal; AIH-36 withhold gate; AIH-38 | 7 nights green |

## AIH-30 — Index ERP records (P0, L)

**Evidence.** Chat retrieval returns nothing for ordinary ERP records: only
documents and activity are embedded, edits and approved imports never reach Qdrant,
and an empty retrieval is indistinguishable from "no data".

**Changes.**
- `ai_index_job` queue table; enqueue on write with the writer as actor.
- Gateway worker drains at most 8 jobs per tick through the existing ingest path;
  spend admission, the `embedding_index` permission and field projection are
  unchanged.
- Operator bulk reindex requiring the `embedding_reindex` grant and a per-run
  spend cap; runs as the enrolled non-human platform operator.
- Index `module_backfill_record` rows.
- Per-company coverage signal and a "not indexed yet" reply for zero-point
  companies.
- Qdrant 1.12.6 to 1.17 cutover runbook: fresh cluster plus reindex versus staged
  one-minor-at-a-time upgrade. Runbook only; the choice remains open.

**Acceptance.** An edit is indexed within 60 s. An approved Shop Sales import is
retrievable by product and month. A 0-point company gets "not indexed yet".
Degraded Qdrant still returns `RetrievalUnavailable`. No hit for users without
access. The reindex stops at its cap. Live Qdrant is 1.17.x.

## AIH-31 — Follow-up anchors (P0, M)

**Evidence.** Follow-ups lose the record the previous answer was about.

**Changes.**
- Envelope v2 `anchor_refs` (`entity_type`, `entity_id`) from the last grounded
  turn plus #444 `reviewedRecords`; cap 8; no prose.
- Re-authorized on every turn through `fetch_authorized_live_snapshots`.
- Resolution priority: UI record, then named record, then anchors, then ANN.
- Reference-word recognition; "Using:" label with a clear control.
- Deploy the gateway before the api-server.

**Acceptance.** Follow-up resolves without a name; revoked access drops the
anchor; no prose stored; cap holds; label and clear work; an old gateway ignores
v2 fields.

## AIH-32 — Multilingual read planner (P1, L)

**Evidence.** Sales/farm/support read routing lives in web-side parsers that are
English-biased and duplicated.

**Changes.**
- `ReadPlan` enum in `harness/read_plan.rs`.
- Lexicons `erp-skills/rag_generation/lexicon/{en,fr,rw,sw,pt-BR}.json` with
  Unicode case-folding.
- Labels resolved via `authoritative_search`, with Clarify choices when ambiguous.
- Gateway executes sales, farm and support reads behind a per-company flag; add
  `module_backfill_record` and `farm_batch` entities.
- Parity test against the TypeScript parsers.
- Lexicon-only; a clearly named hook for a future router model. Web routers are
  removed later, after parity.

**Acceptance.** Parity passes; at least 40 eval questions per language with
proposed thresholds 95% (en, fr) and 90% (rw, sw); flag off keeps current
behavior; all reads re-authorized.

## AIH-33 — Gate reasons and one repair (P1, M)

**Changes.**
- `WithholdReason` enum; record reason, provider, model, language and spend.
- 7-day counts by reason by model.
- One shape-only repair for `Malformed`, `NoClaims` and `CoverageGap`.
- Auth and source failures are never repaired.
- Eval corpus per reason.

**Acceptance.** One reason per withhold; counts queryable; at most one repair and
only for the three shape reasons; repair adds no unsupported facts.

## AIH-34 — Chat to skill handoff (P1, M)

**Changes.**
- `Handoff` plan; `start_skill_run` action in BFF `ui_action_offers`, gated by the
  run permission.
- Confirm card with spend estimate and editable period.
- Governed run; result card returns to the thread as a decision history reference.
- Partial answer first. Stacked on AIH-32.

**Acceptance.** No offer without permission; nothing starts without confirmation;
estimate and period match the run; result linked; partial answer precedes offer.

## AIH-35 — Withheld history reclassification (P2, S)

**Changes.** Read-side reclassification; operator-only run-status correction with
audit; dry-run listing; usage counts.

**Acceptance.** Dry run writes nothing; correction needs the operator role and
audits; counts reflect reclassification; stored evidence unchanged.

## AIH-36 — Release chat checks (P1, M)

**Changes.** One scenario per gap with known-gap support; web releases; on by
default with a recorded skip; fresh sessions; nightly; withhold-rate gate.

**Acceptance.** Each gap has a scenario; known gaps reported; skips recorded;
nightly results published; the gate fails when the withhold rate is exceeded.

**Follow-up — release fixture registry.** SpaceTimeDB stores private versioned
scenario definitions and evidence references. The broker checks GitHub's
repository, workflow and environment claims before issuing short-lived WorkOS
sessions for separate company-bound test actors.

Preflight validates the upgraded fixture. Once the candidate is served, the
release prints a signed cutover receipt and waits for the operator to provision,
index, and register a fresh fixture. The broker checks that the company and
document were created after cutover. Stack, web, and nightly runs retain their
public streaming, citation, persisted claim, and withhold checks. The
[activation guide](../guides/mistral-alpha-activation.md#verify-a-railway-release-through-authenticated-chat)
documents the migration from `AI_CHAT_ACCEPTANCE_JSON`.

## AIH-37 — #444 rollout guard (P0 for the next deploy, S)

**Changes.** Pause switch; documented release order; catalog version check;
migration 51 split into expand and contract; signed-in pilot verification with
RWF 71,406,345.45.

**Acceptance.** Pause stops imports without data loss; order enforced or checked;
catalog mismatch fails closed; contract only after expand is verified; pilot figure
reproduced.

## AIH-38 — Retire certification steps from plans (P2, S)

**Evidence.** [skill ownership and lifecycle](../plan/skill-ownership-and-lifecycle.md)
(2026-11-17) removed certificates, activation, manifest refresh and skill-version
bumps for repository-owned skills, and deleted the finance skill manifest helper script
and the checked-in built-in proposed manifests. Many older plans still read as
required steps, and AIH-19 read as an open built-in certification requirement.

**Changes.** Superseded banners on affected plans; AIH-19 rewritten to user-created
skills (`json_projection_v1`) and admission; this plan and AIH-30..38 entries
recorded; a short CLAUDE.md section; `scripts/check-retired-skill-steps.py` in CI.

**Acceptance.** The check passes; AIH-19 no longer implies built-in certification.

## Open

- Qdrant 1.12.6 to 1.17 cutover approach (ops).
