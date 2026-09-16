# H6 low_stock pilot — handoff (AIH-19, M6)

**Parent:** `codex/ai-harness-role-capability-grants` @ `db832126a` (rebased onto `origin/main` `afa23b702` — contracts v0.3.46)
**Branch:** `codex/ai-harness-h6-pilot-low-stock`
**Plan authority:** `ai-harness-completion-plan.md:483` stacked ledger row H6 + `ai-harness-luna-execution-plan.md:12` pilot order

`low_stock` is green, read-only, one-step/one-tool, company-scoped, and already has immutable certification fixtures (`harness/low_stock.rs`, `harness/certification_fixtures.rs`). It is the only skill admitted in this slice.

## Declared pilot matrix (per AIH-19)

| Dimension | Admitted | Explicitly deferred for this pilot |
|---|---|---|
| **Capabilities** | `inventory.products.read`, `inventory.stock-locations.read`, `inventory.stock-quants.read` (3 entries in `agent-capability-metadata.json`) + `inventory.low_stock.v1` (`harness/low_stock.rs`) — global ceilings 100 rows / 65536 bytes | no web research, no `scoped_sql`/`tenant_files` beyond frozen low_stock, no draft/mutation tools |
| **Transport** | `agent_loop.rs` + `spend_admission.rs` + `invocation_policy.rs` via `run_skill_admitted` → `run_recorded_loop` | no live Mistral/Gemini dispatch — mocked `LlmCompletion` in tests; no provider fallback wiring |
| **Policy** | per-call `ReviewedInvocationPolicy` (exact reviewed `PlannedToolCall` match), role-grant narrowing (`ai_capability_role_grant` → `GET /v1/ai/capability-grants` → `GeneratedReadTools`) — min(global, effective role max) + field `ResourceRegistry` checks | no new `PolicyEngine` rules beyond low_stock manifest |
| **Budget** | `SpendAdmittedLlm` reservation→accept→dispatch→settle via `StdbSpendLedger` (staging on `origin/main` contracts) | no H5c accepted-intent row before I/O, no H5d provider-instance isolation |
| **Evidence/recovery** | `AiAgentRun` + `AiAgentRunStep` append + `progress.rs` non-progress (evidence fingerprint) | no AIH-13/14 source/decision lineage, no AIH-15 answer gate, no AIH-20 question, no AIH-21 diagnostics, no AIH-23 checked continuation/compaction |
| **Certification** | persisted fixture `inventory.low_stock.v1` via authorized `Scope(organization_id, company_id)` reads | no browser/UI admission evidence yet (separate H8) |

The branch must stay **flagged and reversible**: pilot skill runs only when the caller supplies reviewed calls + `HARNESS_PILOT_LOW_STOCK=1` / manifest skill `low_stock` v1; legacy `run_skill_unlocked` remains frozen (`legacy_fence.rs` keeps `low_stock` fenced).

## Exit gate for this PR (M6 pilot part of H6)

- One **persisted scoped certification** for `low_stock` through `run_skill_admitted` with:
  - authorized `ToolContext(org_id, company_id, run_id)` + `actor` credentials,
  - effective role grants applied (absence = denial; multiple roles = max),
  - spend ledger exercised (mocked in `ai-gateway` unit test; live STDB replay separate),
  - `agent_loop` start event before first provider call and `AiAgentRun` wait/failed finalization per `agent_loop_adapters.rs:run_finalization`.
- `cargo test --locked -p ai-gateway --bin gateway` green for `agent_loop`, `invocation_policy`, `progress`, `spend_admission`, `generated_read`, and a new `h6_low_stock_pilot` fixture (2 tool calls → candidate answer still requires M2 gate).
- `cargo check --locked --tests` for `spacetimedb` (reducers `set_ai_capability_role_grant` / `delete_ai_capability_role_grant` + `run_ai_capability_grants_tests`).
- No change to `lumiere-codegen/storage-policy-manifest.json` shape beyond what `codex/ai-harness-role-capability-grants` already staged; presentation-IR save/reopen stays intact.

## Next branches (not in this PR)

- **H7** `low_stock` → `report_composer` → `insights_scan` etc — one skill/batch per PR, each moved off `legacy_fence`.
- **Evidence foundation** (AIH-13/14) and **answer gate** (AIH-15) remain parents for full M6; this pilot records explicit deferrals, not a pass.
- **H8** transcript/usage surfaces consume the same `AiAgentRunStep` table.

## Local validation

```bash
cargo check --locked -p ai-gateway
cargo test --locked -p ai-gateway --bin gateway -- agent_loop invocation_policy progress spend_admission generated_read
cargo check --locked --tests --manifest-path spacetimedb/Cargo.toml
make check-codegen-pinned   # after any capability metadata change
```
