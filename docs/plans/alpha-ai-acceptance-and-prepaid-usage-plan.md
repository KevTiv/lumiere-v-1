# Alpha AI acceptance and prepaid usage plan

Status: planned. Updated 2026-11-01. No runtime or payment change is made by this plan.

Complete the owner's non-OCR AI workflow, then add prepaid usage with manual top-ups. Keep one shared monthly limit for Mugisha Farm and Farm UI acceptance. Extend the existing reservation and settlement system so funding and usage have one canonical owner.

## Decisions and release scope

- The user selected **USD 10 total per UTC calendar month**, shared by both companies in the same organization. This replaces the earlier separate caps.
- The user selected **prepaid credits with manual top-ups**. Automatic charging and postpaid invoices are outside this plan.
- Funding and the monthly limit are separate. A top-up adds credit; it does not raise the limit or grant AI capabilities.
- Keep the existing signed-in owner. Do not create another platform administrator or wildcard grant.
- Defer OCR and vision. Paid indexing, embeddings, RAG and external research need separate admission and cost coverage. The text workflows below do not depend on them.
- AI changes remain proposals or drafts. Existing approval rules govern accounting posting and other consequential actions.
- Preserve farm records, unresolved source facts, filenames, hashes and request identities. Use one writer for live UI acceptance.

There are three release results: owner core acceptance, the declared non-OCR skill set, and prepaid payment acceptance. Passing one does not imply that the others passed.

## Recorded live baseline

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

**Gate A:** owner core acceptance on Railway, with OCR/document AI outside scope.
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
