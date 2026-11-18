# AIH-33: count answer-gate failures and allow one shape repair (WIP)

Status: draft. The gateway suite passed in the Cloud Runner after preparing the vendored contracts.

## Done
- `WithholdReason` enum + fixed `notice::*` strings (user text unchanged) in `ai-gateway/src/orchestrator/text_answer_gate.rs`; gate, RAG release and `output_gate` use it. Typed `RagSubmissionRejected` for provider-contract failures (carries token usage).
- `routes/rag_outcome.rs`: per-turn outcome (withhold reason, provider, model, language, null plan kind, tokens, repair attempts) recorded as one `ai_agent_run_step` (tool `rag_answer_outcome`; no schema/reducer change, no contracts release); 7-day aggregation; `POST /v1/evidence/rag-outcomes`.
- `rag.rs`: optional `locale` request field; one shape-only repair (MalformedSubmission, NoClaims, CoverageGap) via `release_with_one_repair` / `repair_rag_generation` (same routed provider, spend admission, `enforce_chargeable_limits`, fresh spend scope base 500); completion log fields; unit tests.
- api-server BFF `/ai/evidence/rag-outcomes`; Next route; `RagOutcomesPanel` in the evidence reviewer tab; locale sent from web chat; en i18n keys; mapper test (Node 22, passes).

## CI follow-ups
- Regenerated `erp-skills/catalog.json` for the new `locale` field. Its verifier and all eight benchmark-script tests passed. The updated branch passed CI scope classification.
- The next frontend job failed before the browser tests ran: installing Chromium's Ubuntu dependencies timed out on the EC2 regional archive. CI and E2E smoke now use the shared HTTPS archive installer. No browser validation was skipped.
- `cargo test --locked -p ai-gateway --bin gateway`: 1,060 passed, 13 ignored. Hosted browser validation still depends on the new CI run.

## Remaining
- Confirm CI, including the Rust and browser jobs.
- Eval corpus under `erp-skills/evals/` (record, follow-up, summary, ambiguous, injection, access-revoked-mid-turn x en, fr, rw, sw, pt-BR) or a Rust replay test: NOT started.
- Frontend typecheck (`tsc`) and existing web tests not confirmed.
- Outcome read is org-wide `LIMIT 20000` unordered, filtered to company/7d in Rust (`truncated` flag); consider a SQL time filter.
- The outcome step appears in run step lists as `rag_answer_outcome`; step_count is overwritten by completion.
- Expected rebase conflicts in `rag.rs` with AIH-30/31/32.
