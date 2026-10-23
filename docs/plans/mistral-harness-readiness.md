# Mistral harness readiness

**Current implementation/provisioning status (2026-10-23):** see
[Harness key readiness](../plan/harness-key-readiness-status.md). The assessment
below is historical; the integration branch includes enforced routed profile
deadlines/concurrency, uncertain-attempt retry fencing, legacy BFF retirement,
and explicit provisioning/catalog/smoke tooling. Live deployment and real-provider
admission remain separate gates.

Assessed 2026-10-16 against application baseline `ff98a918` and the pinned
`lumiere-contracts` 0.3.107 release. This is a source-backed integration
assessment, not live-provider or deployment certification. Credentials are to
be configured separately.

The follow-up [Mistral/OpenCode compatibility check](../evidence/mistral-opencode-compatibility-2026-10-16.md)
pins the upstream sources, records parser corrections found during comparison,
and provides a source-derived Large 4 provider example.
The subsequent [reasoning/replay implementation](../evidence/mistral-reasoning-replay-2026-10-16.md)
adds explicit model-specific effort and ephemeral native assistant replay.

## What is already implemented

The historical completion plan's claim that there is no tool transport or
execution runtime no longer describes the tree:

| Area | Current implementation | Evidence |
| --- | --- | --- |
| Mistral chat | Direct authenticated `/v1/chat/completions`, function schemas, assistant calls/results, token usage and termination classification; optional Kong transport | `ai-gateway/src/providers/llm.rs` |
| Governed execution | Typed DecisionGraphs and proposal-only reasoning; the admitted entry rejects skills without a governed program | `orchestrator/{run,governed_program,governed_programs,proposal_loop}.rs` |
| Model routing | Organization-scoped versioned profiles, role policies, review independence, fallbacks and shadows | `orchestrator/{model_configuration,intelligence_router}.rs` |
| Spend | Reserve → accept attempt → claim dispatch → call → record result → settle; uncertain outcomes retain reservations | `orchestrator/spend_admission.rs`, `spacetimedb/src/ai/spend.rs` |
| Evidence/recovery/UI | Answer gates, checkpoint/recovery, run lifecycle, evidence inspection and harness panels exist | `orchestrator/{answer_gate,governed_services,run_lifecycle}.rs`, frontend `ai-harness/` |
| Other Mistral adapters | `mistral-embed` embeddings and `mistral-ocr-latest` image OCR | `providers/{embed,vision}.rs` |

Paths in the evidence column are relative to `ai-gateway/src/` unless prefixed
otherwise. Existing source and fixture coverage do not establish persisted API,
UI, account access or full milestone admission. `agent_loop.rs` is now a
compatibility seam, not the place to restore model-controlled execution.

## Compatibility changes in this work

1. Accept both string and chunk-list completion content. Concatenate only
   answer text. Direct Mistral native state may be retained in bounded opaque
   in-memory replay; only `thinking_observed` and typed/visible output enter
   governed records. Usage and length stops remain visible to the spend and
   output gates. Unknown non-text chunks cannot become answer prose.
2. For direct Mistral typed single-shot requests, require tool use with
   `tool_choice="any"` and `parallel_tool_calls=false`. Decision/reasoning
   adapters require exactly one structured outcome; `auto` previously allowed
   plain prose or multiple outcomes. Generic Kong request behavior is retained.
3. Clarify the gateway environment example, including the dedicated spend
   reader and execution-envelope prerequisites.
4. Follow-up against OpenCode and the official Mistral SDK accepts non-text
   thinking units and object-valued tool arguments, and classifies
   `model_length` as an exhausted completion.

These changes do not automatically select a model or promote any skill.
Provider reasoning is available through the explicit opt-in settings documented
in the implementation evidence above.

## Current Mistral offerings to evaluate

Verified against official documentation on the assessment date. Discover exact
account-visible IDs with authenticated `GET https://api.mistral.ai/v1/models`
before provisioning profiles; aliases and account availability can change.

| Offering | Suggested harness use | Integration state |
| --- | --- | --- |
| [Small 4](https://docs.mistral.ai/models/mistral-small-4-0-26-03), documented `mistral-small-2603` | Initial cost-conscious typed decisions and generation candidate | Existing chat/tool transport; evaluate quality before assigning roles |
| [Medium 3.5](https://docs.mistral.ai/models/mistral-medium-3-5-26-04), `mistral-medium-3-5` | Harder reasoning/generation or a distinct review profile | Existing chat/tool transport; exact-model opt-in reasoning control is implemented |
| [Large 4](https://docs.mistral.ai/models/mistral-large-4-0) | Optional higher-capability evaluation/shadow | Public preview; model card displays `mistral-large-4` while reasoning docs reference `mistral-large-4-0`; resolve through the account catalog |
| [OCR 4.1](https://docs.mistral.ai/models/ocr-4-1) | Document ingestion | Existing OCR adapter flattens page markdown; it does not expose bounding boxes, structure or measured confidence |
| [Embeddings](https://docs.mistral.ai/models) | Retrieval | `mistral-embed` is implemented; changing the vector space requires deliberate reindexing/collection migration |
| Audio, moderation, Codestral FIM, provider-hosted agents/connectors | Later separate capabilities | No harness adapters for these APIs; require typed input/output, spend, evidence and effect contracts |

Magistral and Devstral are listed in the current catalog's deprecated section;
do not adopt the old completion plan's examples as a new default. Provider-hosted
tools must not bypass Lumiere capability authorization, drafts or verification.

## Remaining work, in order

| Priority | Gap | Concrete exit evidence |
| --- | --- | --- |
| P0 | **Provisioning:** keys alone do not create model profiles, policies, budgets, service grants, skill releases or calibration | One provisioned organization completes an authorized governed Mistral run with durable attempts, steps, evidence and settled spend |
| P0 for cross-provider routing | **Spend/provider mismatch:** routing chooses a profile provider, but both `configure_ai_spend` and `reserve_ai_spend` require `provider_eq(agent.provider, params.provider)` | A reviewed source + generated-contract change admits policy-authorized alternate providers against the same agent budget; real Mistral→Gemini reservation/fallback and exhausted-budget denial both pass |
| P1 | **Operational profile limits:** `timeout_ms` and `max_concurrency` are loaded but not enforced around routed calls; retries apply to every error without backoff/status classification | Bounded per-attempt deadlines, concurrency permits, typed provider errors and bounded 429/5xx handling; uncertain dispatched attempts remain reconcilable |
| P1 | **Provider capability truth:** process-global Mistral key and hardcoded endpoint; no account/region instance binding or live catalog validation | Instance-bound credentials/endpoint/catalog with downgrade tests; catalog metadata never grants ERP permissions |
| P1 for versioned reasoning policy | **Per-profile effort:** direct Mistral now honors explicit opt-in effort and in-memory replay; persisted model profiles still have no effort field | Future generated-contract release for organization/profile effort ownership; current deployment settings and admitted profile/agent output budgets are documented in the implementation evidence |
| P1 | **Live admission evidence:** deterministic fixtures do not prove account access, real tool-schema acceptance, model quality, restart behavior or UI settlement | Recorded synthetic-data provider smoke plus persisted authorized pilot, denial, cancellation/reconnect and settlement/reconciliation evidence |
| P1 for generic skill UX | **Legacy dispatch:** `/api/ai/skills/run` and `useRunAiSkill` still target the fenced `/v1/skills/run`; the legacy deterministic exception list is empty | Deliberately route supported skills through dedicated governed BFFs with typed response contracts; unknown skills remain denied |
| P2 | **Broader offerings:** chat input is text/tool-only; OCR preserves only markdown and reports a fixed confidence value | Typed multimodal/document results preserve provenance; replace the OCR confidence constant before treating it as measured quality |
| P2 | **Other API features:** JSON-schema response mode, prompt caching, predicted outputs, batching and provider SSE are not exposed | Add each through explicit profile/capability and accounting contracts when the workload needs it |

Same-provider multiple models can be funded with separate immutable price
snapshots if all are in the agent allowlist. Cross-provider routing cannot be
made usable just by adding a Gemini profile today. Both profile and agent token
limits must permit each request; the database also checks agent context limits.
Profile cost fields do not replace authoritative spend price snapshots.

Mistral recommends replaying thinking chunks in multi-turn reasoning. Direct
transport now supports bounded opaque in-memory replay. Governed adapters still
make independent typed calls and do not persist native thinking or retain it
across restarts.

## Credential and configuration handoff

1. Set `MISTRAL_API_KEY` on the **AI gateway server**, never a public frontend
   variable. Permit HTTPS egress to `api.mistral.ai`. This task environment has
   no Mistral credential binding and its restricted host list does not include
   that destination, so live provider calls were not attempted.
2. For direct Mistral, leave `KONG_LLM_URL` empty. When set, Kong receives every
   chat request and needs its own upstream configuration. The direct Mistral
   single-shot payload change does not apply to that proxy path.
3. Retain `STDB_HOST`, `STDB_MODULE`, `STDB_TOKEN`,
   `LUMIERE_AI_GATEWAY_INTERNAL_SECRET`, `AI_EXECUTION_ENVELOPE_KEY` and
   `AI_SPEND_READ_STDB_TOKEN`. The spend token must be a distinct registered
   `ai_spend_reader`; grant the writer the required reserve/settle permissions.
   Production additionally requires the dedicated certification token/runtime
   hash. Local identity setup already exists in
   `scripts/register-local-service-identities.mjs` and `scripts/init-stack.sh`.
4. Fetch the account's `/v1/models` metadata, then register immutable profiles
   with `register_ai_model_profile`: `provider="mistral"`, exact `model`,
   appropriate `allowed_roles`, explicit token/context limits and
   `supports_tool_calling=true` for decision/reasoning/review. Start with
   `max_retries=0`, no shadows, and a bounded pilot. Do not mistake stored
   timeout/concurrency values for enforcement until the P1 work lands.
5. Register `register_ai_intelligence_policy` defaults for decision, reasoning,
   generation and review. Use a distinct review profile and respect any stricter
   configured provider independence requirement. Keep all initial profiles on
   Mistral until the cross-provider spend gate is fixed. Different models for
   decision and review are preferable to merely renaming the same model.
6. Configure an active Mistral `AiAgent` whose `allowed_models` includes every
   selected model. Configure integer monthly budget/current-period price
   snapshots with `configure_ai_spend` for each model/currency. Prices are
   millionths of the configured currency **per 1,000 tokens**, not per million.
   Use current reviewed rates; do not hardcode preview promotional pricing.
7. Provision/enable the governed skill and its active certified release. Call
   the internal `/v1/harness/governed/bootstrap` with the organization and policy
   ref to register built-in DecisionTypes and calibration. It requires a policy
   to exist first; runtime does not create configuration on demand.
8. Run an authorized `report_analysis` pilot with known ERP data, actor/company
   scope and its reviewed capabilities. A deterministic `low_stock` run alone
   cannot prove Mistral connectivity. Inspect provider attempts, output gating,
   run review and settlement before widening the workload. Use the dedicated
   `/api/ai/skills/report-analysis` BFF and its trusted actor headers; the generic
   `/api/ai/skills/run` still targets the intentionally disabled legacy runner.

`EMBEDDING_PROVIDER=mistral` changes indexing, not chat routing. Leave embedding
and vision settings on the existing providers for a chat-only pilot. The current
readiness endpoint probes those dependencies; it does not authenticate Mistral
chat or validate the selected model catalog. A green `/health/ready` therefore
does not prove Mistral access, and local Ollama may still be required.

## Validation

Transport fixtures cover string/null/chunked content, answer-only extraction,
thinking-only exhaustion, tool calls plus chunks, malformed visible chunks and
single-shot request selection. Validation on this revision:

- `bash scripts/prepare-vendored-contracts-rust.sh`: verified and materialized
  the pinned 0.3.107 archive without changing the release or lockfile.
- `cargo test --offline --locked -p ai-gateway`: **663 passed, 8 ignored**.
  Network sandbox access was needed for three existing loopback HTTP fixtures;
  the initial restricted run failed only at their socket binds.
- After the source-comparison corrections: **666 passed, 8 ignored**; the
  provider transport subset has **26 passed, 2 ignored**.
- After reasoning controls and ephemeral replay: **683 passed, 8 ignored**;
  final provider transport checks have **36 passed, 2 ignored**.
- `cargo check --offline --locked -p ai-gateway`: passed with warnings.
- `cargo fmt -p ai-gateway -- --check`, `git diff --check`,
  `lint-reducer-call-literals.sh` and `lint-trusted-route-boundaries.sh`: passed.

No credentials were configured, no live Mistral calls were made, and no
deployment or admission gate is claimed.

API contract references: [Chat](https://docs.mistral.ai/api/endpoint/chat),
[function calling](https://docs.mistral.ai/studio/conversations/function-calling),
[reasoning](https://docs.mistral.ai/studio/conversations/reasoning),
[model discovery](https://docs.mistral.ai/api/endpoint/models).
