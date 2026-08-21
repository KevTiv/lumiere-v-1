# AI Harness Completion — Tracked Issues

Derived from
[`ai-harness-completion-plan.md`](./ai-harness-completion-plan.md). Each
issue is independently mergeable behind the existing route/table contracts;
sequence follows the plan's "Suggested Implementation Order." Estimates are
rough sizing (S/M/L), not commitments.

---

### AIH-1 — Add tool-calling wire format to `LlmClient`

**Plan ref:** §3.1. **Depends on:** none. **Size:** M

Extend `ai-gateway/src/providers/llm.rs`:
- `LlmRequest` gains `pub tools: Vec<ToolSpec>` (name, description, JSON
  schema).
- `LlmResponse` gains `pub tool_calls: Vec<ToolCallRequest>`.
- `complete_mistral`: add `tools`/`tool_choice` to the existing
  OpenAI-compatible payload (`openai_payload`); parse
  `choices[0].message.tool_calls`.
- `complete_gemini`: map `ToolSpec` → `functionDeclarations`; parse
  `candidates[0].content.parts[].functionCall`.
- `complete_via_kong`: pass `tools` through unchanged; if the response has
  no `tool_calls`, treat as a plain completion (no hard fail).

**Acceptance:** existing callers that don't set `tools` see no behavior
change; a unit test against a fixture Mistral/Gemini tool-call response
correctly populates `LlmResponse.tool_calls`.

---

### AIH-2 — Add tool JSON-schema metadata to `AgentTool`

**Plan ref:** §3.1. **Depends on:** none (parallel with AIH-1). **Size:** S

Add `fn schema(&self) -> serde_json::Value` to the `AgentTool` trait in
`ai-gateway/src/tools/registry.rs`; implement for all 7 existing tools
(`erp_snapshot`, `erp_search`, `analytics_summary`, `web_search`,
`fetch_url`, `action_draft`, `save_artifact`). Add a
`ToolRegistry::specs_for(allowed_actions) -> Vec<ToolSpec>` helper that
filters by `required_action` the same way execution already does.

**Acceptance:** schema output is valid JSON Schema and round-trips through
AIH-1's `ToolSpec`.

---

### AIH-3 — Build `agent_loop.rs` orchestrator

**Plan ref:** §3.2. **Depends on:** AIH-1, AIH-2. **Size:** L

New `ai-gateway/src/orchestrator/agent_loop.rs` with
`run_agentic_skill(state, ctx, agent, skill, req) -> Result<RunSkillResponse>`:
- Per iteration: build `LlmRequest` (system + transcript + filtered tools)
  → `providers.llm.complete` → if `tool_calls` present, execute via
  `ToolRegistry` → append `AiAgentRunStep` per call → feed `tool_result`
  back → repeat.
- Enforce max steps, max tokens, and a **per-call** budget check against
  `AiAgent.monthly_spend` (today's orchestrator only checks once per run).
- Terminate cleanly when the model returns no `tool_calls`, or route
  mutating tool calls into `AiActionDraft` creation and stop (no
  auto-execution).
- Treat malformed `tool_call` JSON as a terminal error with a populated
  `AiAgentRunStep.error_message`, not a retry loop.

**Acceptance:** a scripted fixture conversation (mocked `LlmClient`
response) drives the loop through 2+ tool calls and a final answer, with
one `AiAgentRunStep` row per tool call plus correct step/budget cap
enforcement in unit tests.

---

### AIH-4 — Route every planned tool call through the policy engine

**Plan ref:** §3.2 (last bullet). **Depends on:** AIH-3. **Size:** M

Call `harness::policy_engine` before executing each tool call inside
`agent_loop.rs`, not only at skill entry (today only the 9
`legacy_fence.rs`-listed skills get any policy check at all). Denials
become an `AiAgentRunStep` with a policy-denial reason instead of a silent
skip.

**Acceptance:** a fixture run attempting a denied tool/action is blocked,
logged with a denial reason, and does not halt the rest of the loop unless
the skill has no valid next step.

---

### AIH-5 — Budget-aware Mistral → Gemini model selection

**Plan ref:** §2, §3.4. **Depends on:** AIH-3. **Size:** S

Before the first provider call in `agent_loop.rs`, resolve
`AiAgent.allowed_models` against Mistral-first/Gemini-fallback priority and
current `monthly_spend` vs. budget. Log the selection + reason on the run
record. Kong/Ollama behavior unchanged (Kong stays available as an
alternate proxy target; Ollama has no tool-calling requirement — loop
degrades to single-shot).

**Acceptance:** with Mistral over budget or rate-limited (mocked), the loop
selects Gemini and records why; with both unavailable, run fails with a
clear audit reason rather than silently using Ollama for a tool-calling
skill.

---

### AIH-6 — Migrate skills off `run_skill_unlocked` onto `agent_loop.rs`

**Plan ref:** §3.3. **Depends on:** AIH-3, AIH-4, AIH-5. **Size:** L
(ongoing, one PR per skill or small batch)

Expand `legacy_fence.rs`'s blocked list skill-by-skill, pointing each at
`agent_loop.rs` instead of `run_skill_unlocked`'s `if`-chain. Freeze
`run_skill_unlocked`: no new skills added to it from this point forward.
Use the existing certification pipeline (`harness::certification`) as the
promotion gate per skill.

**Acceptance:** tracked as a checklist of skill names; each checked off
once its fixture certification passes on `agent_loop.rs` and it's added to
`legacy_fence.rs`.

---

### AIH-7 — Live step transcript UI

**Plan ref:** §4.1. **Depends on:** AIH-3 (needs real `AiAgentRunStep`
rows to render). **Size:** M

Extend `ai-chat-panel.tsx` (or a new shared component) to render
`AiAgentRunStep` rows live: tool name, arguments, result summary, duration,
and policy-denial reason when present. Add
`frontend/web/app/api/ai/runs/[runId]/steps/route.ts` (poll or stream)
following the existing `requireAiRouteContext` + `validateCompanyScope`
pattern.

**Acceptance:** running a harness-migrated skill in the chat panel shows
each tool call appear as it happens, including a denied step rendered
distinctly from a successful one.

---

### AIH-8 — Model/cost indicator on transcript

**Plan ref:** §4.2. **Depends on:** AIH-5, AIH-7. **Size:** S

Surface which provider (Mistral/Gemini/Kong) served each run and its token
cost next to the transcript, sourced from `record_ai_spend`.

**Acceptance:** transcript view shows provider name and cost per run,
matching the value written by AIH-5's selection logging.

---

### AIH-9 — "Runs" tab on `ai-harness` admin page

**Plan ref:** §4.3. **Depends on:** AIH-7. **Size:** S

Add a tab to `ai-harness-client.tsx` listing recent `AiAgentRun` rows across
all skills (not just Report Composer/Low Stock/Red Action Drafts),
filterable by skill/agent/outcome, linking into the AIH-7 transcript view.

**Acceptance:** admin can find any run from the last N days and open its
transcript without querying the database directly.

---

### AIH-10 — Usage insights read model

**Plan ref:** §5.1. **Depends on:** AIH-6 (needs real loop-driven volume
to be meaningful, though the read model itself can be built earlier and
backfilled). **Size:** M

New aggregation (SpacetimeDB read model preferred) over `AiAgentRun`,
`AiAgentRunStep`, `AiActionDraft`, and `record_ai_spend`, grouped by
org/user/week: run count per skill, tool-usage frequency, action-draft
approve/reject/expire rate, spend trend.

**Acceptance:** query returns correct weekly aggregates against a seeded
fixture dataset of runs/drafts/spend.

---

### AIH-11 — Usage insights dashboard tab

**Plan ref:** §5.2. **Depends on:** AIH-10. **Size:** S

New tab on `ai-harness-client.tsx`: adoption chart, action-draft approval
rate, spend vs. budget, most/least-used skills.

**Acceptance:** org admin can see weekly AI usage trends without a manual
data pull.

---

### AIH-12 — (Optional) Weekly usage digest via `daily_briefing` pattern

**Plan ref:** §5.3. **Depends on:** AIH-10. **Size:** S

Reuse the existing `daily_briefing` skill delivery mechanism to push a
weekly AI-usage digest to org admins, rather than building new delivery
infra.

**Acceptance:** a scheduled run produces a digest matching AIH-11's
dashboard numbers for the same week.

---

## Explicitly deferred (not in this issue list)

- Promoting `tools/scoped_sql.rs` / `tools/tenant_files.rs` from
  fixture-only to production (per plan §3, point 5) — tracked separately
  under `ai-unified-execution-capabilities-subagent-plan.md`, only after
  AIH-6 proves the loop stable.
- Any Anthropic Messages API integration — explicitly out of scope for cost
  reasons per plan §2.

## Suggested batching for PRs

1. AIH-1, AIH-2 (parallel, both prerequisites)
2. AIH-3
3. AIH-4, AIH-5 (parallel, both depend only on AIH-3)
4. AIH-7 (can start once AIH-3 lands, in parallel with AIH-4/5)
5. AIH-6 (ongoing checklist, starts once 3/4/5 land)
6. AIH-8, AIH-9 (parallel, depend on AIH-7 + AIH-5)
7. AIH-10 → AIH-11 → AIH-12
