# AI Harness Completion Plan (Mistral/Gemini-first)

## Scope

Close the gap between the current AI gateway (a governed, deterministic
skills platform) and a Claude-Code/OpenCode-style harness — an agent that
reasons over tool results in a loop, backed by the audit and approval
infrastructure that already exists — without adding an Anthropic API
dependency. Cost is the constraint: the agentic loop, and any future
model-facing capability, is built on **Mistral first, Gemini second**, using
the existing `LlmClient`/Kong routing. This plan intentionally manages and
finishes the current setup rather than replacing it: existing tables,
routes, and the harness/orchestrator split stay; the work fills the
documented gaps in
[`ai-enterprise-harness-plan.md`](./ai-enterprise-harness-plan.md) and
[`ai-unified-execution-capabilities-subagent-plan.md`](./ai-unified-execution-capabilities-subagent-plan.md).

## Current Codebase References

- `ai-gateway/src/providers/llm.rs`: `LlmClient::complete` routes to Kong
  (OpenAI-compatible) or `complete_mistral`/`complete_gemini`/`complete_ollama`
  directly. No tool-calling request/response shape exists yet — `LlmRequest`
  is a plain system+messages completion.
- `ai-gateway/src/providers/factory.rs`: `build_embedder`/vision provider
  selection already supports `mistral`/`gemini`/`ollama` via
  `EMBEDDING_PROVIDER`/`VISION_PROVIDER`; same pattern should extend to a
  chat-tool-calling mode.
- `ai-gateway/src/orchestrator/run.rs`: `run_skill_unlocked` — the hard-coded
  `if allowed_tools.iter().any(|t| t == "...")` chain (erp_snapshot →
  erp_search → analytics_summary → web_search → `synthesize_summary` → save
  artifact). This is the function the new loop replaces for harness-migrated
  skills.
- `ai-gateway/src/tools/registry.rs`: `AgentTool` trait, 7 tools
  (`erp_snapshot`, `erp_search`, `analytics_summary`, `web_search`,
  `fetch_url`, `action_draft`, `save_artifact`), each gated by
  `required_action` against `ResolvedAgentConfig.allowed_actions`.
- `ai-gateway/src/harness/legacy_fence.rs`: blocks 9 named skills from the
  legacy orchestrator, forcing them onto `harness::*`. All other skills still
  run through `run_skill_unlocked`.
- `ai-gateway/src/harness/{policy_engine,privacy_guard,audit,audit_logger,
  data_scope_resolver}.rs`: policy/audit layer that only the 9 fenced skills
  use today.
- `spacetimedb/src/ai/skills.rs`: `AiAgentRun`/`AiAgentRunStep` — the
  per-run/per-step audit tables the loop must write to on every iteration,
  not only at skill boundaries.
- `spacetimedb/src/ai/agents.rs`: `AiAgent.allowed_models`/`allowed_actions`/
  `monthly_spend` — per-org model/budget config the loop must read before
  each provider call.
- `frontend/packages/ui/src/ai-chat/ai-chat-panel.tsx` and
  `frontend/web/app/(modules)/ai-harness/ai-harness-client.tsx`: chat and
  admin surfaces that need a transcript view wired to per-step data.

## 1. Current Codebase Evidence

The data model for a harness already exists: agent/persona config, chat
sessions, per-run and per-step audit rows, action-draft approval lifecycle,
skill versioning/certification, and a reducer allowlist. What is missing is
the *execution model*: nothing anywhere runs an LLM-driven
reason-act-observe loop. Every skill is a fixed Rust sequence with a single
LLM call at the end to write prose (`synthesize_summary`). There is also no
tool-calling wire format on the LLM client — `LlmRequest`/`LlmResponse` in
`providers/llm.rs` only carry plain text messages. Two execution paths
coexist (`orchestrator::run_skill` vs. `harness::*`), and the plan docs
already flag scoped-SQL/tenant-file tools as fixture-only, not production
capabilities.

## 2. Provider Priority (Cost-Driven)

Reject an Anthropic Messages API integration for this phase. Use:

1. **Mistral** — primary. `mistral-large-latest` (or current tool-calling
   tier) supports OpenAI-compatible function calling; cheapest per-token
   default in current config (`complete_mistral` already implemented).
2. **Gemini** — secondary/fallback. `gemini-2.0-flash` or newer supports
   function calling via its native tool schema; used when Mistral is rate
   limited, over budget, or an org's `AiAgent.allowed_models` excludes
   Mistral.
3. **Kong / Ollama** — unchanged as-is: Kong stays available for orgs that
   proxy to a self-hosted or alternate OpenAI-compatible endpoint; Ollama
   remains the local/dev fallback with no tool-calling requirement (loop
   degrades to single-shot for Ollama-only orgs).

No new provider crate/SDK is required — the existing `reqwest`-based direct
HTTP calls in `providers/llm.rs` are extended with a `tools` field in the
request and parsed `tool_calls`/`functionCall` blocks in the response,
mirroring what `complete_mistral`/`complete_gemini` already do for plain
completions.

## 3. Backend Changes

1. **Tool-calling wire format** — extend `providers/llm.rs`:
   - Add `pub tools: Vec<ToolSpec>` to `LlmRequest` (name, description, JSON
     schema, sourced from `tools/registry.rs::AgentTool` metadata — add a
     `fn schema(&self) -> Value` to the `AgentTool` trait).
   - Add `pub tool_calls: Vec<ToolCallRequest>` to `LlmResponse`.
   - `complete_mistral`: pass `tools`/`tool_choice` in the OpenAI-compatible
     payload (`openai_payload` already builds this shape; add the `tools`
     array), parse `choices[0].message.tool_calls`.
   - `complete_gemini`: map `ToolSpec` to Gemini's `functionDeclarations`,
     parse `candidates[0].content.parts[].functionCall`.
   - `complete_via_kong`: pass tools through unchanged (Kong is already
     OpenAI-compatible); if the org's Kong-proxied model doesn't support
     tool calls, the loop must detect the absence of `tool_calls` in the
     response and fall back to single-shot (do not hard-fail).

2. **Agentic loop module** — new `ai-gateway/src/orchestrator/agent_loop.rs`:
   - `run_agentic_skill(state, ctx, agent, skill, req) -> Result<RunSkillResponse>`.
   - Per iteration: build `LlmRequest` with system prompt + accumulated
     transcript + `tools` (filtered to `allowed_tools ∩ ResolvedAgentConfig.allowed_actions`)
     → call `providers.llm.complete` → if `tool_calls` present, execute each
     via the existing `ToolRegistry` (same permission gate as today) → append
     an `AiAgentRunStep` per call (tool_name, input_hash, output_summary,
     duration_ms, error_message — reuse the existing `append_ai_agent_run_step`
     shape) → feed `tool_result` back as the next message → repeat.
   - Hard caps: max steps (reuse `max_steps` already used in
     `run_skill_unlocked`), max tokens, and a per-run budget check against
     `AiAgent.monthly_spend` before every provider call, not only at skill
     start — this is new; today budget is only checked once per run.
   - Terminate when the model returns a response with no `tool_calls`, or
     any tool requires `action_draft` (mutating) — in that case do not
     auto-execute; create the `AiActionDraft` exactly as
     `tools/action_draft.rs` does today and stop the loop pending approval.
   - Route through `harness::policy_engine` for every planned tool call
     before execution (today only the 9 fenced skills get policy checks —
     the new loop must go through policy for every step, closing the gap
     called out in `ai-enterprise-harness-plan.md`).

3. **Migrate remaining skills off `orchestrator::run_skill_unlocked`** —
   expand `legacy_fence.rs`'s blocked list until it covers all skills, and
   point them at `agent_loop.rs` (harness-policy-gated) instead of writing a
   parallel hard-coded `if`-chain for each new one. Do not add new skills to
   `run_skill_unlocked` going forward; treat it as frozen/deprecated from
   this point.

4. **Budget-aware model selection** — before the first provider call in
   `agent_loop.rs`, resolve `AiAgent.allowed_models` against the Mistral →
   Gemini priority order in §2 and current `monthly_spend` vs. budget; log
   the selection reason to the run record so cost decisions are auditable
   after the fact.

5. **Do not** promote `tools/scoped_sql.rs`/`tools/tenant_files.rs` to
   production as part of this plan — that is explicitly scoped in
   `ai-unified-execution-capabilities-subagent-plan.md` and should land
   after the loop is stable, since a real SQL/file tool inside an
   LLM-driven loop is a materially bigger blast radius than inside a fixed
   `if`-chain. Track as a follow-on, not in this plan's milestones.

## 4. Frontend Changes

1. **Live transcript view** — extend `ai-chat-panel.tsx` (or a new sibling
   component reused by both the chat panel and the `ai-harness` admin page)
   to render `AiAgentRunStep` rows as they're appended: tool name, arguments,
   result summary, duration, and any policy denial reason. This is the
   direct UX parity item with Claude Code's own step-by-step transcript.
2. **Model/cost indicator** — surface which provider (Mistral/Gemini/Kong)
   served each run and its token cost next to the transcript, sourced from
   `record_ai_spend`, so cost-consciousness is visible to the operator, not
   just enforced server-side.
3. **`ai-harness` admin page** — add a "Runs" tab listing recent
   `AiAgentRun` rows across skills (not just the existing Report
   Composer/Low Stock/Red Action Drafts tabs), filterable by skill, agent,
   and outcome, linking into the transcript view in (1).
4. No new BFF routes are required for the loop itself — reuse
   `/api/ai/skills/run` (unchanged contract: request in, final answer +
   citations + optional action draft out); the loop is an internal
   implementation change on the gateway side. Add one new BFF route,
   `frontend/web/app/api/ai/runs/[runId]/steps/route.ts`, for the transcript
   poll/stream in (1), following the existing `requireAiRouteContext` +
   `validateCompanyScope` pattern.

## 5. Usage Insight Generation (New)

No plan doc currently covers this; `AiInsight`/`insights_scan` are business
anomaly detectors, not AI-usage analytics.

1. New read model (SpacetimeDB or a gateway-side aggregation over existing
   tables — prefer SpacetimeDB for consistency with other read models):
   aggregate `AiAgentRun` (count, skill, outcome), `AiAgentRunStep` (tool
   usage frequency), `AiActionDraft` (approve/reject/expire rate), and
   `record_ai_spend` (cost trend), grouped by org/user/week.
2. Surface as a new tab on the `ai-harness` admin page: adoption (runs per
   week per skill), approval rate on action drafts (signal for whether the
   agent's suggestions are trustworthy), spend trend vs. budget, and
   most-used vs. never-used skills (candidates for deprecation or promotion
   review in the skill registry workflow).
3. Optional: reuse the existing `daily_briefing` skill pattern to push a
   weekly usage digest to org admins through the same channel as other
   briefings, rather than building a new delivery mechanism.
4. This is read-only and additive — no new write paths, no policy engine
   changes required. Sequence after §3/§4 land so there's loop-driven data
   worth aggregating; can proceed in parallel with §4 UI work otherwise.

## 6. Risks / Open Questions

- Confirm current Mistral/Gemini model tiers actually support function
  calling in the account's plan before committing §3 — if not, restrict the
  first release to Mistral only and add Gemini once confirmed.
- Tool-calling loops can silently loop or stall on malformed tool_call JSON
  from the model; `agent_loop.rs` must treat a parse failure as a terminal
  error with a clear `AiAgentRunStep` error_message, not a retry-forever.
- Per-step policy checks (§3.2) add latency per tool call; measure against
  existing skill latency before rolling out to high-traffic skills.
- Decide whether budget checks abort mid-run (partial transcript, no final
  answer) or let the current step finish before stopping — affects UX in
  §4.1.

## Suggested Implementation Order

1. Extend `LlmRequest`/`LlmResponse` and `complete_mistral`/`complete_gemini`
   with tool-calling support (§3.1). No behavior change for existing
   callers that don't pass `tools`.
2. Build `agent_loop.rs` behind a feature flag / new skill category, tested
   against 1–2 low-risk green skills first (reuse existing fixtures from
   `harness::certification`).
3. Wire the transcript UI (§4.1–4.3) against the flagged skills so the loop
   is observable before wider rollout.
4. Migrate remaining non-fenced skills from `run_skill_unlocked` to
   `agent_loop.rs` (§3.3), skill by skill, using the existing certification
   pipeline as the promotion gate.
5. Build usage insights (§5) once there's real run/step volume to aggregate.

## Milestones and Acceptance Criteria

- A green skill runs through `agent_loop.rs` on Mistral, falls back to
  Gemini when Mistral is unavailable/over budget, and produces the same
  `AiAgentRun`/`AiAgentRunStep` audit shape as today's orchestrator, plus
  per-step policy checks.
- The chat panel and `ai-harness` admin page render a live step transcript
  for any harness-run skill, including denied/blocked steps.
- No skill runs through `run_skill_unlocked` for any newly authored skill;
  all existing skills are migrated or explicitly deferred with a tracked
  reason.
- An org admin can see, per week, how many agent runs happened, which
  skills were used, action-draft approval rate, and spend vs. budget,
  without a manual data pull.

## Security and Privacy Considerations

Everything in `ai-enterprise-harness-plan.md` §7 applies unchanged: no layer
trusts a browser/model-supplied company ID, tool, or role; secrets stay
server-side; policy defaults deny. The loop adds one new surface — a
model-chosen sequence of tool calls instead of a fixed one — so the policy
engine must evaluate every planned call, not just the skill's entry point,
and mutating tools must always route through `AiActionDraft` rather than
executing directly, regardless of what the model requests.
