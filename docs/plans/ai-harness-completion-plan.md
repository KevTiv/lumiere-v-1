# AI Harness Completion Plan (Mistral/Gemini-first)

**Status:** Proposed; deferred from the first deployable core.

**Plan revised:** 2026-09-05 — evidence, intellectual provenance, knowledge and interactive execution gates.

**Execution tracking:** [AIH issues](./ai-harness-completion-issues.md).

**Sequencing authority:** [Core deployability](./core-vertical-deployability-pruning-plan.md#6-explicitly-deferred-from-deployability).

This revision defines planned requirements, not implementation completion. The
codebase baseline below is historical and must be rechecked before each issue
is implemented. Advanced agent/work-program work remains deferred from core
deployability; this revision does not change that priority.

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

Completion also requires reviewable answers and preservation of the human
intellectual sources behind generated work: books, papers, published company
practices, internal policies, and contributions made during discussion. The
shared source/claim/decision contract and release gates are owned by §7 and the
milestones below. Extend the existing artifact, authorization, and certification
foundations; do not create a second knowledge authorization system.

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
   limited, at a provider-specific cap, or an org's `AiAgent.allowed_models`
   excludes Mistral. Fallback must remain within org/run budgets; exhausted
   shared budgets deny all provider calls.
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
   - A response with no `tool_calls` is a candidate final answer: pass it through
     the §7 answer gate before presenting it as complete. If any tool requires
     `action_draft` (mutating), do not
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
4. Reuse `/api/ai/skills/run` for the loop. Preserve existing response fields
   while adding generated, typed claim/evidence/decision and validation refs for
   §7; a flat citation list is insufficient. Add a BFF route,
   `frontend/web/app/api/ai/runs/[runId]/steps/route.ts`, for the transcript
   poll/stream in (1), following the existing `requireAiRouteContext` +
   `validateCompanyScope` pattern.
5. Add a shared source/decision inspector for answer claims and artifact
   components: authorized versioned passages, original authors, discussion
   contributors, assumptions/adaptations, validation results and review history.
   Reauthorize every inspection/export and redact sensitive tool arguments and
   results in transcripts. Generate additional inspection/review contracts
   through the normal application API boundary, not model-controlled URLs.

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
5. Once §7 validation records exist, add claim coverage/support-check outcomes,
   attribution completeness, unresolved component links, stale-dependency reuse,
   review outcomes and verification cost. Distinguish verification methods;
   action approval and repeated usage alone do not measure answer correctness.

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

## 7. Evidence, intellectual provenance, and knowledge contract

### 7.1 Canonical records and ownership

Use versioned records with stable references, authorized reads, and append-only
revision/review history. The minimum relationship is:

```text
SourceVersion → SourcePassage → Claim/Concept → Decision → ArtifactComponent
                                     ↓
                            KnowledgeEntryVersion
```

| Record | Required semantics |
| --- | --- |
| Source / SourceVersion | Original author(s)/organization, title, publication date and edition/version when known, URI/DOI/file reference, retrieval time, immutable content hash/snapshot reference, source origin, owner, scope and retention policy. Record unknown attribution explicitly; never invent bibliographic fields. |
| SourcePassage | Exact passage or ERP record fields bound to a source version, with page/section/character/table coordinates or record revision/watermark. Distinguish original text from OCR/extraction and retain processor/correction references. |
| Contribution | Authenticated user/collaborator or agent execution that introduced the source/concept, session/turn/event reference, and inspection state: inspected, user-reported, or unverified recollection. Original authorship and discussion contribution are separate identities. |
| Claim / Concept | Statement, supporting/contradicting passage or calculation references, and kind: quotation, paraphrase, sourced fact, calculation, inference, or recommendation. Record assumptions and verification outcome separately from the statement. |
| Decision | Adopted concept, supporting claims/sources, applicability, alternatives considered, adaptations, bounded rationale, contributor and reviewer references. This is observable design justification, not hidden chain-of-thought. |
| ArtifactComponent | Versioned workflow step, formula, code symbol/range, or document section linked to its decisions and claims. Whole-artifact provenance remains the parent; stable component IDs plus content/version hashes prevent edits from silently moving a link. |
| KnowledgeEntryVersion | Reusable concept, interpretation or procedure with domain tags/links, owner, applicability, original evidence and decisions, review state, reviewers and source dependencies. An entry need not be executable or promoted to a skill. |

Resolve org/actor context on the server, validate company and parent references,
and use the existing authoritative reducer/API boundary for durable changes.
Generate shared contracts from canonical definitions; artifact bytes use the
authorized artifact/file store and semantic indexes remain disposable indexes
over references. These relationships do not require a graph database or a new
model provider. Source/document ingestion capabilities remain subject to their
separate admission milestones; fixtures do not establish production readiness.

### 7.2 Capture and context reconstruction

- Capture source contributions and explicit decisions during discussion, before
  generation; preserve accepted, corrected, and superseded revisions.
- Compile context from authorized source/claim/decision references and bounded
  excerpts. Summarization, continuation, model fallback, and recipe reuse must
  retain these references and distinguish facts from assumptions.
- Treat retrieved material as data, never as instructions or permission. Model
  recollection can propose a source for inspection but cannot establish a
  verified citation. A user-provided secondary quotation stays attributed to
  that contribution until the original passage is inspected.
- Bind generated components to decisions at save time. Edits/forks retain parent
  lineage, create new versions, and mark changed or unresolved component links
  for review. Do not claim historical links still support changed code.

### 7.3 Answer, save, and publication enforcement

Every material ERP factual claim or source-dependent design claim must have
supporting references or an explicit unresolved/qualified outcome. The harness
renders citation links from server-resolved IDs, never model-invented URLs.

Before final-answer release, validate reference existence, source-version and
passage matching, current access, applicability/effective dates, and deterministic
calculations. Check claim coverage and prose-to-evidence consistency; record
whether that check was deterministic, model-assisted, or human-reviewed. A
model-assisted semantic check is fallible and cannot confer domain approval.
Conflicts, missing evidence, or ambiguous interpretation trigger bounded further
retrieval, a qualified answer, abstention, or a named review requirement. Hitting
the retrieval/verification budget must not bypass the gate.

Progress events may stream immediately; candidate prose must not stream as a
validated final answer before the gate. Unverified drafts may be saved with their
failures and status visible, but cannot be published, promoted, or executed as
approved work. At publication, check component lineage, required domain review,
current dependencies and permissions, and the existing certification/action
approval gates. All migrated answer paths, including RAG, deterministic skills,
single-shot fallback, reports and action-draft explanations, use the same gate
or have an explicit tracked deferral without a completion claim.

Keep source origin, verification status, domain approval, and applicability as
separate fields. Successful execution, a faithful quote, repeated reuse, and a
high retrieval score do not establish that an accounting interpretation is
approved or correct. Preserve inherited trust labels through transformations;
never automatically label arbitrary derived evidence authoritative.

### 7.4 Knowledge lifecycle and source changes

Knowledge progresses through candidate → reviewed → approved, with explicit
superseded, disputed, withdrawn, and needs-review states. Record what each owner
reviewed: source fidelity, domain interpretation, or implementation behavior.
Usage/correction signals may nominate entries for review; frequency never grants
authority. Organize personal/team/organization knowledge by domain and connect
related concepts across domains only within current authorization.

Derived entries, summaries, snippets, exports, and cached answers must not widen
access to their sources. A broader sanitized publication requires explicit review
and its own authorized version. Reauthorize on retrieval, inspection, reuse and
execution; do not rely on permission at the original run.

Maintain reverse dependencies from sources to claims, decisions, entries and
artifacts. Corrections, supersession, retraction, permission revocation or deletion
invalidate affected caches and mark dependent work for review. Deny new reuse or
execution when a required dependency is invalid; discretionary inspiration may
instead require acknowledged review under explicit policy. Preserve historical
versions subject to access/retention rules. Retain source snapshots only where
permitted; a hash alone cannot reconstruct a passage. If content must be deleted
or cannot be retained, show an unavailable-source tombstone and the reviewability
limitation rather than substituting today's document or claiming full replay.

### 7.5 Harness setup and operational admission

Configure per-skill/task evidence requirements, applicability rules, allowed
source capabilities, verification/retrieval budgets, reviewer roles, retention,
and failure behavior as versioned server-owned policy. Bind each run to the
effective policy, model/configuration, supplied evidence versions, tool events,
validation outcomes, decisions, and final artifact/answer version. Evidence
requirements remain identical across Mistral/Gemini/Kong/Ollama adapters; provider
fallback cannot bypass exhausted organization/run budgets or verification.

Certification must cover fabricated IDs/pages/authors, valid citations that do
not support the claim, conflicting/expired policies, arithmetic errors, model
recollection, injected source instructions, context compaction, edited/forked
components, and source revocation/deletion with derived-cache leakage checks.
Measure material-claim coverage and support correctness separately, attribution
completeness, unresolved component links, stale-dependency reuse, review outcomes,
and verification cost. Passing cases must exercise persisted records and normal
authorized API/UI reads; string-matching unit tests alone do not close a gate.

## 8. Interactive execution and recovery

These requirements adapt OpenCode interaction patterns to Lumiere's authorized
ERP capabilities. They extend existing execution, context and provenance records;
they do not require embedding OpenCode or adopting its authorization defaults.
AIH-20–24 strengthen base harness admission. AIH-25/26 are later, separately
admitted specialist/extension capabilities and do not block the single-agent base.

### 8.1 Durable questions and user steering

Persist a typed QuestionRequest with run/step/decision refs, prompt/options,
required-versus-optional status, authorized respondent, version, and
pending/answered/cancelled/superseded state. Store the answer and its authenticated
contributor as a decision input; answering a question does not approve a mutation.
Required answers suspend dependent work in `waiting-input`; independent authorized
steps may continue. Optional questions may use an explicitly recorded default
under task policy. Elapsed time never answers a required question.

Handle replies idempotently and reject stale versions. Reconnect/resume recovers
pending and answered requests without re-asking resolved questions. Steering that
changes scope, assumptions or requirements versions the objective/decision and
invalidates affected candidates, checks and approvals before further work. Keep
unaffected completed steps; do not restart the task or re-execute business effects.

### 8.2 Diagnostic repair and progress detection

After each candidate workflow/code/formula revision, invoke admitted deterministic
validators before publication: generated input/output contracts, field/scope
references, allowed operations, and available domain invariants. Return bounded
diagnostics with validator/version, candidate hash, component/field, stable code,
severity and actionable explanation. Repair only the affected candidate, create
a new version, and revalidate within repair/cost limits. A validator pass is not
domain approval; missing validators mean unsupported capability or required review.

Track normalized tool/input, result/evidence changes, candidate versions and
diagnostic fingerprints. Repeated calls without new evidence, unchanged failures,
or repeated denied actions trigger a recorded non-progress outcome: bounded
replan, clarification or stop. A changed prompt/model alone is not progress.
Explicit polling has its own attempt/time/backoff policy; transient retries and
repair attempts consume the same task budget. Reauthorize every revised call.

### 8.3 Checked compaction

Before compaction, persist a continuation manifest: objective/version, constraints,
accepted decisions/source refs, pending questions/approvals, completed effect refs,
candidate versions, progress/repair state and remaining budget. Compare required
IDs/versions and state against the compiled continuation before resuming. Reload
missing authorized records or stop with an explicit context-recovery error.

Durable records, not model-written summaries, own budgets, permissions and effect
state. Revalidate access and source freshness on reload; retain explicit denied or
unavailable states without injecting restricted excerpts. A reference-presence
check alone is insufficient: certification also checks that resumed behavior
honors the preserved constraints and unanswered questions.

### 8.4 Session controls and alternatives

Expose typed server-owned inspect, interrupt, resume and compare/fork intents
through the existing API/event boundary. Multiple clients observe the same run;
reconnect uses durable event cursors and does not resend a consequential step.
Version/idempotency checks resolve concurrent steering and resume requests.

Interruption stops scheduling new calls and cancels in-flight work where supported.
If a consequential call may have completed, reconcile its recorded operation and
idempotency outcome before resume; show pending reconciliation rather than claiming
rollback. Restore checkpoints under fresh authorization and remaining budgets.

A fork creates a new task/correlation root linked to the exact parent checkpoint,
source/decision versions and candidate artifacts. Compare sources, assumptions,
adaptations, component diffs and validation results. Do not inherit execution
approvals or replay completed business effects. Conversation/artifact revert is
not reversal of posted ERP state. Choosing a candidate still requires current
publication/action gates. Forks require admitted budgets and cannot reset org caps.

### 8.5 Modes and bounded specialists

Define Investigate, Design, Draft and Review as versioned capability profiles with
explicit transitions. They restrict behavior within existing server authorization;
mode names and prompts never grant authority. Base mode transitions and their
negative fixtures belong to M6; delegated specialists remain behind M8.

Each delegated task has a parent, bounded objective, allowed source/evidence refs,
output schema, capability subset, deadline and reserved share of the parent budget.
Enforce depth/concurrency limits, cancellation propagation, and accounting that
prevents parent/children from spending the same reservation. Child findings retain
source/contributor lineage and pass the same answer gate before integration.
Specialist disagreement remains visible for resolution; model review cannot act
as the named human/domain approver or satisfy separation-of-duties requirements.

### 8.6 Typed lifecycle extensions

Add versioned extension points only for identified needs: source normalization,
diagnostics, bounded rendering and telemetry. Each declares schemas, execution
order, permitted data/effects, time/size budget, retry/idempotency policy and
required-versus-optional failure behavior. Pin extension versions in run metadata
and record failures; optional telemetry/rendering failure may degrade explicitly,
while a required validation failure blocks publication or execution.

Extensions run behind the same capability and privacy boundary. Any transformed
tool arguments/results are revalidated and reauthorized as appropriate; no hook
may rewrite trusted actor context, skip evidence gates, grant permissions, or
introduce unreviewed network/DB access. Admit extensions through M9 before use;
do not create an arbitrary plugin runtime as a prerequisite for the base loop.

### 8.7 Inspiration and adaptation record

Sources: OpenCode project documentation inspected 2026-09-05. These references
establish the interaction patterns; the ERP records, permissions and gates above
are Lumiere design decisions. Recheck upstream interfaces before implementation;
the experimental compaction hook is inspiration, not a runtime dependency.

| Source | Observed pattern | Lumiere adaptation |
| --- | --- | --- |
| [Question tool](https://opencode.ai/docs/tools/#question) | Structured questions during execution | Versioned decision inputs, required-answer suspension and restart-safe replies |
| [LSP diagnostics](https://opencode.ai/docs/lsp/) | Diagnostics fed back into the agent; ordinary validation commands are also an option | Generated-contract/domain diagnostics and bounded candidate repair |
| [Permissions](https://opencode.ai/docs/permissions/) | Repeated identical tool-call detection | Evidence/diagnostic-aware non-progress handling with explicit polling rules |
| [Compaction configuration](https://opencode.ai/docs/config/#compaction) and [plugins](https://opencode.ai/docs/plugins/) | Context compaction and an experimental customization hook | Checked continuation manifest backed by authoritative records |
| [Session APIs](https://opencode.ai/docs/server/#sessions) | Fork, abort, diff and session operations | Authorized interrupt/resume/compare with effect reconciliation and no business rollback |
| [Agents](https://opencode.ai/docs/agents/) | Primary agents and specialists with distinct tool access | Restricted modes and delegated tasks with shared budget accounting |
| [Plugin events](https://opencode.ai/docs/plugins/) | Lifecycle/tool hooks | Typed, versioned extensions with explicit failure and authorization boundaries |

## Suggested Implementation Order

1. Extend `LlmRequest`/`LlmResponse` and `complete_mistral`/`complete_gemini`
   with tool-calling support (§3.1). No behavior change for existing
   callers that don't pass `tools`.
2. Define §7 contracts and source/contribution persistence (AIH-13) alongside
   provider work. Build `agent_loop.rs` behind a feature flag / new skill category, tested
   against 1–2 low-risk green skills first (reuse existing fixtures from
   `harness::certification`).
3. Add discussion/decision/component capture (AIH-14), the answer gate (AIH-15),
   and transcript/source inspection (AIH-7/16). Add durable questions (AIH-20),
   diagnostic repair (AIH-21), progress detection (AIH-22), checked compaction
   (AIH-23) and session controls (AIH-24) before base harness admission.
4. Add knowledge review and source-change handling (AIH-17/18), then prove the
   end-to-end setup gates (AIH-19). Migrate remaining non-fenced skills from
   `run_skill_unlocked` to `agent_loop.rs` (§3.3), skill by skill, using existing
   certification plus evidence gates. Stage capabilities by their milestone;
   recipe/knowledge publication waits for M4/M5.
5. Build usage insights (§5) once there's real run/step volume to aggregate.
6. Admit bounded specialists (AIH-25/M8) and typed extensions (AIH-26/M9)
   separately after the base gates pass; neither is required for single-agent use.

## Milestones and Acceptance Criteria

All milestones below are **planned / not verified by this revision**. A gate
closes only with a recorded implementation revision, test/run evidence, and
reviewer. A tracked deferral narrows the admitted capability; it is not a pass.
M0–M7 define the base harness. M8/M9 are later capability-specific milestones;
they may stay disabled without blocking base admission. Milestone numbers are
stable labels, not a requirement to implement independent work serially.

| Milestone | Issues / prerequisite | Exit gate |
| --- | --- | --- |
| M0 — Governed loop and progress | AIH-1–5/22 | A green skill completes 2+ tool calls under per-call authorization and budgets; denied/malformed calls are recorded; mutations remain drafts. Adapter fixtures prove permitted fallback, while exhausted shared budgets deny it. Repeated no-progress calls/errors produce bounded replan/question/stop without confusing admitted polling with failure. Candidate final output requires M2. |
| M1 — Source, decision and continuation foundation | AIH-13/14/23 | Persist book/paper, company-publication and ERP/policy fixtures with distinct author/contributor identities and versioned passages. Recover source → concept → decision → component after edit/fork. Compaction must preserve required refs, constraints, pending questions and effect/budget state; dropped/changed state is rebuilt or blocks continuation. No production ingestion claim from fixtures. |
| M2 — Evidence-gated answers and repair | AIH-15/21; M0/M1 | All §7.3 checks precede final presentation. Fabricated citations, unsupported prose, conflicting applicability and unavailable evidence produce the specified qualified/blocked/review outcome. An invalid workflow yields component diagnostics and a versioned bounded repair; unresolved errors cannot escape through streaming/publication, and a validator pass never grants domain approval. |
| M3 — Review, questions and session controls | AIH-7–9/16/20/24; M1/M2 | Reviewers inspect exact sources/authors/contributors, adaptations and history with no denied excerpt leakage. Required questions pause dependent work, survive restart and accept one current reply. Interrupt/reconnect/resume reconciles in-flight effects without duplicates; a fork compares source/decision/component alternatives without inherited execution approval or ERP rollback. |
| M4 — Reviewed knowledge reuse | AIH-17; M1–M3 | Approve a non-executable concept and a procedure with named domain review; retrieve them for a fresh task with source lineage and current authorization. Repeated AI answers or passing execution fixtures alone cannot approve knowledge. |
| M5 — Change and revocation safety | AIH-18; M4 | Supersede/retract a source and revoke access in persisted fixtures. Reverse dependencies flag affected work, caches cease serving it, required invalid dependencies block new reuse/execution, and historical inspection respects retention/tombstones. |
| M6 — Harness admission and migration | AIH-19/6; M0–M5 | Run all three scenarios below through authorized APIs/UI and publish the per-capability gate matrix. Mode changes cannot grant access or bypass action/evidence gates. Every migrated answer path enforces the same requirements; legacy paths are migrated or explicitly deferred. No new skill enters the legacy sequence. |
| M7 — Usage and evidence quality | AIH-10/11; admitted run data | Admin sees adoption/spend, claim support, attribution and review metrics plus question wait/re-ask, repair success/cost, non-progress stops, context recovery and reconciled cancellation outcomes. Aggregates match seeded records and respect scope. AIH-12 remains optional. |
| M8 — Bounded specialists | AIH-25; base M6 admission | Persist parent/child task lineage and validate child output/evidence. Overlapping child calls cannot overspend shared reservations, widen access, exceed depth/concurrency caps or continue past propagated cancellation. Conflicting findings stay visible; a model reviewer cannot satisfy human/domain approval. |
| M9 — Typed lifecycle extensions | AIH-26; base M6 admission | Pin schemas/versions/order and exercise timeout, malformed output, duplicate delivery and revoked-extension fixtures. Optional failures degrade visibly; required validator failure blocks. Rewritten arguments are revalidated/reauthorized, and no hook can change trusted context or bypass gates. |

Required end-to-end scenarios for M6:

1. **ERP/policy answer:** approved policy and current authorized ERP facts yield
   cited claims plus a reproducible calculation. A conflicting effective date,
   denied record and unsupported conclusion each exercise the defined failure
   behavior; no factual or domain approval is inferred merely from execution.
2. **Intellectual source to workflow:** discussion introduces an identified book
   or paper and a company's published process. Generate a workflow/script whose
   reviewer can distinguish published observation, our interpretation and our
   adaptation; inspect exact passages and authors; resume after compaction;
   revise/fork a component; and revalidate after source correction. Unverified
   recollections remain visibly unverified throughout.
3. **Interactive recovery:** pause for a required choice, finish an independent
   read, restart/reconnect and apply the answer once. Reject a stale reply after
   steering changes the decision. Repair a deliberately invalid workflow, trigger
   a repeated-error stop, and detect missing state in a compaction result. Interrupt
   at an uncertain action boundary, reconcile the outcome, then resume without a
   duplicate effect. Compare forked alternatives with their source/decision diffs
   and prove that mode changes and candidate selection do not grant authorization.

## Security and Privacy Considerations

Everything in `ai-enterprise-harness-plan.md` §7 applies unchanged: no layer
trusts a browser/model-supplied company ID, tool, or role; secrets stay
server-side; policy defaults deny. The loop adds one new surface — a
model-chosen sequence of tool calls instead of a fixed one — so the policy
engine must evaluate every planned call, not just the skill's entry point,
and mutating tools must always route through `AiActionDraft` rather than
executing directly, regardless of what the model requests.
