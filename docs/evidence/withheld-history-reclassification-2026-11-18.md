# Withheld answers saved as completed (AIH-35) — 2026-11-18

Evidence: before #442 gate rejections were recorded as completed. Runs 4100,
4102 and 4104 were completed with the withheld notice; 4098 and 4099 carried the
same notice (see `harness-chat-remediation-2026-11-17.md`). No message bodies
are recorded here.

## Changes

1. One notice constant, `lumiere_policy_core::withheld_answer`
   (`crates/policy-core`), now produces every withheld notice in the gateway
   (`withheld_notice`, `RagRelease::withhold`). Wording is unchanged (unit test).
   `frontend/packages/erp-shared/src/ai-withheld-notice.ts` mirrors it; a web test
   reads the Rust file and fails on drift.
2. Read-side reclassification, no rewrite of stored rows:
   `stdb_client::reclassify_withheld_message` reports an assistant message as
   `failed` (with `withheldReclassified: true`) when its saved verification
   outcome is `blocked`/`requires_review` or its text is a withheld notice. Applied
   in `chat_message`, `chat_message_page`, `chat_message_page_with_cursor` and
   `chat_message_range`, so the history route, history references and
   continuity (which requires `completed`) all see it. History search skips
   withheld-notice messages. Web: `reclassifyWithheldHistoryRow` in the history hook.
3. Operator correction: reducer `correct_withheld_ai_agent_runs(organization_id,
   company_id, {run_ids})` in `spacetimedb/src/ai/withheld_run_correction.rs`.
   Only the release-compiled persistent platform operator may call it. All-or-
   nothing; up to 100 unique IDs. Each run must belong to the named
   organization/company, be `completed`, have no lifecycle state row, and have a
   `summary` that is the withheld notice. It sets `failed` plus an error message and writes
   one `ai_agent_run` UPDATE audit event per run.
   Evidence choice: the run row stores no verification outcome. Its `summary` is
   written by the gateway (the gated answer or the notice), so it is
   server-recorded. The chat message is browser-authored and older rows have no
   verification metadata, so it is not used as authority.
4. Dry run: `scripts/withheld-run-candidates.mjs` (read-only, owner token via env)
   prints run IDs and counts per organization/company, never summaries.
5. Usage insights: no read model exists yet (AIH-10 is planned only). Spend rows
   are keyed to reservations/attempts, not run status, so they are unaffected.
   When the insights model is built it must read `ai_agent_run.status`; corrected
   runs then count as failed.

## Validation

- `cargo test -p stdb-client -p lumiere-policy-core --offline`: stdb-client 24
  unit + 2 integration passed, policy-core passed.
- `pnpm --dir web exec tsx --test lib/assistant-history.test.ts lib/assistant-turn.test.ts`
  (Node 22.23.5): 33 passed.
- `node --test scripts/withheld-run-candidates.test.mjs`: passed.
- Cloud Runner: the changed-file SpacetimeDB rustfmt check passed, and all three
  `withheld_run_correction` module tests passed (eligibility, ID bounds, and
  authorization before mutation).
- The CI-built WASM was loaded into a disposable loopback instance with
  SpacetimeDB 2.8.2. Its schema includes the correction reducer; the authored
  operation ID and classification checks passed, and both history inventory
  verifiers passed. The reducer remains unavailable to sessions.
- Not run: the operator call itself and the dry run against any live database.

## Rollout

New reducer: contracts regenerate/release and pin required. The authored
contract registers `erp.correct_withheld_ai_agent_runs` as internal,
non-client-facing, and `denied` to sessions. No generated bindings were
hand-edited. Run the dry run, review with Kevin, then call the reducer per
company as the operator.
