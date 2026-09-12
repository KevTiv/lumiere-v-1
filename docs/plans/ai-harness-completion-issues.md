# AI Harness Completion — Tracked Issues

Derived from
[`ai-harness-completion-plan.md`](./ai-harness-completion-plan.md). Each
issue is independently mergeable behind compatible, generated contract changes;
sequence follows the plan's "Suggested Implementation Order." Estimates are
rough sizing (S/M/L), not commitments.

**Plan revision:** 2026-09-05. AIH-13–19 add evidence and intellectual
provenance requirements; all entries are planned, not verified by this revision.
AIH-20–24 add interactive execution/recovery to base gates; AIH-25/26 are later
specialist/extension admission. The advanced harness remains deferred from first core deployability. Milestone
and gate ownership is in the completion plan; record implementation revision,
test/run evidence and reviewer before marking any gate passed.

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
- Treat output without `tool_calls` as a candidate final answer, subject to
  AIH-15 before user-facing admission, or route
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

**Acceptance:** with Mistral unavailable, rate-limited or at a provider-specific
cap (mocked), the loop selects allowed Gemini only within remaining org/run
budget and records why. Exhausted org/run budgets deny all fallback; with both unavailable, run fails with a
clear audit reason rather than silently using Ollama for a tool-calling
skill.

---

### AIH-6 — Migrate skills off `run_skill_unlocked` onto `agent_loop.rs`

**Plan ref:** §3.3, §7, M6. **Depends on:** AIH-3, AIH-4, AIH-5, AIH-19. **Size:** L
(ongoing, one PR per skill or small batch)

Expand `legacy_fence.rs`'s blocked list skill-by-skill, pointing each at
`agent_loop.rs` instead of `run_skill_unlocked`'s `if`-chain. Freeze
`run_skill_unlocked`: no new skills added to it from this point forward.
Use the existing certification pipeline (`harness::certification`) and the
applicable evidence gates as the promotion gate per skill. Flagged pilot skills
used to prove AIH-19 may run earlier; this issue governs wider migration.

**Acceptance:** tracked as a checklist of skill names; each checked off
once its certification and evidence gates pass on `agent_loop.rs` and it's added
to `legacy_fence.rs`. Include RAG, deterministic and fallback answer paths in
the admission matrix; unresolved paths stay explicitly deferred.

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
distinctly from a successful one. Scope/redaction applies to tool arguments and
results; candidate prose is not streamed as a validated final answer before AIH-15.

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
Include claim-coverage and support-check outcomes, attribution completeness,
unresolved component links, stale-dependency reuse, review outcomes and
verification cost from AIH-15–19. Keep deterministic, model-assisted and human
verification outcomes distinct; approval rate alone does not measure correctness.
Add scoped question wait/re-ask, repair success/cost, non-progress stop, context
recovery and interruption/reconciliation metrics from AIH-20–24. Do not count
successful cancellation as a business rollback.

**Acceptance:** query returns correct weekly aggregates against a seeded
fixture dataset of runs/drafts/spend.

---

### AIH-11 — Usage insights dashboard tab

**Plan ref:** §5.2. **Depends on:** AIH-10. **Size:** S

New tab on `ai-harness-client.tsx`: adoption chart, action-draft approval
rate, spend vs. budget, most/least-used skills.
Also show the evidence-quality aggregates from AIH-10, with their scope and
verification method visible.

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

### AIH-13 — Versioned source, passage, and contribution contracts

**Plan ref:** §7.1/7.5, M1. **Depends on:** none. **Size:** L

Extend the existing artifact/ERP contract ownership with SourceVersion,
SourcePassage and Contribution records. Separate original author/organization
from discussion contributor; capture edition/date, exact passage coordinates,
content hash/snapshot, inspection state, scope and retention. Generate shared
types and authorized operations; keep semantic indexes derived. Reconcile source
origin, verification, domain approval and applicability as separate dimensions
across companion provenance plans.

**Acceptance:** persisted fixtures round-trip book/paper, company publication,
and ERP/policy sources through normal authorized reads. Unknown authors/pages
remain unknown, recalled sources remain unverified, cross-scope references deny,
and snapshots/extraction retain exact version identity. Actual document/network
ingestion requires its separately admitted capability.

---

### AIH-14 — Discussion decisions and component lineage

**Plan ref:** §7.1/7.2, M1. **Depends on:** AIH-13. **Size:** L

Persist typed claims/concepts, decisions, contribution-turn references, adaptations,
assumptions and versioned artifact-component bindings. Carry references through
context compilation, compaction/resume, generation and edits/forks. Use bounded
observable rationale; do not capture hidden reasoning traces.

**Acceptance:** after resume and component edit/fork, reconstruct the original
source → concept → decision → step/formula/code section using persisted records.
Changed/unresolved links require review; a source bibliography without component
links does not pass.

---

### AIH-15 — Claim validation and answer/publication gates

**Plan ref:** §7.3/7.5, M2. **Depends on:** AIH-3, AIH-4, AIH-5, AIH-14. **Size:** L

Implement a shared validator for candidate answers, artifact publication and
action-draft explanations. Resolve citations server-side; check reference and
passage identity, authorization, applicability, arithmetic, material-claim
coverage and prose support. Record verification method and limitations. Apply
bounded retrieval, qualified/abstained outcomes or domain review on failure;
preserve unverified drafts without allowing approved publication/execution.

**Acceptance:** fabricated IDs/pages/authors, irrelevant but valid citations,
conflicting effective dates, arithmetic errors and exhausted verification budget
cannot produce a validated unsupported claim. Streaming, report rendering and
single-shot/provider fallback cannot bypass the gate. A semantic model's pass
never substitutes for required domain approval.

---

### AIH-16 — Source and decision inspector

**Plan ref:** §4.5, M3. **Depends on:** AIH-7, AIH-14, AIH-15. **Size:** M

Provide a shared claim/component inspector with exact source passage/version,
author, introducing contributor/turn, interpretation/adaptation, validation
outcome and revision/review history. Reuse generated authorized read contracts.

**Acceptance:** a reviewer navigates from answer and workflow step to the exact
foundation through UI/API reads. Denied sources reveal no excerpt through the
inspector, transcript, exports or caches; unavailable originals are explicit.

---

### AIH-17 — Reviewed knowledge entries and scoped reuse

**Plan ref:** §7.4, M4. **Depends on:** AIH-14, AIH-15, AIH-16, AIH-20, AIH-24. **Size:** L

Add versioned non-executable concepts/interpretations and procedures with owners,
domain/applicability links, source dependencies and explicit review transitions.
Separate source fidelity, domain interpretation and implementation reviews.
Reuse the existing artifact/recipe foundations; successful repeated use only
nominates knowledge for review and never grants authority or permissions.

**Acceptance:** approve one concept and one procedure through authorized review,
retrieve them in a fresh task with their source/decision lineage, and deny
automatic approval from run counts or passing code tests. Derived entries do
not broaden access; cross-domain links respect current source authorization.

---

### AIH-18 — Source changes, reverse dependencies, and retention

**Plan ref:** §7.4, M5. **Depends on:** AIH-17. **Size:** L

Track reverse dependencies across claims, decisions, entries and components.
Handle source correction/supersession/retraction, access revocation and deletion;
invalidate derived caches and require review or deny reuse according to the
versioned dependency policy. Keep authorized historical versions or retention
tombstones without silently replacing the original evidence.

**Acceptance:** persisted source-change and revoked-access scenarios flag all
dependent fixtures, prevent stale/denied cached answers, block new execution
with invalid required dependencies, and preserve an honest historical inspection
state. A retained hash without source content is not claimed as full replay.

---

### AIH-19 — Harness setup, certification, and admission matrix

**Plan ref:** §7.5, §8, M0–M6. **Depends on:** AIH-1–5, AIH-7–9, AIH-13–18, AIH-20–24. **Size:** L

Configure versioned evidence requirements, source capability admission, reviewer
roles, applicability, retention, budgets and failure behavior. Bind runs to the
effective configuration. Extend certification with the plan's ERP/policy and
intellectual-source-to-workflow and interactive-recovery scenarios on flagged
pilot skills. Implement versioned Investigate/Design/Draft/Review mode profiles
and transitions within server authorization; delegation remains disabled until M8.
Record per-path capabilities, passed gates, evidence and explicit deferrals;
reuse this admission result for AIH-6 rather than waiting for wider migration.

**Acceptance:** all three scenarios pass using persisted records and normal authorized
API/UI reads, including compaction, adaptation, source changes, injected content,
fallback and revocation. Adapter fixtures cover provider variations; each
production provider/capability has its own smoke evidence before admission.
Mode escalation attempts deny; user steering cannot silently change approved
scope. Base admission requires M0–M5, and base completion additionally requires
M6/M7. Disabled specialists/extensions do not block the base, but cannot be
advertised as admitted until their M8/M9 gates pass.

---

### AIH-20 — Durable questions and user steering

**Plan ref:** §8.1, M3. **Depends on:** AIH-3, AIH-4, AIH-7, AIH-14. **Size:** M

Persist versioned question requests/replies with run/decision dependencies,
authorized respondents and required/optional semantics. Add `waiting-input` and
resume through the normal API/event contract. Record steering as objective and
decision revisions; invalidate affected candidates/checks/approvals.

**Acceptance:** a required answer blocks only dependent work; reconnect/restart
does not re-ask a resolved question. Duplicate replies are idempotent, stale or
unauthorized replies deny, timeout grants no required answer or action approval,
and changed requirements cannot reuse an obsolete approval.

---

### AIH-21 — Structured diagnostics and bounded repair

**Plan ref:** §8.2, M2. **Depends on:** AIH-15. **Size:** M

Return typed candidate/component diagnostics from admitted contract/domain
validators; preserve validator and candidate versions. Feed failures back for
bounded repair, then revalidate the revised candidate and its evidence links.

**Acceptance:** fixtures for incompatible schema, missing scope/reference,
forbidden operation and a violated available domain invariant yield actionable
diagnostics. Repairs create new versions; persistent errors or exhausted repair
budgets stop/require review and never publish a failing candidate.

---

### AIH-22 — Non-progress detection

**Plan ref:** §8.2, M0. **Depends on:** AIH-3, AIH-4, AIH-5. **Size:** M

Track normalized calls, evidence changes and repeated diagnostic/error state.
Enforce bounded replan/stop or route to an admitted question handler. Configure
polling/retry exceptions with time, attempt and backoff bounds; all consume the
same task budget across provider changes.

**Acceptance:** repeated no-result searches, unchanged errors and denied actions
trigger explicit non-progress outcomes. Legitimate bounded polling passes; model
switches and superficial input changes cannot reset limits. If clarification is
required but its handler is not admitted, stop with a recorded blocker.

---

### AIH-23 — Checked continuation and compaction

**Plan ref:** §8.3, M1. **Depends on:** AIH-14, AIH-20. **Size:** M

Persist/validate continuation manifests containing objective and decision refs,
constraints, questions/approvals, evidence/candidate versions, completed effects
and progress/budget state. Rebuild from authorized durable records on mismatch.

**Acceptance:** dropped source/question refs, changed constraints and forged
remaining budget in a summary cause recovery or a blocked continuation. Resumed
behavior honors required questions and completed effects; revoked sources remain
unavailable without leaking excerpts. Summary text cannot grant permissions.

---

### AIH-24 — Session interruption, resume and alternative comparison

**Plan ref:** §8.4, M3. **Depends on:** AIH-7, AIH-20, AIH-23. **Size:** L

Add typed inspect/interrupt/resume/fork/compare intents with durable event cursors,
concurrency versions and idempotency. Preserve parent checkpoint/source/decision
lineage for forks and compare component/evidence/validation differences.

**Acceptance:** two reconnecting clients and duplicate resume requests cannot
duplicate effects. Interrupt before/during/after a consequential call reconciles
uncertain outcomes before resume. Forks preserve attribution but reacquire scope,
budget and execution approval; candidate selection/revert never rolls back posted
ERP state. Expired/revoked dependencies are rechecked on resume.

---

### AIH-25 — Bounded specialist delegation

**Plan ref:** §8.5, M8. **Depends on:** AIH-19. **Size:** L

Extend admitted mode profiles with parent/child objectives, capability subsets,
evidence/output contracts, depth/concurrency caps, deadlines and reserved shares
of the parent budget. Propagate cancellation, record spend and retain provenance
when integrating checked child results; expose disagreements for resolution.

**Acceptance:** concurrent child calls cannot overspend parent reservations or
widen permissions. Cancellation prevents new descendant work and reconciles
in-flight outcomes. Child findings preserve sources; model review cannot approve
its own work as a human reviewer. Capability stays disabled until M8 passes.

---

### AIH-26 — Typed lifecycle extension admission

**Plan ref:** §8.6, M9. **Depends on:** AIH-19. **Size:** L

Implement only needed normalization/diagnostic/rendering/telemetry extension
points with pinned schemas/versions, ordering, permitted effects, time/size bounds,
retry/idempotency semantics and required/optional failure policy. Reauthorize and
revalidate transformed calls and preserve effective configuration in run history.

**Acceptance:** timeout, malformed output, duplicate delivery and revocation
fixtures produce deterministic recorded outcomes. Optional failures degrade
visibly; required checks fail closed. Trusted context and permissions cannot be
overridden. Extension execution stays disabled until M9 passes.

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
4. AIH-13 → AIH-14 (AIH-13 may start alongside AIH-1/2)
5. AIH-7 → AIH-8/9; AIH-15 after AIH-3/4/5/14
6. AIH-20 → AIH-23 → AIH-24; AIH-21 after AIH-15; AIH-22 after AIH-3/4/5
7. AIH-16 and AIH-20/24 → AIH-17 → AIH-18
8. AIH-19 on flagged pilot skills → AIH-6 wider migration
9. AIH-10 → AIH-11 → optional AIH-12
10. AIH-25 and AIH-26 as separately admitted later capabilities after AIH-19
