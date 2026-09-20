# AI Harness Completion — Tracked Issues

Derived from
[`ai-harness-completion-plan.md`](./ai-harness-completion-plan.md). Each
issue is independently mergeable behind compatible, generated contract changes;
sequence follows the plan's "Suggested Implementation Order." Estimates are
rough sizing (S/M/L), not commitments.

**Plan revision:** 2026-09-12. AIH-13–19 add evidence and intellectual
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
- The message contract gains provider-neutral assistant-tool-call and
  tool-result variants so AIH-3 can round-trip a multi-step transcript without
  flattening structured calls into prose.
- `complete_mistral`: add `tools`/`tool_choice` to the existing
  OpenAI-compatible payload (`openai_payload`); parse
  `choices[0].message.tool_calls`.
- `complete_gemini`: map `ToolSpec` → `functionDeclarations`; parse
  `candidates[0].content.parts[].functionCall`.
- `complete_via_kong`: pass `tools` through unchanged; if the response has
  no `tool_calls`, treat as a plain completion (no hard fail).

**Acceptance:** existing callers that don't set `tools` see no behavior
change; fixture Mistral/Gemini tool-call responses correctly populate
`LlmResponse.tool_calls`; a scripted/injected completion seam can be used by
AIH-3 without live HTTP.

---

### AIH-2 — Connect tools to generated capability-schema metadata

**Plan ref:** §3.1 and `agent-harness-capability-ir-foundation.md`.
**Depends on:** AIH-1 and the generated capability-registry foundation. **Size:** M

Generate ERP operation schemas, stable capability keys, risk, confirmation and
result-policy metadata from application-contract IR. Runtime-native tools use
reviewed, versioned descriptors in the same registry. `AgentTool`
implementations reference those descriptors; they do not define a second
hand-written schema for canonical ERP operations. Add a
`ToolRegistry::specs_for(allowed_actions)` adapter that filters by both the
skill allowlist and `required_action`, while invocation remains reauthorized.

**Acceptance:** generated ERP schema output and registered runtime-native schema
output are valid JSON Schema and round-trip through AIH-1's `ToolSpec`; drift
checks fail if an ERP descriptor diverges from application-contract IR.

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

**Status — partial; not complete.** Implemented in `spacetimedb/src/ai/`
(`evidence_source.rs`, `evidence_common.rs`):

- Private tables `ai_evidence_source` (original author/organization, scope,
  retention), `ai_evidence_source_version` (edition, dates, URI, content hash,
  snapshot state, origin, verification, status) and `ai_evidence_contribution`
  (authenticated contributor, session/turn, inspection state). Original
  authorship and discussion contribution are separate records. `ai_evidence_passage`
  gained `source_version_id`, `coordinates`, `text_origin`, `processor_ref`
  and `text_state`.
- Origin, verification, and applicability are separate fields. A model
  recollection is stored `unverified_recollection` with no hash/snapshot, can
  have no passages, and is promoted only by `inspect_ai_evidence_source_version`
  with an inspected hash. A contribution cannot claim a stronger inspection
  state than its version. Unknown attribution is stated (`unknown`, no authors)
  and empty coordinates mean an unknown location.
- Cross-scope references deny (`company` vs `organization` scope; nothing
  crosses an organization).
- Source/version and contribution retries are fail-closed and idempotent:
  identical source-version and inspection replays no-op, divergent replays
  reject, and a contribution `event_ref` cannot be reused with different
  details. Passage coordinates and source tags reject malformed, padded, or
  duplicate values.
- User-authored contributions have a narrow session route at
  `/api/ai/evidence/contributions`. The API server derives the organization and
  actor from the authenticated session, resolves the only allowed company from
  membership, keeps the reducer denied to generic dispatch, and the reducer
  requires an owned chat session in the same organization/company.
- The baseline nine persisted-fixture scenarios
  (`run_ai_evidence_provenance_tests`, `tests/ai/evidence_provenance_test.rs`)
  were executed against a local SpacetimeDB 2.8.2 module. The extended replay,
  session-ownership, and sibling-company fixtures compile and have focused unit
  coverage, but have not yet been rerun against a live module.

Current wiring and remaining work:

- Company-scoped DMS documents now populate the governed evidence tables from
  their index content during initial creation and explicit reindexing. The
  document id is the stable source key; the current `DocumentVersion`, stored
  object checksum and URL bind the source version; UTF-8-safe byte-bounded
  passages carry deterministic keys and character coordinates. A later DMS
  version retires its predecessor through the source-change/dependency path,
  and identical retries preserve the original supersession link.
- DMS index content is caller supplied today, so these versions are explicitly
  `origin=user_provided` and `verification=user_reported`, never `inspected`.
  The path does not yet fetch and parse the server-owned blob, run external
  PDF/OCR extraction, ingest books/network sources, or react to document
  deletion/access revocation. A live blob-to-passage proof is still required;
  the focused splitter tests and compile check do not establish production
  ingestion readiness.
- The tables are private and read only by the gateway as a trusted principal;
  there are no generic client-facing authorized-read contracts. The contribution
  reducer remains `denied` to generic dispatch and is reachable only through
  its fixed, membership-authorized API-server route. Evidence inspection is
  exposed only through AIH-16's session-owned BFF, which binds the acting user,
  organization and membership company to an exact current reviewer grant; no
  generic browser read contract was added.
- Chat and generation do not call the new user-contribution endpoint, so the
  route is not yet part of a production discussion flow. `turn_ref` remains a
  bounded correlation string rather than validated message lineage.
- Contribution replay currently scans the organization index; a narrower
  idempotency index is deferred because it would change the generated schema.
- Generated contracts are regenerated and the C0/C1/C2, operation-history,
  release-manifest and contract-IR gates pass (see AIH-18's verification
  note). This also surfaced and fixed stale hard-coded table counts and an
  invalid `ai_evidence_passage` storage class from the AIH-15 work.
- A source's attribution cannot be corrected in place; a differing replay is
  rejected and a correction needs a new source record.

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

**Status — partial; not complete.** Implemented in
`spacetimedb/src/ai/evidence_lineage.rs`: `ai_evidence_claim`,
`ai_evidence_decision` (alternatives, adaptations, assumptions, bounded
rationale, reviewer) and `ai_artifact_component` (versioned, parent lineage,
`link_state` linked/changed/unresolved). Revisions supersede rather than edit.
`human_reviewed` can only be recorded by `review_ai_evidence_claim`. A component
binds only to *accepted decisions*; claims alone (a bibliography) are rejected.
Edit and fork create new versions marked `changed`; `unresolved` is never
laundered by a later edit; only `review_ai_artifact_component_links` restores
`linked`. Source → concept → decision → component reconstructs from persisted
rows after edit and fork (fixture `lineage_reconstructs_after_edit_and_fork`).

Still open:

- Wired: the governed-run answer gate now persists each material claim and
  stated calculation (`ai-gateway/src/orchestrator/evidence_recorder.rs`) as
  `ai_evidence_claim` rows introduced by one agent `ai_evidence_contribution`
  per run, idempotently on retry. Only *current* passages are recorded as
  support; a model verdict is `model_assisted` and never `human_reviewed`; a
  claim with no current support is an unsupported inference. If recording
  fails, a releasable answer is lowered to `RequiresReview`. The ids are on
  the run response as `evidenceClaimIds`. Verified by unit tests and an
  `#[ignore]`d live test against a real module.
- The reviewer screen now captures a user-owned discussion contribution and
  proposed decision together through a fixed BFF route. The contribution event
  is idempotent and one contribution can record only one matching decision;
  actor/organization/reducer fields never come from the browser. A second fixed
  route records claim or decision verdicts with reducer-level permissions and
  refreshes the inspection result.
- Presentation draft saves can carry accepted decision IDs and optional claim
  IDs in the canonical definition. The denied save reducer derives the
  immutable artifact reference and content SHA-256 from the inserted revision,
  rechecks company access and bindability, and writes the component in the same
  transaction. A failed binding therefore rolls back the draft save.
- Still open: automatic capture from each chat turn (the reviewer form uses the
  owned chat session but no verified message ID), compaction/resume carrying
  references, non-presentation artifact generation, and publishing/pinning the
  changed presentation wire contract. The resume/edit/fork proof remains at
  table level only.
- **Workflow steps are bound automatically (2026-09-20, human-review reuse
  slice).** A draft marked harness-generated by `begin_ai_workflow_generation`
  (run resolved from the run table, never from a browser or model) cannot
  publish until every material step (Decision, HumanTask, Action, Timer,
  Subflow) has current provenance staged by `stage_ai_workflow_node_provenance`:
  typed rows carrying the run, tenant, draft revision, decision and claim ids and
  a server-computed canonical node-content hash (no decision or claim id lives
  in workflow `metadata`). Publication rechecks accepted decisions, current
  human-reviewed claims, dependencies, tenant scope and hashes in a first phase
  that writes nothing, then binds each step through the shared
  `bind_ai_artifact_component_inner` as `workflow-version:<id>` /
  `node:<key>` (`workflow_step`). Clone forks each parent component so ancestry
  and link state carry forward; changed content or links read `changed`; a
  reviewer's confirmation (`review_ai_artifact_component_links`) must name the
  exact content hash, which must still be the node's current hash. A source
  correction or revocation flags the component and blocks both publication and
  workflow instance start. Human-authored workflows are untouched. Executed in
  a live SpacetimeDB module: `run_workflow_provenance_tests` (5 scenarios).
  Still open: no gateway workflow generator exists yet, so `begin`/`stage` have no
  production caller; every material step of a generated draft needs provenance
  (there is no per-step "human-authored" carve-out).

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

**Status — partial; not complete.** Implemented on the governed-program path
(`ai-gateway/src/orchestrator/answer_gate.rs`, wired in `run.rs`):

- Server-side passage catalog (`ai_evidence_passage`, private, versioned,
  immutable text, forward-only status) with passage/source-version matching,
  content-hash integrity, withdrawn/superseded/not-yet-effective handling,
  conflicting effective versions, and applicability against a skill's
  `requiredApplicability` config.
- Arithmetic recomputation of stated calculations; material-figure grounding
  against capability-output data, cited passages and stated calculations.
- Claim coverage: unsupported claims qualify the answer; supported claims are
  checked by the review-role provider (`VerificationMethod::ModelAssisted`,
  recorded in the verification reason). A model verdict can only lower an
  outcome; checker failure or an exhausted claim budget forces review.
- New `Qualified` outcome: limitations are appended to the released answer
  (`qualified_content`) so a caveat cannot be dropped after the gate.
- `EvidenceBackedVerificationService` replaces the shape-only placeholder for
  capability outputs (degraded retrieval, row-count consistency, citation
  provenance).

Still open, so AIH-15 must not be marked complete:

- **RAG and direct-loop answers now require structured claim provenance.**
  `/v1/rag`, its SSE stream and the direct-execution loop require exhaustive,
  ordered claims with server-known support references and calculations before
  `orchestrator/text_answer_gate.rs` can release an answer. Malformed JSON,
  incomplete claim coverage, unknown support ids and model-supplied passage
  citations without a server-side passage catalog fail closed. JSON and SSE
  expose the same `verification` and `provenance` metadata; ranked-source
  identities use stable `memory:<content_type>:<content_id>` references without
  trusting display snippets. Plain prose is withheld rather than treating
  evidence co-occurrence as claim support. Direct-loop tool references remain
  transient: until they have a durable passage binding the answer is withheld,
  `persisted` remains false and no misleading evidence-claim ids are emitted.
  Runtime RAG still initializes ranked memory as empty because authorized
  passage text is not yet resolved from the reference-only vector hits, so the
  memory-provenance path is focused-test proof rather than a live
  passage-backed RAG proof. The loop's run state also remains parked at
  `agent_settled`; this slice does not complete the run.
- **`/v1/rag` is passage-backed and actor-scoped (code and focused tests).**
  Persisted evidence passages reach a RAG prompt only after the acting user's
  exact `ai.evidence.retrieve` role grant is established (default-deny, nothing
  seeded; distinct from `ai.knowledge.retrieve` and `ai.evidence.inspect`).
  `require_scoped_capability_grant` returns typed `CapabilityGrantBounds`; the
  grant's `max_rows` and cumulative `max_bytes` are intersected with the global
  RAG ceilings and applied in rank order, so an oversized passage is never
  loaded. The answer gate binds a claim's `{"kind":"passage","id":"<id>"}` to
  the complete server-side citation from that authorized catalog (a
  model-supplied version, key, text, hash or `passageSupport` blocks), and every
  passage-backed claim needs a review-role semantic verdict — no checker, or a
  failing one, requires review. Withheld reasons no longer echo the candidate's
  claim text, a reviewer rationale or a provider error. Immediately before
  release (and again after provenance is written) the grant is re-fetched and
  every passage re-read; a revoked or narrowed grant, or a source that was
  revoked, deleted, superseded or replaced, withholds the answer and its passage
  sources. A released passage-backed answer persists its contribution and claims
  through `StdbEvidenceRecorder` under its run and returns `claimIds`; a
  persistence failure withholds it, and the durable run completes only after
  admission and persistence succeed (otherwise it is `failed`). Live-snapshot
  answers still stand alone and never depend on evidence access. Document
  passages carry no effective dates, so their answers release as `qualified`.
  The live browser → gateway → Qdrant → answer-gate proof
  (`ai-rag-evidence-access.spec.ts`) needs a real LLM and embedder and must be
  run against a stack that has them.
- **Publication adapters now use the full answer admission boundary.** Reports,
  action explanations, saved artifacts and classic-run summaries construct
  explicit material claims and pass them through
  `EvidenceGatedAnswerAdmission`. Server-known run evidence is checked against
  the exact evidence set; passage support still requires catalog resolution and
  semantic review. A released publication must persist its contribution and
  claim ids; missing private-reader access, failed persistence or an empty claim
  write withholds and redacts the candidate. Deterministic ERP report rendering
  is not an AI answer path and remains unchanged.
- DMS document index content now populates `ai_evidence_passage`, but only as
  `user_reported`; server-owned blob parsing/OCR and a live end-to-end
  blob-to-passage-to-answer proof remain open.
- **Exact human-reviewed claim reuse (2026-09-20).** `reviewed_claims.rs` adds a
  server-side `ReviewedClaimResolver`; the model cannot nominate a claim id. A
  review is reused only for the same organization/company, whitespace-normalized
  statement, exact current supporting passage ids, and assumption identity
  (the answer's required applicability plus a hash of each stated calculation
  its figures rest on, both now recorded on new claims), a current
  `human_reviewed` claim with persisted reviewer and time, and a chain the shared
  inspector finds clear of blocking findings. It replaces only the semantic
  check: the deterministic checks still run, a qualified review is never
  admitted in full, an unsupported one blocks (a model does not overrule it),
  and `VerificationMethod::HumanReviewed` is recorded only on a match. The
  recorder references the reviewed claim by id and can never write
  `human_reviewed`. Wired into governed runs and `/v1/rag`. Focused unit tests
  and an `#[ignore]`d live test against real rows; the browser proof of a fresh
  run reusing a review needs a chat LLM (`ai-human-review-provenance.spec.ts`,
  second test) and was not run here.
- Catalog reads are scoped to organization/company, not the acting user's
  grants ("current access" is not per-actor yet).
- No bounded further-retrieval loop on conflict/missing evidence; the gate
  qualifies, reviews or blocks but does not re-retrieve.
- Generated contract artifacts were regenerated with the AIH-13/14/17/18
  work and the storage-policy check now passes against a fresh schema
  snapshot (492/492 tables).
- New: the gate's per-claim assessments are persisted (AIH-14 above), so
  `HumanReviewed` can now exist on a claim, though the gate does not read it.

---

### AIH-16 — Source and decision inspector

**Plan ref:** §4.5, M3. **Depends on:** AIH-7, AIH-14, AIH-15. **Size:** M

Provide a shared claim/component inspector with exact source passage/version,
author, introducing contributor/turn, interpretation/adaptation, validation
outcome and revision/review history. Reuse generated authorized read contracts.

**Acceptance:** a reviewer navigates from answer and workflow step to the exact
foundation through UI/API reads. Denied sources reveal no excerpt through the
inspector, transcript, exports or caches; unavailable originals are explicit.

**Status — partial; minimal reviewer UI and session-owned inspection BFF.**
`ai-gateway/src/orchestrator/evidence_inspector.rs` assembles the chain for a
component, decision, claim or knowledge version (exact passage/version,
original author, introducing contribution, adaptations, validation
method/outcome, dependency state) and lists blocking and review findings. The
AI Harness now has a reviewer-only decision/claim lookup screen. Its Next route
proxies only to `POST /v1/ai/evidence/inspect` on the API server; browser input
is limited to company intent plus target kind/id. The API server derives the
organization, actor identity and token from the session, validates company
membership, requires an active exact `ai.evidence.inspect` role grant, and
forwards a bounded request to the internal gateway. The gateway revalidates a
grant envelope bound to that actor, organization and company before loading the
target. Responses are `no-store`, upstream errors are opaque, and unknown
authority fields are rejected. An out-of-scope source is reduced to an id (no
excerpt, title, author, hash or coordinates), restricted/tombstoned passages
return no excerpt, and the UI defensively suppresses unavailable passage
content and source metadata. Unit tests cover spoofed authority, expired/inactive
roles, mismatched actor scope, bounded excerpts and unavailable-content
redaction.

Still open:

- Answer → foundation now works for governed-run answers: the run response
  carries `evidenceClaimIds`, and each inspects down to passage, source and
  author. The UI does not navigate from an answer or run to those claims, and a
  *workflow step* has no path yet (no component is bound at save time).
- A workflow step now has a path: `workflow_step` (version + node key)
  resolves the step's current component and reconstructs decision, claim,
  passage and source through its revisions, with the claim's persisted reviewer.
  A bounded, company-scoped review queue (`POST /v1/evidence/review-queue`, same
  exact `ai.evidence.inspect` grant) lists pending and flagged claims and
  decisions, source and passage availability, automated result, creator and
  proposer (so separation of duties is visible), affected workflow steps and
  steps whose links need confirming; the reviewer screen can inspect and review
  from it. The browser supplies only company intent, target, verdict, note and,
  for a component confirmation, the exact content hash it saw.
- The UI still omits export and cache integration.
- Transcript and export paths are not covered, derived caches are not
  invalidated, and no live authenticated browser → API server → gateway →
  SpacetimeDB E2E was run. No default `ai.evidence.inspect` grant is seeded, so
  deployments deny inspection until an authorized role grant is configured.

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

**Status — partial; not complete.** Implemented in
`spacetimedb/src/ai/knowledge_entry.rs`: entries (concept/interpretation/
procedure, domain tags, owner, share scope), versions, and an append-only
`ai_knowledge_review` log. Approval needs every required review kind
(source fidelity + domain interpretation; plus implementation for a procedure)
accepted in the *current review epoch*. No reducer approves from a usage
signal or test result: nomination can only send an entry back toward review,
and a change to anything a version depends on voids earlier reviews. A
version can only reference evidence in its own scope. Retrieval
(`retrieve_reusable_knowledge`) serves only `approved` versions and re-decides
from current scope and dependency state. Fixtures approve one concept and one
procedure and retrieve both with lineage.

Implemented scope and reviewer protections:

- `personal` reuse requires the trusted actor identity to match the owner and
  rechecks active organization/company membership. `team` uses the closed
  `department:<id>` vocabulary backed by the actor's current
  `user_organization.department_id`; membership is rechecked on every retrieval
  and knowledge-version inspection. The gateway derives actor scope from the
  trusted BFF envelope, rejects body-supplied authority/team fields, and
  requires the dedicated `ai.knowledge.retrieve` capability.
- An entry owner or version proposer cannot review that version. Team reviewers
  must also be current members of the same team. Retrieval revalidates complete
  independent current-epoch reviews, so historical approved rows fail closed
  rather than inheriting weaker legacy approval.

Still open:

- Wired for governed-run skills: `config_json.knowledgeEntryKeys` names the
  entries a run compiles into its context
  (`ai-gateway/src/orchestrator/knowledge_context.rs`). Each is re-retrieved at
  run time, so an entry that is no longer approved, in scope, or valid is left
  out and reported rather than served stale; served versions become run
  evidence (`knowledge_version:<id>`); caller-supplied `referenceKnowledge*`
  inputs are discarded. The direct-execution loop and `/v1/rag` do not compile
  knowledge. AIH-20/24 dependencies were not implemented.
- No live API-server -> gateway -> SpacetimeDB scope/revocation E2E has run;
  role grants for `ai.knowledge.retrieve` still need provisioning. Governed-run
  identity still originates from the existing `triggered_by_hex` boundary,
  although membership is rechecked live. Generated contract/schema artifacts
  were not regenerated for this slice.
- Knowledge-to-skill promotion now persists an exact reviewed lineage snapshot,
  requires an independent promotion reviewer, creates only an unreleased skill
  version, and relies on the existing independent certification/release gate.
  Invalidating the knowledge invalidates certification, deactivates an active
  release and blocks new runtime snapshots. Live source-change cascade E2E and
  regenerated reducer descriptors/contracts remain open.

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

**Status — partial; not complete.** Implemented in
`spacetimedb/src/ai/evidence_dependency.rs`: every reference the record
modules make is also an `ai_evidence_dependency` edge. `record_ai_evidence_source_change`
(corrected / superseded / retracted / access_revoked / deleted) moves source
status forward only, withdraws or restricts/tombstones passages, and walks
forward from the affected passages, escalating edges under a versioned policy
(`EVIDENCE_POLICY_VERSION` = 1: a correction or supersession flags dependents
`needs_review`; retraction, revocation and deletion make *required* edges
`invalid`; discretionary edges never exceed `needs_review`; severity never
improves) and flagging claims, decisions, components and knowledge versions.
New claims, decisions, entries and approvals on invalid or flagged
dependencies are denied; a discretionary edge needs an acknowledged review; an
invalid edge can never be reaffirmed. Deletion tombstones text but keeps the
hash and reports `hash_only`, never full replay; revocation keeps content as
`restricted`. `ai_evidence_source_change.id` is the cache-invalidation
watermark. Persisted fixtures cover retraction, correction with honest
re-review, revocation, deletion and discretionary acknowledgement.

Still open:

- No derived cache actually consults the watermark: the Qdrant/semantic index
  and any cached answers are not invalidated by a source change yet.
- Blocking *execution* is enforced only where these reducers are the path
  (approval, binding, link confirmation); the gateway inspector reports the
  decision but publication/action-draft execution does not call it (AIH-15
  publication gate is itself deferred).
- Permission revocation of a *user* (as opposed to source access) is not a
  change kind.
- Workflow steps are now covered: a correction or revocation flags the
  component (`changed`/`unresolved`), publication of a clone is refused until a
  reviewer re-establishes it, and a generated version with a flagged step cannot
  start an instance.
- A change reaching more than 20,000 edges is rejected rather than batched.

Verification of the generated-contract gates (run against a schema snapshot
taken from a module built from this tree): `verify-contract-ir`,
`verify-operation-history` (new release-bound revision against the pinned
`v0.3.48` IR, existing shapes unchanged), `verify-release-manifest`,
`verify-tenant-ownership` (492), `bootstrap-storage-policies --check`
(492/492), `verify-c2-commit-coverage`, the C8 ratchet, both reducer-call lints
and `lumiere-codegen` tests. `make check-codegen` itself was not run because
its `schema-snapshot` step fetches the schema of the configured maincloud
database rather than this tree.

---

### AIH-19 — Harness setup, certification, and admission matrix

**Plan ref:** §7.5, §8, M0–M6. **Depends on:** AIH-1–5 plus the evidence,
inspection and recovery issues required by the pilot's declared capability/path
matrix. **Size:** L

Configure versioned evidence requirements, source capability admission, reviewer
roles, applicability, retention, budgets and failure behavior. Bind runs to the
effective configuration. Extend certification with the plan's ERP/policy and
intellectual-source-to-workflow and interactive-recovery scenarios on flagged
pilot skills. Implement versioned Investigate/Design/Draft/Review mode profiles
and transitions within server authorization; delegation remains disabled until M8.
Record per-path capabilities, passed gates, evidence and explicit deferrals.
This issue admits one flagged pilot only; reuse its matrix for AIH-6 rather than
making pilot admission depend on wider migration.

**Acceptance:** all three scenarios pass using persisted records and normal authorized
API/UI reads, including compaction, adaptation, source changes, injected content,
fallback and revocation. Adapter fixtures cover provider variations; each
production provider/capability has its own smoke evidence before admission.
Mode escalation attempts deny; user steering cannot silently change approved
scope. The pilot passes every M0–M5 gate applicable to its declared paths and
records non-applicable/deferred paths explicitly. AIH-6 owns bounded wider
migration and the full M6 matrix; M7 remains the usage/evidence-quality gate.
Disabled specialists/extensions do not block the base, but cannot be
advertised as admitted until their M8/M9 gates pass.

**Status — partial; not complete.** Certification reads now return persisted
terminal evidence and a server-computed readiness reason. The API/BFF and skill
registry UI expose loading, retry, empty, evidence and readiness states; release
promotion is gated by that persisted readiness rather than client-side hash
inference. Knowledge-promotion propose/list/review routes are company-scoped and
feed accepted, unreleased skill versions into the same certification flow.
Generated reducer descriptors, authenticated browser-to-STDB E2E and the full
three-scenario admission matrix remain open.

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

**Status — partial; not complete.** Private durable question and lifecycle-event
records now carry revisions, required/optional semantics and an authorized
respondent identity/role. Ask, reply and steer commands use a checked continuation
and payload-bound idempotency key; replays succeed only for the identical command.
Steering increments a durable revision and forces a fresh checked checkpoint
before resume. The authenticated BFF/UI exposes inspect, ask, reply and steer
without accepting browser-supplied authority, while the gateway independently
rechecks the actor token and `ai.run.lifecycle` grant. Still open: timeout policy,
fine-grained dependency scheduling (a required question currently blocks the run),
live authenticated restart/reconnect E2E, and production capability provisioning.

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

**Delivered (evidence tracking, not a closed gate):**
`ai-gateway/src/orchestrator/progress.rs` tracks evidence fingerprints across
rounds. A tool result that repeats evidence already seen in the run does not
count as progress, which covers both the repeated call and the different call
with the same empty result. Each repeat is recorded as a `progress` step event;
past `LoopLimits::max_unchanged_results` the loop stops with `LoopStop::NoProgress`,
finalizing the durable run as `failed` with `agent_loop_stop:no_progress` — the
recorded blocker, since replanning and clarification need the unadmitted question
handler (AIH-20). Evidence is the whole protected tool result and the tracker
never keys on prompt, model or provider, so a provider switch cannot reset the
allowance; arguments are normalized so whitespace and key-order edits share one
call fingerprint. Unchanged errors and denied actions need no counter because
both already stop the loop on first occurrence (`ToolFailed`, `ToolDenied`).
Covered by `cargo test -p ai-gateway` (226 passed): allowance reset on new
evidence, stall past the allowance, different calls with identical empty
results, fingerprint normalization, the loop-level non-progress stop with its
recorded events, and bounded polling still reaching a candidate answer.

**Still open:** a per-tool polling policy with attempt, time and backoff bounds
(the capability contract carries no polling metadata, so one bounded allowance
stands in), bounded replan, and routing to an admitted question handler.

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

**Status — partial; not complete.** Schema-v2 checkpoints now persist an
append-only parent hash, checkpoint/concurrency sequence, decision-event cursor,
bounded-state and decision-state hashes, authorized dependency references,
acquired-evidence hash, and a checked compaction summary. STDB recomputes these
hashes and rejects stale parents; resume reauthorizes the actor, skill, inputs,
graph, knowledge and source dependencies before changing run state. New runs also
initialize a private lifecycle continuation, and the runtime resume bridge loads
that continuation and calls the checked reducer rather than directly changing a
wait state. Required durable questions and uncertain effects block resume. Full
continuation manifests still do not include every approval, candidate, progress
and budget component, and automatic recovery/rebuild on mismatch remains open.

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

**Status — partial; not complete.** Private reducers and the authenticated
gateway/BFF/UI now implement inspect, interrupt, checked resume, fork and compare
with event cursors, concurrency versions and payload-bound idempotency. Forks
start in `fork_pending_authority` and cannot resume until a trusted scope/budget/
approval snapshot is reacquired. Consequential effects have planned/dispatched/
confirmed/failed/uncertain revisions; uncertain effects block resume until
reconciled. Responses omit private event payloads and actor identities. Still
open: live two-client and provider-effect E2E, component/evidence/validation diff
materialization (compare currently certifies the two continuations only), and
public grant provisioning. The lifecycle reducers are published and pinned in
the immutable `lumiere-contracts` v0.3.51 release.

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

1. AIH-1
2. Generated capability-registry foundation → AIH-2
3. AIH-3
4. AIH-4, AIH-5 (parallel, both depend only on AIH-3)
5. AIH-13 → AIH-14 (AIH-13 may start alongside AIH-1)
6. AIH-7 → AIH-8/9; AIH-15 after AIH-3/4/5/14
7. AIH-20 → AIH-23 → AIH-24; AIH-21 after AIH-15; AIH-22 after AIH-3/4/5
8. AIH-16 and AIH-20/24 → AIH-17 → AIH-18
9. AIH-19 on one flagged pilot → AIH-6 bounded wider migration
10. AIH-10 → AIH-11 → optional AIH-12
11. AIH-25 and AIH-26 as separately admitted later capabilities after full M6
