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
- Runbook `docs/guides/qdrant-1.17-cutover-runbook.md`.

## Validated

- `pnpm --dir web exec tsx --test lib/ai-index-drain-path.test.ts` passed (1 suite, Node 22).
- `rustfmt --edition 2021` applied to changed Rust files.

## Not validated

- Rust was NOT compiled or tested locally (the contracts crate exceeds this host's memory).
  CI is the first compile of the gateway and api-server changes.
- `release-compatibility-manifest.json` catalog checksum must be regenerated with
  `cargo run -p api-server --example migration_catalog_checksum`.
- No Postgres integration test for the queue SQL; no live Qdrant or provider calls.

## Not done

Imported-history indexing (module_backfill_record), the operator bulk reindex and its
`embedding_reindex` grant. See the PR for the reasons.
