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
- On `a8e4768`, hosted E2E smoke, Rust, frontend typecheck, and Chromium installation passed. The accounting browser job then caught four inspector assertions that did not account for the new `rag-outcomes` read. The fixture now verifies the company-scoped read and renders a synthetic report, while still asserting the exact inspection requests and rejecting unexpected calls.
- All six inspector browser tests passed locally on Node 26 with pinned Chromium at both viewport widths. The two outcomes parser tests passed. The full hosted CI rerun is still needed.
- `cargo test --locked -p ai-gateway --bin gateway`: 1,060 passed, 13 ignored.
- Reconciled the branch with `main` at #448: the initial gate and any shape repair
  share the same attachment evidence, the browser sends both attachments and the
  locale, and typed withhold reasons still use the shared history notice.
- Synced with `main` through #451. The assistant request retains attachments,
  history references, and the session-scoped `clear_anchors` flag alongside
  `locale`. The skill catalog check, web typecheck, 40 focused web tests, Rust
  check of API and gateway test targets, and 72 gateway RAG tests passed locally.

## Remaining
- Confirm the full hosted CI run on the updated draft.
- Eval corpus under `erp-skills/evals/` (record, follow-up, summary, ambiguous, injection, access-revoked-mid-turn x en, fr, rw, sw, pt-BR) or a Rust replay test: NOT started.
- Outcome read is org-wide `LIMIT 20000` unordered, filtered to company/7d in Rust (`truncated` flag); consider a SQL time filter.
- The outcome step appears in run step lists as `rag_answer_outcome`; step_count is overwritten by completion.
- Expected rebase conflicts in `rag.rs` with AIH-30/31/32.
