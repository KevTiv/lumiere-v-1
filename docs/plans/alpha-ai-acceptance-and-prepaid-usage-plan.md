# Alpha AI acceptance and prepaid usage plan

Status: source repair locally validated; current-tenant activation blocked. Updated 2026-11-11.
No runtime, allowance or payment change is made by this plan.

Complete the owner's non-OCR AI workflow, then add prepaid usage with manual top-ups. Keep one shared monthly limit for Mugisha Farm and Farm UI acceptance. Extend the existing reservation and settlement system so funding and usage have one canonical owner.

## Current alpha tenant activation — execute before broader expansion

This section supersedes conflicting historical assumptions below for the
current production repair. Initial source review base: `450987d21`; the repair
candidate is based on `e2b8e56c2`, including merged #404 and #405.
The target is Umunopfu Chicken Ltd, organization **4097**, company **4097**,
existing agent **2** (`mistral-mugisha-usd5`) and policy
**`mistral-mugisha-usd5@1`**. These are operator target selectors, not defaults
to hard-code in application logic; every write must resolve and validate them.

Preserve the existing allowance, funding mode, agent identity, spend history,
settings and company scope. The historical USD 10/two-company and prepaid
proposals below are not authorization to raise the current USD 5 cap, grant
credit, enroll a replacement agent or enable payments. Sharing the same agent
with another company remains a separately approved owner operation.

### Tenant experience and platform ownership

The release goal is **open chat and ask**, with a working platform-approved
default. Tenant users must not configure providers, credentials, agents, model
profiles, embeddings, meters, service identities or certificates before using
the prominent chat feature. These are platform deployment/activation duties.
The AI Skills repair action is an administrative binding/catalog operation,
not the normal entry path and not an execution-readiness certificate.

As additional models are made available, the tenant-facing control is a simple
approved-model choice in chat. That choice must resolve a platform-approved
generation profile within the current company/policy and the same spend pool;
it must not create a separately funded agent or rewrite shared agent defaults
for other conversations. Review-model independence and the existing
authorization, evidence, cost and answer-release gates remain authoritative.
Do not expose raw provider/model configuration as the model picker.

The current repair must make the default usable without a tenant configuration
round. A future model chooser is not implemented by the native allowlist
maintenance operation: do not claim that operation is a completed chat picker.
Before adding the chooser, validate a per-turn profile-selection contract and
its policy/pricing/recovery semantics end to end. Platform enablement and
tenant selection must remain separate authorities.

Missing platform activation is a service limitation for the affected surface,
not a tenant setup task or a healthy empty answer. Normal ERP and any already
authorized non-semantic context paths remain available. Setup responses must
report binding state separately from verified execution readiness; the UI must
not invite repeated setup clicks to repair missing platform authority.

### What the current tenant must be able to use

The alpha boundary is governed assistance over authorized company data, not
unrestricted autonomous ERP operation. Restore these supported journeys in
order; record availability per surface rather than one global "AI ready" flag.

| Surface | Current-alpha result and acceptance boundary |
| --- | --- |
| AI Skills setup and readiness | The signed-in owner can inspect the exact company agent/policy, missing capabilities and release blockers. Setup preserves explicit disablement, custom bindings and existing funds. A successful setup is not chat acceptance. |
| Grounded chat and selected-record questions | Ask about a known authorized indexed source and receive an answer with a source/version-bound citation that opens. Also exercise the existing selected-record/live-read path; do not make ordinary ERP reads depend on a vector backfill. |
| Text documents and bounded context indexing | Existing supported text/text-PDF extraction → current DMS evidence version → completed indexing → retrieval. Selected activity references remain actor-bound and bounded; no whole-tenant backfill. Saved/uploaded is not indexed. Scans/images report OCR unavailable. |
| Form suggestions and native action drafts | Independently admitted `form_suggestion` and `action_draft_generation` prepare the correct native form/draft with selected-company context and provenance. Human confirmation uses the existing business owner; verify the exact saved record, not just draft approval. No autonomous posting, payment or stock mutation. |
| Report analysis and run controls | Independently admitted `report_analysis` produces a supported answer with ordered durable steps, evidence and settled spend. Inspect/refresh/reconnect/cancel/recover through the existing lifecycle owner without duplicate dispatch. |
| Saved guides and existing import/workspace references | Save/reopen the exact guide revision and resolve permitted saved import or spreadsheet selections through their existing owners. Draft guidance is not certified evidence; saved task status is not an executed import. Preserve dirty forms and current selection on navigation. |
| Additional admitted non-OCR tools | Report composition, low-stock, the five Finance reviews, CSV mapping, insights and daily briefing retain the cohort gates below. Admit and prove each independently where exposed to this tenant; otherwise show the exact missing prerequisite, never imply availability from a catalog row or an admitted route. |

OCR/vision, external research, automatic ERP effects, unbounded activity
indexing, a second funded pool and payment/prepaid cutover remain outside this
repair. Missing admission must be visible without blocking normal ERP use.

### Evidence baseline and changes already on main

The production readback from the preceding operator execution in this thread
established the following. It has **not** been refreshed by pulling source;
repeat private readback immediately before any write or paid acceptance.

| Item | Recorded production state | Consequence |
| --- | --- | --- |
| Company/agent scope | Company 4097 belongs to organization 4097; active agent 2 has `company_id = 4097` | Keep this valid company scope for the immediate repair. |
| Generation binding | `rag_generation` skill 3 is company-bound to agent 2 and policy `mistral-mugisha-usd5@1`; form/action skill IDs are 4097/4098 | Resolve the same live identities and independently verify source versions, certification and grants before dispatch. Binding existence alone is not readiness. |
| Allowance | November budget 3: USD 5,000,000 microunits, 9,060 settled, zero held | Keep the cap and all counters; compare readback around activation. No funding or cap write. |
| Agent capabilities | Models: `mistral-small-2603`, `mistral-medium-3-5`; actions: `skill_run`, `chat`, `form_suggest`, `action_draft` | Missing `mistral-embed`, `embedding_query` and indexing action require an in-place, authorized repair. |
| Metering identities/prices | Dedicated reader matches its active registration; gateway writer has no org `ai_spend_writer` registration; embedding price absent | Register the existing verified writer and reviewed meter through platform authority, preserving reader/certification separation. |
| Infrastructure catalog | No effective `embedding_query`, `document_embeddings` or `activity_indexing` entries | Add only required bounded infrastructure definitions through their canonical catalog owner, then discover actual IDs. Never invent IDs or certificates. |
| Provider/index | Mistral embeddings selected; both compatible 1,024-dimensional document/activity collections are green but contain zero points. Account catalog exposes the exact approved generation/review/embedding models; no paid call was made. | Complete authorized source/version-bound indexing before cited chat acceptance; query admission requires both stores ready. Startup and account catalog access do not prove generation or source coverage. |
| Platform pricing authority | No superuser records returned; SQL operator profile is inactive and not superuser | Operator SQL access is not pricing authority. Platform owners must supply the approved provisioning/recovery path; do not promote the tenant owner or reuse a writer as administrator. |
| Chat | Gateway log: `admitted query embedding unavailable`; no new cited answer verified | Configuration repair, truthful degraded-state handling and signed-in live acceptance are all still required. |

Latest main includes #399's setup lookup and client error recovery improvements.
Reuse those changes rather than replacing the setup owner:
[surface provisioning](../../ai-gateway/src/orchestrator/surface_provisioning.rs)
and [company defaults](../../spacetimedb/src/ai/company_defaults.rs).
The latter accepts shared or exact-company agents but configures only three
generation surfaces; it does not repair embedding models, meters or actions.
The [platform enrollment owner](../../spacetimedb/src/ai/platform_defaults.rs)
deliberately leaves existing custom/funded agents alone. A new platform
template or enrollment is therefore not a repair path for agent 2.
The checked-in compatibility manifest currently pins contracts **0.3.178** and
application catalog **40**; the activation guide's 0.3.166 is historical.
Verify the actual coherent deployed release, not a presumed match to main.
Current Kong configuration and the route fixture include `/api/ai/rag` and
`/api/ai/rag/stream`. Earlier workbench-admission evidence excluded those paths
from that particular change; verify the actual deployed method/path rules for
every selected surface rather than treating either old evidence or current
source as proof of deployed admission.

### Ordered repair packets

Only `Verified` with the listed evidence counts as done. Source validation is
recorded separately in the
[candidate checkpoint](../evidence/alpha-ai-activation-candidate-validation.md).
Its passing local checks do not close the production completion gates below.

| ID / priority | Required change and owning paths | Completion gate | Status |
| --- | --- | --- | --- |
| T0 / P1 | Re-read served artifacts/schema, exact edge/BFF routes, company, agent, policy/profiles, effective bindings, releases/certificates/grants, budget/holds, meters and service identities through existing Railway private SSH/operator job. Check both vector stores and account-visible model access without generation. | Exact target and schema verified, reviewed missing-only change list, known source checksum/version and approved bounded test question; no secrets in logs/manifests. | In progress |
| T1 / P1 | In `spacetimedb/src/ai/agents.rs`, add a narrow audited model-allowlist operation analogous to `set_ai_agent_action`; extend action validation for `embedding_query` and `embedding_index`. Prefer intent-shaped toggles over reconstructing the full private agent through `update_ai_agent`, whose nullable prompt/budget inputs can replace existing values. | On the same agent, add only `mistral-embed` and required actions; omission/unrelated values, scope, model settings and spend remain unchanged. Same request is a no-op; unauthorized/foreign-org edits fail. Review provider/model validation and audit exact changes. | Implemented, unverified |
| T2 / P1 | Align `scripts/provision-mistral-capabilities.mjs` and the activation runbook with existing company-compatible runtime semantics: agent must be in the same org and either organization-shared or scoped to exactly the requested company. Do not remove scope checks or require sharing merely to run provisioning. | Tests accept exact-company and shared agents, reject foreign-company/org agents, and retain single-pool, disabled/conflicting binding, allowlist and no-write-before-complete-inspection checks. Agent 2 remains company-scoped. | Verified |
| T3 / P0 | Platform operator supplies the approved authority path, registers the existing server-verified gateway writer, verifies explicit metering/attempt/queue/evidence permissions, and creates only the required missing infrastructure catalog records. Owners: `core/cold_tier_identity.rs`, `ai/metered_spend.rs`, existing skill catalog. | Writer and reader readbacks match distinct runtime identities. Tenant owner/writer cannot configure meters, self-register trusted authority or manufacture certificates. No new pool or ERP write grant. Missing active platform authority remains a blocker, not a reason to weaken checks. | Blocked |
| T4 / P1 | Release T1/T2 through the canonical contract/codegen lane; align module, generated bindings, Rust/frontend pins, durable projection/catalog and API/gateway/web/edge artifacts. | Exact deployed reducer schema and release hashes read back; regeneration/checks pass. Never edit generated bindings or old migrations by hand. Recheck whether a durable migration is needed rather than assume a command-only change needs a new table. | Blocked |
| T5 / P1 | With live skill IDs and source hashes, run `scripts/provision-mistral-capabilities.mjs --plan`, `--check`, `--apply`, then `--check` in the private operator runtime. Supply an explicitly reviewed `mistral-embed` token rate/date in integer USD microunits per 1,000 tokens. Include query and only required indexing surfaces; omit OCR. | All prerequisites checked before writes; only missing meter/company bindings written. Readback verifies agent/policy/scope/allowance unchanged and complete bindings. An uncertain response stops for durable reconciliation before retry. | Blocked |
| T6 / P1 | Verify generation-surface source versions, independent certificates, capability grants and profile/price bindings individually. Use existing setup/registry owners; include report analysis and form/action surfaces in addition to chat. | Each enabled surface resolves the current source/release and actor/company authority, or displays a specific blocker before a paid call. No certifying one skill as a shortcut for another. | Implemented, unverified |
| T7 / P1 | In `ai-gateway/src/routes/rag.rs` and existing BFF/client error handling, distinguish healthy empty retrieval from unavailable embeddings/index/service. Preserve the supported authorized live-snapshot fallback. | Missing configuration/dependency plus no grounded fallback reports retrieval unavailable, not a healthy "no relevant information" result. A healthy no-match stays distinct; valid grounded fallback discloses degraded retrieval; normal ERP remains usable. | Implemented, unverified |
| T8 / P1 | Run the signed-in company-4097 workflow matrix below; retain exact source/run/reservation/attempt and saved-effect receipts privately. | Cited answer and independently admitted text surfaces work on the served release, with settled shared economics and fresh reload/recovery. Unaccepted additional cohorts remain explicitly unavailable. | Blocked |

T1/T2/T7 can be implemented independently. T3 authority and reviewed pricing can
be prepared alongside source work. T4 precedes activation; T5/T6 precede T8.
The model-toggle operation is the preferred implementation, not an additional
competing configuration authority: it mutates the existing agent under the
same authorization/audit owner. A contract-reviewed optional allowlist patch is
an alternative only if it also proves preservation of all unrelated fields.

### Live acceptance and preservation gates

1. **No-cost readiness first:** selected company, exact agent/policy, current
   sources/releases, grants, reader/writer registration, meter prices and
   available allowance. No status check silently reindexes or pays for a call.
2. **Cited chat:** use a known, authorized text source with recorded DMS
   version/checksum and completed index state. Ask a source-specific question
   through the ordinary signed-in BFF; open the returned citation and compare
   it with the actual current passage. Verify query-embedding and generation/
   review attempts, unit-aware usage and settlement against the same agent-2
   pool. A nonempty model answer or collection point count is not proof.
3. **Indexing:** exercise existing supported text ingestion without OCR and
   explicit bounded selected-record indexing where admitted. Recheck source
   access/version at retrieval; changed, deleted or revoked sources are withheld.
4. **Other current surfaces:** one new fully settled report; a form suggestion
   preserving entered values; a reviewed action draft followed by exact native
   saved-record readback; save/reload of a guide and authorized selected
   import/workspace references. Verify independent source admission for each.
   Finance/report-composition/low-stock and remaining input-assistance cohorts
   get individual evidence before being advertised as available.
5. **Recovery:** refresh/reconnect returns the same run/result and economics;
   lost-response replay cannot redispatch or repeat a saved effect. Unknown
   paid outcomes keep their holds and use the governed reconciliation owner.
6. **Isolation/failure:** missing binding/model/action/meter/certificate,
   disabled provider, unavailable retrieval and insufficient allowance block
   the affected paid path with actionable limitations. Cross-company and
   unauthorized access is rejected. Run revocation, exhaustion, races and
   injected failures with a second authorized actor in an isolated lane;
   never lower the live cap or revoke production access just to test.
7. **Preservation:** read back agent 2, original company scope, policy, allowance,
   historical reservations/usage and unrelated agent fields after activation.
   Account for only the explicitly approved acceptance spend; no credit,
   allowance increase, synthetic payment, second pool or OCR usage appears.

Source tests to extend/run include `spacetimedb/tests/ai/company_defaults_test.rs`,
`owner_configuration_test.rs` and `metered_spend_test.rs`,
`scripts/tests/test-provision-mistral-capabilities.mjs`, the existing RAG tests,
`frontend/web/lib/assistant-turn.test.ts`, and the authenticated browser owners
listed in the [implementation ledger](../plan/alpha-ai-implementation-ledger.md).
Add persisted positive/negative model-toggle tests and an authenticated
company-4097-equivalent cited-chat scenario; fixture assertions are not live
provider, billing or authorization acceptance. Run focused source tests before
the coherent release, and keep local, hosted CI and production evidence separate.
Reuse the stronger assertions in
`frontend/web/tests/e2e/ai-rag-evidence-access.spec.ts`: source-bound passage
citation, released verification, non-degraded retrieval, provider/model and
persisted claim provenance. A skipped optional gateway test or a nonempty
answer in `mvp-ai-rag.spec.ts` cannot close T8.

This slice is complete only when the tenant can use the declared enabled
surfaces through its normal signed-in UI, with independently verified admission,
current evidence and settled usage. Unresolved core chat/configuration P1s block
the claim. Deferred cohorts stay visibly restricted, not silently counted done.

## Decisions and release scope

- Historical broader target: **USD 10 total per UTC calendar month**, shared by both companies in the same organization. This is not the current-tenant repair allowance; preserve the existing USD 5 until a separate approved owner change.
- The user selected **prepaid credits with manual top-ups**. Automatic charging and postpaid invoices are outside this plan.
- Funding and the monthly limit are separate. A top-up adds credit; it does not raise the limit or grant AI capabilities.
- Keep the existing signed-in owner. Do not create another platform administrator or wildcard grant.
- Defer OCR, vision and external research. Query embeddings and bounded text indexing/RAG are required for the current cited-chat slice and need their own admission and cost coverage; non-semantic text workflows retain their existing independent paths.
- AI changes remain proposals or drafts. Existing approval rules govern accounting posting and other consequential actions.
- Preserve farm records, unresolved source facts, filenames, hashes and request identities. Use one writer for live UI acceptance.

There are three release results: owner core acceptance, the declared non-OCR skill set, and prepaid payment acceptance. Passing one does not imply that the others passed.

## Historical live baseline — 2026-11-01

The acceptance run on 2026-11-01 verified served revision `04d8541e4d4cfea61bcf5af4144ab054f33eb878`, contracts 0.3.163 and application catalog 32. Recheck the served release before execution.

| Area | Recorded result | Remaining work |
| --- | --- | --- |
| Monthly allowance | The live cap remains USD 5. The USD 10 update returned `User not found`; readback was unchanged. | Apply and read back the limit through a supported authenticated owner path. |
| Agent scope | The existing agent is bound to Mugisha. The acceptance company has no matching agent. | Support one shared agent and ledger while retaining company authorization on every run. |
| Skill release | Only report analysis is configured for the farm. Its active source hash differs from the deployed adapter. | Register the exact source, independently certify it and promote through the existing release owner. |
| Harness access | Owner grants exist for evidence, knowledge, lifecycle and descriptor access. The edge returns 503 for lifecycle and ingestion. | Admit exact reviewed paths and methods. Unknown paths stay denied. |
| Completion | A saved run shows provider usage and `agent_settled`. A new request stopped at the hash check. | Diagnose the remaining evidence, artifact and settlement conditions; prove a new fully settled run. |
| Farm UI | Import recovery and provenance passed. Category save, account grouping and selected-company location reads have defects. | Review, release and recheck the focused fixes below. |
| Document AI | Files are saved and registered, indexing is pending, and embedding/vision providers are disabled. | Keep indexing outside the current acceptance claim. |

Keep detailed actor scope, raw source data, screenshots and receipts in the private acceptance record, outside Git.

## Delivery order

Owners below are engineering roles, not assigned people or agents.

| Packet | Owner and dependency | Deliverable and exit evidence |
| --- | --- | --- |
| A1 Farm UI repairs | UI/query owners; independent | Complete [#347](https://github.com/KevTiv/lumiere-v-1/pull/347), [#348](https://github.com/KevTiv/lumiere-v-1/pull/348), [#349](https://github.com/KevTiv/lumiere-v-1/pull/349) and [#350](https://github.com/KevTiv/lumiere-v-1/pull/350). On the release, category names persist, account groups match native values, exact selected-company locations open, and corrected E2E paths pass. |
| A2 Owner configuration | API/module/auth owners | Typed configuration read and audited limit/scope commands. The current owner applies USD 10, refresh reads the exact saved revision, and both authorized companies share one ledger. |
| A3 Current report release | Runtime/certification owners; A2 for final scope | Matching manifest, independent certificate, release and model-policy binding. No-cost readiness shows specific blockers; invalid configuration stops before paid dispatch. |
| A4 Harness access and completion | Edge/runtime owners; A3 | Exact route admission, lifecycle controls and final settlement. A new run fully settles and recovery returns that exact run. |
| A5 Owner core acceptance | Acceptance owner; A1–A4 | Real signed-in UI runs in both company contexts with private receipts, economics, scope denials and preservation checks. |
| A6 Additional text skills | Skill owners; expand after A5 | Certify, bind and accept each cohort below. Every enabled feature has its own matching release and live result. |
| P1 Prepaid ledger | Spend/platform-billing owners; design with A2, release after A5 | Funding entries and available balance extend the existing spend owner. Atomic admission enforces both funding and monthly allowance. |
| P2 Owner usage controls | UI/API owners; P1 | Balance, monthly use, holds, receipts and manual top-up states. Refresh recovers exact operations; top-up never changes the cap. |
| P3 Payment adapter | Platform-billing/integration owners; P1/P2 | Hosted checkout and verified funding events. Stripe is the initial proposed adapter. Test-mode payment, recovery and reversal cases pass. |
| P4 Paid release | Release/acceptance owners; P3 | Separate payment acceptance, controlled live payment evidence and one real AI usage settlement reconcile. |

**First implementation batch: A1 through A5.** Payment integration does not block that alpha run. Required schema changes use generated contracts, aligned pins and migration checks before the ordered release. Keep source fixes, deployed fixes and live results distinct.

## Owner configuration and shared scope

Use the current WorkOS session and server-derived actor and organization. Browser input can request an authorized company and limit; it cannot provide authority identity, service credentials, prices or spent counters.

The current `configure_ai_spend` operation combines limit configuration with an appended price snapshot. Generic session dispatch denies it, and the existing server connection is not a valid application user for the write. Do not expose the full operation or grant its service identity administrator access. Add a narrow limit-update command under the existing spend owner, with authorization, expected revision, idempotency key and audit data. Updating a cap must not create a price snapshot or reset usage.

Prefer a supported, audited scope update of the existing agent. Verify its organization, preserve its ledger and leave existing runs in their original company. An organization-scoped agent still requires session membership, role capabilities, skill bindings and company authorization on every call. Do not create two independently funded agents to simulate a shared cap.

Keep one funded agent in this alpha. Before enabling multiple funded agents, add one organization-level aggregate admission limit; independent agent limits cannot enforce the organization total.

The owner can change its spending limit. It cannot mint prepaid credits, mark payments received, change provider prices or self-certify skills. A manual sponsored credit needs a distinct trusted funding operation and attributable approval. **A USD 10 cap is not a USD 10 credit grant.**

## Non OCR skill acceptance

| Cohort | Features | Required live result |
| --- | --- | --- |
| Core | Report analysis, persisted evidence and run controls | Supported answer and exact evidence reach full settlement; refresh recovers the same run and economics. |
| Business reviews | Five Finance reviews, report composition and low-stock analysis | Each skill uses its matching release and permitted company data. Missing evidence gives a clear blocker; proposed changes stay drafts. |
| Input assistance | CSV mapping, form suggestions, action drafts, insights and daily briefing | Each supported feature opens the correct target or saved result, retains provenance and requires normal approval. A lost reply does not repeat an effect. |

Record exact version, company binding, capabilities, model policy, request identity and result IDs for each feature. A compiled adapter or queued job does not prove completion. Show why a feature is unavailable before a paid call.

## Funding and monthly allowance

Use USD integer microunits: one USD is 1,000,000 microunits. Retain immutable provider price snapshots. Commercial credit pricing is a separate decision before real customer payments. Do not silently add a markup or present provider cost as an approved retail tariff. The alpha retains its reviewed provider-cost accounting until that decision.

For a new request:

```text
monthly_remaining = monthly_limit - settled_this_month - held_this_month
credit_available  = net_funding - lifetime_usage_debits - all_open_holds
admissible        = min(monthly_remaining, credit_available)
```

These equations explain the policy. The implementation must use checked integer arithmetic and explicit deficit states. It must not wrap unsigned balances or erase a debt by clamping stored money to zero.

For prepaid use, the cap and credit balance measure the customer usage debit. If the retail tariff differs from provider cost, preserve separate immutable tariff and provider-price references and record both amounts. Reconcile or migrate the current provider-cost allowance before that pricing change; never compare a provider-cost hold with a retail-credit balance as if they were the same amount.

Reserve the full bounded request allowance against both constraints in the same canonical transaction before provider dispatch. Settle actual usage once and release only the unused allowance. Retries, review-model calls and continuations consume the same pool. A dispatched call with an unknown outcome retains its hold until reconciliation. An interruption, error or month boundary does not prove there was no charge.

| Example | Available result |
| --- | --- |
| USD 20 credit; USD 10 monthly cap; no usage | At most USD 10 can be committed this month. |
| USD 20 credit; USD 8 settled and USD 1 held this month | USD 1 remains available for new commitments this month. |
| USD 2 available credit; USD 10 monthly allowance remaining | At most USD 2 can be committed. |
| Monthly cap reached; another USD 10 top-up confirmed | Credit rises; the cap still blocks new calls. |
| Owner raises the cap; no credit is available | The balance still blocks new calls. |

Examples assume one charging currency and no additional fees. Funding amount, service-credit value, taxes and processor fees must be explicit before checkout is enabled.

### Rollover and cap changes

Persist the approved recurring monthly policy on the server. Create each new UTC period once, by a durable scheduled operation or atomic first-use operation. Missing or invalid configuration blocks dispatch; it must not create an unlimited allowance.

Preserve month rows and reservations. Late settlement updates the reservation's original month. Older open holds still reduce the prepaid balance. A new month does not replenish prepaid funds.

Proposed alpha credit terms: unused credits carry forward without automatic expiry. Confirm customer terms before paid sale. The monthly allowance renews, but unused monthly allowance does not accumulate. A USD 10 monthly cap does not promise another funded USD 10 each month.

Allow an authorized current-month increase after confirmation. Reject an immediate decrease below settled plus held amounts and offer the lower cap for next month. Provide a pause for new paid calls without cancelling existing holds or preventing settlement. Guard edits with the saved policy revision.

## Canonical data and payment boundary

Keep `AiSpendBudget`, `AiSpendReservation`, `AiProviderAttempt` and their settlement transitions as the usage authority. Extend the same SpacetimeDB owner for the credit account, immutable funding/reversal entries and versioned allowance policy. Final table names belong to implementation review.

Link every usage debit to its existing reservation. Link every funding/reversal to a unique approved grant or verified payment/refund identity. Balance summaries must be transactionally maintained and reconcilable to these records. Enforce unique organization, pool and period identities. Preserve history through reversal entries; do not keep monetary authority in generic metadata or float counters.

The platform billing account can identify the organization customer and service status. Its existing plan/seat/status fields are not a wallet. ERP customer subscriptions remain a separate business domain. Reuse durable integration patterns, but do not create farm sales, AR or stock transactions for Lumiere AI credit purchases.

Postgres can hold a durable payment inbox and read projections if needed. It must not independently approve AI spend. A verified payment issues an idempotent funding command to the spend owner. Payment does not grant skills, company membership or a higher cap.

## Manual top ups and payment integration

Before payments, retain the existing sponsored alpha allowance. Prepaid cutover needs an explicitly approved initial grant or verified funding, with opening reconciliation of prior usage and holds. Do not invent a payment or copy the cap into a credit balance.

For paid top-ups:

1. An authenticated owner selects an allowed amount. The server resolves organization, currency, service-credit value and a server-owned product/tariff.
2. Persist a funding intent and stable request key before creating hosted checkout. Reconcile lost replies against that intent before retry.
3. Verify signed provider events, receiving account, test/live mode, customer-to-organization mapping, amount, currency and successful paid state. A browser redirect is not payment evidence; delayed methods remain pending until verified success.
4. Persist each valid event durably before acknowledgment. A worker issues the funding command once per payment. Deduplicate event IDs and the underlying payment/funding identity.
5. Read back the exact funding entry and balance. Show pending, confirmed, failed and reversed states after refresh.
6. Handle refunds and disputes through linked reversal entries. Block new calls when a reversal leaves insufficient credit; retain valid holds and allow settlement. If prior use leaves a deficit, show it and require resolution. Duplicate/out-of-order events must not credit or reverse money twice.

Stripe documents [webhook-based fulfillment](https://docs.stripe.com/checkout/fulfillment), [event verification and duplicate/out-of-order delivery](https://docs.stripe.com/webhooks), and [idempotent requests](https://docs.stripe.com/api/idempotent_requests). Apply all three. A provider request key alone does not deduplicate Lumiere's credit ledger.

Hosted payment entry keeps card data out of Lumiere forms. Keep provider credentials on the server. Manual top-ups need no automatic reload, card-on-file charging or billing subscription.

## Owner usage screen

Show one organization total with optional company breakdowns. Label credit balance, available credit, settled use this month, funds held for in-progress/uncertain calls, monthly cap and next UTC reset separately. Company breakdowns are not separate funded balances.

Provide **Change monthly limit**, **Pause new paid calls**, **Add credits**, **View usage** and **View receipts** when their owners and permissions are available. Before payment integration, hide checkout and explain the sponsored allowance.

A low balance can offer a top-up. A reached monthly cap can offer a deliberate cap change or waiting for reset. One action must not silently do both. Proposed alerts are at 80 percent and 100 percent, with held amounts visible. Positive remaining funds do not guarantee that a larger request can start.

Show separate blockers for exhausted credits, reached cap, stale release, missing binding and unavailable provider.

## Acceptance evidence and release gates

| Case | Required evidence and environment |
| --- | --- |
| Shared allowance | One ledger and aggregate cap. Simultaneous requests in both companies cannot exceed it. Run races in an isolated lane. |
| Owner configuration | Session-derived scope, stale-edit rejection, exact readback and audit actor. Other users cannot mint credit or alter another organization's policy. |
| Real completion | New report fully settles with ordered steps, original evidence references, exact provider usage and reconciled economics. |
| Recovery | Refresh returns the same run; replay does not repeat paid/draft effects; stale continuations reject. Exercise each supported intent, not only inspection. |
| Farm preservation | Hashes, source facts and existing drafts stay unchanged. Report new references, drafts and posts separately. No snapshot becomes current stock. |
| Cap/balance exhaustion | Either insufficient constraint blocks before dispatch. Settlement and read-only inspection remain available. |
| Month boundary | One new period; credits carry forward; old holds stay committed; late settlement produces one debit in the correct period. |
| Manual grant | One approved funding identity produces one entry. Replay is a no-op. Owner-authored fake payment/grant data is rejected. |
| Payment recovery | Same intent after lost reply; duplicate/out-of-order events yield one correct credit; forged/wrong-environment events add none. |
| Reversal | Refund/dispute entries reconcile once, preserve holds, stop unfunded calls and expose any deficit. |
| Faults and actor revocation | Use an isolated environment and second authorized actor. Do not inject failures into shared production or substitute same-actor company switching. |

Record served revision, contracts, catalog, actor/org/company scope, request/receipt IDs, created IDs, source hashes, prices, usage and balance readbacks privately. Keep source tests, hosted CI, payment test mode and actual live acceptance as distinct evidence classes.

**Gate A:** owner core acceptance on Railway, with OCR outside scope. The current
tenant's cited-chat/text-indexing checks above are required for semantic
document chat; the earlier blanket exclusion of document AI no longer applies.
**Gate B:** each declared non-OCR skill cohort passes its own release and live checks.
**Gate C:** prepaid checkout passes concurrency, payment recovery, reversal and isolation checks, then controlled live payment reconciliation.

Unavailable second-actor/fault cases stay blocked and prevent a full platform certification claim. They do not erase completed owner-workflow evidence.

Before Gate C, decide the retail tariff, top-up amounts, fee/tax display, carryover/expiry and refund terms, merchant-account suitability, and test/live procedures. These decisions do not block A1 through A5.

## Source owners

| Concern | Current owning source |
| --- | --- |
| Spend and scoped reads | `spacetimedb/src/ai/spend.rs`, `spacetimedb/src/ai/spend_reads.rs` |
| Provider admission and economics | `ai-gateway/src/orchestrator/spend_admission.rs`, `ai-gateway/src/ai_spend.rs` |
| Agent scope, bindings and releases | `spacetimedb/src/ai/agents.rs`, `spacetimedb/src/ai/skills.rs`, `spacetimedb/src/ai/skill_registry.rs` |
| Session operations | `api-server/src/commands.rs`, `api-server/src/routes/billing.rs`, `frontend/web/app/api/ai/` |
| Platform billing boundary | `spacetimedb/src/core/billing.rs` |
| Edge and Workbench | `infra/kong/kong.yml`, `frontend/web/app/(modules)/ai-harness/` |

See [Farm UI gap coordination](farm-ui-gap-coordination-2026-10-31.md) for the existing delivery record. Inspect the current release head before implementation. This plan extends the existing harness and certification owners; it does not replace their release gates.


## First source implementation checkpoint

The first runtime candidate adds session-owned no-cost readiness, exact harness
route admission and truthful audit outcomes. The native owner and prepaid
candidate remains separate because its schema and operation contracts need a
new immutable release before API and UI integration.

Review identified an additional paid-release prerequisite: the legacy native
`configure_ai_spend` operation still relies on `ai_agent:write`, which can
include broad organization-owner permissions. The new owner commands expose no
price inputs, but this does not remove the legacy native pricing authority.
Before paid cutover, restrict price and sponsored-funding configuration to its
reviewed trusted operator boundary and prove that owners cannot create cheaper
price snapshots or sponsor their own credits through that legacy operation.
The prepaid foundation is not a claim of paid-production readiness.

## Plan refresh validation — 2026-11-11

- Fast-forwarded local `main` to `origin/main` at `450987d21`; reviewed the
  existing alpha scope, latest setup changes, native commands, provisioning
  preconditions, RAG failure path and stronger authenticated evidence tests.
- `node --test scripts/tests/test-provision-mistral-capabilities.mjs scripts/tests/configure-ai-platform.test.mjs scripts/tests/test_mistral_alpha_preflight.mjs`:
  **31 passed, zero skipped**. These are existing offline baseline checks;
  they do not implement or verify the planned company-scope/model-toggle changes.
- `git diff --check` passed for this documentation update.
- No new production readback, activation, paid request, cited-chat acceptance,
  Rust/frontend build, browser suite or hosted CI was run for this plan refresh.
  The earlier operator inspection remains baseline evidence, not a new result.

## Current-tenant readiness verdict

The consolidated source repair has passing local gateway, provisioning,
frontend and persisted native tests, including ordinary-role authorization and
history preservation. See the
[candidate validation checkpoint](../evidence/alpha-ai-activation-candidate-validation.md)
for commands, limitations, source-version changes and the missing-only rollout.
Source-verified work does not imply a live mutation or close T1/T6/T7 acceptance
on the served release.

Production remains blocked on approved platform authority, writer registration,
reviewed metering, infrastructure catalog and independent current-source
activation. Both vector collections were empty at readback. Immutable contracts
publication, coherent deployment, indexing, fresh cited chat and independent
surface acceptance remain outstanding. No tenant owner promotion, allowance
increase, replacement agent or automatic ERP effect is authorized.

Partially relational
