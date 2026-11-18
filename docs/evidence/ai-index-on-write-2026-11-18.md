# AIH-30 index on write: evidence

Date: 2026-11-18. Branch `claude/aih-30-index-on-write`, base `main` fcde3069.

## What changed

- Migration 52 `ai_index_job` (change set 41, expand): credential-free durable queue.
- api-server `ai_index_queue` and `/v1/ai/index-jobs/{claim,report,status}`; typed and
  compat reducer routes enqueue after a successful id-bearing write (best effort).
- Gateway: `ingest_references` extracted from `post_ingest`; `context_worker` drains an
  actor's jobs via `POST /v1/context/index-jobs/drain`; `POST /v1/context/coverage`;
  `RigContext::count_company_points`; third empty-reply case in `rag.rs`.
- BFF: after a successful operation write, `after()` triggers the drain with the actor's
  own session.
- Step 6: `gateway reindex-company --check|--apply` is a private operator command
  with an explicit `embedding_reindex` grant, an exact organization/company and
  ID interval, hard row/byte ceilings, and a per-invocation monetary cap enforced
  against the native reservation before dispatch. It reuses the existing spend
  reducers and operator enrollment probe; no schema change or contracts release
  was added for this step.
- Bulk vectors share a company namespace, separate from actor-owned write points.
  They index only the allowlisted display field. The gateway uses separate ANN
  candidate lanes and requires the asking actor's live authorized display field
  to match the indexed fingerprint before accepting a shared hit. Reader denials
  do not delete shared points. Daily briefing remains actor-activity only.
- Runbook `docs/guides/qdrant-1.17-cutover-runbook.md`.

## Validated

- `pnpm --dir web exec tsx --test lib/ai-index-drain-path.test.ts` passed (1 suite, Node 22).
- Cloud Runner: verified the vendored Rust contracts, then passed
  `cargo check --locked -p api-server -p ai-gateway --tests` on the #447 base.
- `cargo test --locked -p ai-gateway --bin gateway`: 1,063 passed, 13 ignored.
  New tests cover exact operator scope, per-run cap refusal before dispatch,
  fingerprint scoping, and a loopback record owner that hides the indexed display
  field for one reader and then revokes the other reader's record access.
- `rustfmt --edition 2021` applied to changed Rust files.

## Not validated

- `release-compatibility-manifest.json` catalog checksum must be regenerated with
  `cargo run -p api-server --example migration_catalog_checksum` when rebasing
  after AIH-37 and moving the queue migration to 53.
- No Postgres integration test for the queue SQL. No live SpacetimeDB operator
  grant, Qdrant backfill, paid provider call, or cutover was attempted. The runbook
  includes the staging acceptance steps.

## Not done

Imported-history indexing (`module_backfill_record`), create-ID readback, and the
coverage/status UI are separate remaining AIH-30 work.
