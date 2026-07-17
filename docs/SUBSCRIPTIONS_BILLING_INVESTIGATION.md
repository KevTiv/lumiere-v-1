# Subscriptions & Billing Investigation — Plans, Usage Rating, Recurring Invoices & Entitlements

Current-state assessment of Lumiere customer subscriptions and billing against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-17  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this investigation unless noted under Validation.

**Verdict (updated after Wave B, 2026-07-17):** Lumiere now has a **pilot billing spine with tax/AR/rev-rec link** — Wave A plus tax compute on recurring invoices, FX snapshot → `recurring_mrr_local`, auto `deferred_revenue_schedule` from matching recognition rules, `pay_subscription_invoice` (post + clear AR), live KPIs from invoices/deferred remaining, and CSV draft-only imports. Against the full quality bar it remains **partial**: usage/rating, proration/amendments, dunning/collections, customer entitlements, and regional payment rails are still **Absent** (Waves C–E). Line-level upgrade flags and plan `auto_close_limit` remain **stubs**. A separate `billing_account` path is **platform SaaS entitlements** (org feature flags), not customer subscription billing.

**Quality benchmark (not a spec):** Oracle NetSuite SuiteBilling / subscription revenue patterns emphasize catalogue + contract lifecycle, recurring invoice generation with tax/AR, contract modifications with proration, revenue recognition schedules tied to billing, dunning/collections, multi-currency, and entitlement-aware service delivery ([NetSuite SuiteBilling](https://www.netsuite.com/portal/products/erp/financials/suitebilling.shtml); [Revenue Recognition](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2788750.html); [Subscription Billing overview](https://www.netsuite.com/portal/resource/articles/accounting/subscription-billing.shtml)). Lumiere is judged on whether it can meet that *depth of control and posting integrity*, not on SuiteApp parity.

**V1 roadmap reconciliation:** `docs/V1_ROADMAP.md` does **not** currently call out a Subscriptions / SuiteBilling wedge. Treat this investigation as the source of truth for subscriptions & billing depth until a roadmap claim is added.

**Compile check:** `cargo check` in `spacetimedb/` — **passed** (2026-07-17).

**Trackers:** [Investigation brief](./plans/subscriptions-billing-investigation-plan.md) · [Gap-fixes plan](./plans/subscriptions-billing-gap-fixes-plan.md)

**Naming note:** SpacetimeDB *live subscriptions* (client SQL) are distinct from the *customer subscription billing* domain. This doc uses “workspace SQL” / “live query keys” for the former and “subscription contract” for the latter.

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/subscriptions` + adjacent)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Plan catalogue | `subscription_plan` | `subscriptions/tables.rs` | Cadence, trial, journal/product, `auto_close_limit`, `payment_mode`; metadata JSON for “pricelist rules / add-ons” — **not structured** |
| Contract header | `subscription` | `subscriptions/tables.rs` | Partner, plan, MRR KPIs, string `state`, `invoice_ids`, `subscription_line_ids`, `payment_token_id` |
| Contract lines | `subscription_line` | `subscriptions/tables.rs` | Price/tax fields; prorate/upgrade/downgrade/parent-child **flags only**; **no line reducers**; **no FE query key** |
| Deferred rev header | `deferred_revenue_schedule` | `subscriptions/tables.rs` | Optional `origin_move_id` / line; not auto-linked from billing run |
| Deferred rev lines | `deferred_revenue_line` | `subscriptions/tables.rs` | Period amounts + posted move refs |
| Rev-rec rules | `revenue_recognition_rule` | `subscriptions/tables.rs` | Product/category criteria; Wave B consulted on invoice create for auto schedules |
| Platform SaaS (adjacent) | `billing_account` | `core/billing.rs` | Org plan tier `free`/`pilot`/`pro` → `organization_settings.feature_flags` — **not** customer billing |
| Accounting (adjacent) | `account_move` / lines, taxes, payments, credit control | `accounting/` | Used by invoice generate, `pay_subscription_invoice`, and `recognize_deferred_revenue` |
| Sales (adjacent) | `sale_order` | `sales/` | Source for `create_subscription_from_sale_order`; lines **not copied** to `subscription_line` |
| Country packs (adjacent) | tax / WHT seeds | `core/country_pack.rs` | Sale/WHT seeds; **no** subscription invoice / index-link / withholding overlays |
| Usage / rating / entitlement / dunning | — | — | **No tables** |

**Lifecycle strings (not enums):**  
`Subscription.state`: documented `"draft" | "active" | "paused" | "close"`; `close_subscription` writes `"closed"` (mismatch). No pause/resume reducers.  
`health`: `"healthy" | "at_risk" | "churned"` — client-supplied / unused by reducers.  
`DeferredRevenueSchedule.state`: `"draft" | "running" | "finished" | "cancelled"` — recognize may set `"finished"`; no cancel reducer.

### 1.2 Backend reducers (callable SpacetimeDB surface)

**Core (`subscriptions/reducers.rs`):**

| Reducer | Behavior | Gap |
|---------|----------|-----|
| `create_subscription_plan` | Validates `billing_period` ∈ `day\|week\|month\|year`, `payment_mode`; inserts plan + audit | No update/delete/set-active despite unused `UpdateSubscriptionPlanParams` |
| `create_subscription_from_sale_order` | Requires SO `Sale`/`Done`; derives partner/company/currency/pricelist from SO; cadence from plan; inserts **header only** | Does **not** create `subscription_line` from SO lines; accepts client `state` / MRR / `subscription_line_ids` / invoice counters; copies `plan.billing_period` (`month`) into `recurring_rule_type` |
| `activate_subscription` | `draft` → `active`, `is_active=true` | Org check; **no company ownership guard**; no first invoice / entitlement grant |
| `close_subscription` | → `state="closed"`, `is_active=false`, `close_date` | No proration, credit, final invoice, or entitlement revoke |
| `generate_subscription_invoice` | If `active`: `invoice_count++`, advance `recurring_next_date` via `calculate_next_date` | **No `AccountMove`**, does not read lines/tax/`invoice_ids`; audit metadata `"accounting_invoice_created": false`. Cadence: `calculate_next_date` accepts only `daily\|weekly\|monthly\|yearly` → **fails** for plan-derived `month`/`day`/… |
| `create_deferred_revenue_schedule` | Inserts schedule + private `generate_recognition_lines` | Fixed period counts (12/4/1); ignores schedule `end_date` span; not auto-tied to subscription invoice |
| `recognize_deferred_revenue` | Posts balanced `AccountMove` (`MoveType::Entry`, Posted): Dr liability / Cr income; marks line recognized; period-open check | Not out-invoice/AR; no tax; not subscription billing run |
| `create_revenue_recognition_rule` / `activate_*` / `deactivate_*` | Rule CRUD + active flag | Never applied by billing/SO paths |

**Defined params without reducers:** `UpdateSubscriptionPlanParams`, `UpdateSubscriptionParams`, `UpdateDeferredRevenueScheduleParams`, `UpdateRevenueRecognitionRuleParams`.

**Imports (`data_ops/subscription_imports.rs`):**  
`import_subscription_plan_csv`, `import_subscription_csv` — bulk insert; subscriptions forced `state="draft"`; no lines.

**Platform (`core/billing.rs`):**  
`create_billing_account`, `update_billing_account`, `set_billing_status` — org SaaS tier/seats; api-server `PATCH /billing/account`; **out of ERP subscriptions BFF**.

**Absent (no reducers/tables):** usage event ingest, idempotent rating, tiered price ladders, bundles, minimum commitment true-up, proration engine, amendment/versioned contract, renewal term, pause/resume, dunning schedule, collections write-off, subscription credit memo, customer entitlement grant/revoke, payment-token charge, deterministic billing-run ledger, index-linked price adjusters.

### 1.3 Frontend contracts (BFF / hooks)

[`SUBSCRIPTIONS_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/subscriptions-http.ts): **12** keys. **0 phantoms** — every key has a SpacetimeDB reducer.

| Surface | Status |
|---------|--------|
| Query hooks | Plans, subscriptions, deferred schedules/lines, recognition rules + all 12 mutators (`hooks/subscriptions.ts`) |
| `useCreateSubscription` | **Alias** of from-sale-order — no `create_subscription` reducer |
| Lines / usage / dunning | **No hooks** |
| Platform `billing_account` | **Not** in subscriptions BFF |
| Contract test | `subscriptions.contract.ts` — compile-only BFF enumeration |
| Tracker phantoms | `track-reducer-coverage.ts` lists `create/update/delete/cancel_subscription`, `update/delete_subscription_plan` — **not in module** |

### 1.4 Live query keys (SpacetimeDB workspace SQL)

`SUBSCRIPTIONS_WORKSPACE_RESOURCE_KEYS` ([`subscriptions-workspace.ts`](../frontend/packages/stdb/src/subscriptions/subscriptions-workspace.ts)):

| Key | In `ERP_ORG_SQL` | Filter / notes |
|-----|------------------|----------------|
| `subscriptions` | Yes | Org-scoped → `subscription` |
| `subscription-plans` | Yes | Org-scoped → `subscription_plan` |
| `deferred-revenue-schedules` | Yes | Org-scoped |
| `deferred-revenue-lines` | Yes | Org-scoped |
| `revenue-recognition-rules` | Yes | Org-scoped |
| `account-moves` / `account-move-lines` | Yes (workspace) | For recognition drill-down |
| `subscription-lines` | **No** | Table exists; no query registry alias |
| Due-to-invoice / failed-payment / at-risk queues | **No** | Client must filter full lists |
| Usage / entitlement / dunning queues | **No** | |

### 1.5 UI operations (`/subscriptions`)

Tabs from `subscriptionsModuleConfig` + [`subscriptions-client.tsx`](../frontend/web/app/(modules)/subscriptions/subscriptions-client.tsx):

| Tab / surface | End-to-end operations | Gaps |
|---------------|----------------------|------|
| Dashboard | KPIs (client-derived Total/Active/MRR/Trials); quick actions | MRR from header fields (client-trusted); no AR aging / deferred remaining |
| Subscriptions | Create from SO, activate, close, generate invoice | Invoice is counter-only; no line editor; no amend/renew/pause; no credit |
| Plans | Create plan | No edit/deactivate UI; no tier/bundle catalogue |
| Deferred schedules | Create schedule | Manual; not spawned from invoice |
| Deferred lines | Recognize line → GL | Working GL path; not linked to recurring invoice |
| Recognition rules | Create / activate / deactivate | Rules unused by engines |
| Legacy form registry | `forms/config/modules/subscriptions.config.ts` | Placeholder fields — **not** wired to ModuleView client |

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain | `platform_smoke.rs` → `test_subscription_plan_create` (plan + journal) | SO→sub, activate/close, invoice, deferred recognize, cadence bug, isolation |
| Contract | `subscriptions.contract.ts` BFF keys | Runtime backend presence |
| Playwright | `phase-6-platform-smoke.spec.ts` — tab sweep + deferred create/recognize actions visible | Activate → invoice → AR → payment → dunning |
| Misnamed | `subscription-smoke.spec.ts` | CRM contact cache — **not** this module |

### 1.7 Seed

`seed.rs` Tier 10: Enterprise Monthly plan; active Acme subscription (MRR 2500) linked to seed SO; one `subscription_line` (“Platform Access”); header `subscription_line_ids` updated. **Not seeded:** deferred schedules, recognition rules, `billing_account`.

---

## 2. Gap matrix (quality bar vs inventory)

Definitions:

- **Present** — usable end to end with operational and/or financial consequences.
- **Partial** — implemented at limited depth, or missing an essential UI, policy, reporting, or integration layer.
- **Absent** — no meaningful implementation.
- **Unsuitable** — surface exists but cannot safely meet the workflow / accounting requirement.

| Capability | State | Evidence | Priority |
|------------|-------|----------|----------|
| Plan create / catalogue template | **Partial** | Create + CSV + UI; no versioning, tiers, bundles, update path | Pilot-critical (minimal catalogue) |
| Contract from confirmed SO | **Partial** | Header from SO; lines not copied; client MRR/state trusted | Pilot-critical |
| Activate / close lifecycle | **Partial** | State flips + audit; close string mismatch; no financial close | Pilot-critical |
| Recurring invoice → AR | **Partial** | Wave A+B: draft AR + tax + FX + pay path; dunning/automation open | Pilot-critical |
| Cadence / next invoice date | **Present** (MVP) | Wave A `normalize_rule_type`; 30-day month approx remains | — |
| Tax on recurring invoice | **Absent** | `tax_ids` on lines unused | Pilot-critical |
| Receivables / payment application | **Absent** (domain) | AR exists elsewhere; not wired from sub invoice | Pilot-critical |
| Deferred revenue schedule | **Partial** | Manual + Wave B auto from recognition rules on invoice; GL reclass of income→deferred still light | Competitive |
| Revenue recognition rules engine | **Unsuitable** | CRUD only; never applied | Competitive |
| Proration | **Partial** | Wave C: mid-period fraction → draft OutInvoice / OutRefund | Competitive |
| Amendments / upgrades / downgrades | **Partial** | Wave C: `amend_subscription` + `subscription_amendment` audit | Competitive |
| Renewals / term management | **Partial** | Wave C: `renew_subscription` interval extend; pause/resume | Competitive |
| Cancellations with credits | **Partial** | Wave C: cancel + optional OutRefund credit note + entitlement hook metadata | Pilot-critical (minimal credit path) |
| Minimum commitments / true-up | **Partial** | Wave D: `subscription_commitment` + invoice true-up | Competitive |
| Tiered pricing / volume ladders | **Partial** | Wave D: progressive `subscription_price_tier` | Competitive |
| Bundles / add-on catalogue | **Partial** | Wave D: `subscription_bundle` + items → lines | Competitive |
| Usage event ingest (streaming) | **Partial** | Wave D: idempotent `subscription_usage_event` | Competitive → Differentiating |
| Idempotent usage rating reducers | **Partial** | Wave D: rate → `subscription_usage_charge` | Competitive |
| Deterministic invoice-generation runs | **Absent** | No billing-run ledger / idempotency key | Pilot-critical |
| Dunning / auto-close on failed invoices | **Partial** | Wave E: collection stage + `auto_close_limit` | Competitive |
| Collections / write-off / credit control link | **Absent** | Credit control elsewhere; unused | Competitive |
| Credits / contract credit memos | **Absent** | Out-refund exists in accounting; not subscription-driven | Competitive |
| Customer entitlement management | **Partial** | Wave E: `subscription_entitlement` grant/suspend/revoke | Differentiating |
| Automated card / token charge | **Partial** | Wave E: payment intents + draft_invoice fallback | Competitive |
| Multi-currency / FX on recurring bill | **Partial** | Wave B FX snapshot on billing_run + `recurring_mrr_local`; index-link adjust still Absent | Competitive |
| Index-linked pricing | **Partial** | Wave E: CPI/IPCA tables + renewal uplift | Differentiating |
| Local payment rails / WHT on AR | **Partial** | Wave E: rail intents + tax settle intents on AR | Competitive |
| Unreliable recurring-card markets | **Partial** | Wave E: `fallback_draft_invoice` on card intents | Competitive |
| Contract modifications ↔ rev schedules | **Partial** | Wave E: `rebase_deferred_schedules_for_subscription` | Competitive |
| Line UI / subscribe | **Partial** | Wave A+ lines tab; Wave D/E ops tabs | Pilot-critical |
| Live exception queues | **Partial** | Wave D/E: rating backlog, due, past-due, amend-pending | Competitive |
| Multi-entity isolation | **Partial** | Org checks common; company guard weak/missing on activate; no isolation tests | Pilot-critical |
| Audit coverage | **Present** (MVP) | Mutators call `write_audit_log_v2` | — |
| Phantom UI contracts | **Present** (cleared for BFF) | 12/12 BFF ⊆ reducers; tracker phantoms remain | — |
| CSV bootstrap | **Present** (MVP) | Imports; no lines; bypasses commercial policy | — |

---

## 3. Required invariants

### Accounting

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Billing run creates posted or draft AR `AccountMove` (OutInvoice) | **No** | `accounting_invoice_created: false` | Single reducer (or billing-run + apply): lines×qty×price, tax, partner, journal; append `invoice_ids`; link deferred schedule when rules match |
| Invoice total = sum(rated lines) ± proration/credits | **No** | Lines unused | Server-side rating from lines + usage charges; reject client totals |
| Tax snapshot on invoice | **No** | `tax_ids` unused | Compute tax from line taxes + country pack; immutable on posted invoice |
| Deferred revenue tied to invoice/contract | **Partial** | Manual schedule; recognize posts Entry | Auto-create schedule from recognition rule on invoice post; origin move ids set |
| Period locks on invoice/recognize | **Partial** | Recognize uses `ensure_accounting_period_open_for_date` | Same gate on AR invoice create/post |
| FX snapshot for foreign-currency contracts | **No** | Currency id + MRR local fields | Immutable rate at invoice date; variance account explicit |
| Credit memo / contract mod netting | **No** | — | Amendment/cancel produces OutRefund or credit lines atomically with contract version |
| AR aging drill-down to subscription | **No** | `invoice_ids` never populated | Invoice → payment → sub contract lineage |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Reducer permissions | Yes (pattern) | `check_permission` on plan/sub/deferred/rule | Keep deny-by-default for rating/billing-run/amend |
| Tenant / company ownership | Partial | Org on most; create-from-SO company aligned to SO; activate lacks company check | Guard every mutator; domain isolation tests |
| Billing-run privilege vs sales create | **No** separation | Same `subscription` write | Split `subscription.bill` / `subscription.amend` permissions |
| Entitlement grant SoD | N/A | Absent | Grant/revoke only via billing state machine, not free-form UI |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Append-only mutation log | Yes (MVP) | `write_audit_log_v2` | Richer billing-run / rating / amend payloads |
| Immutable contract version history | **No** | Header overwrite | Version rows or amendment events (actor, before/after commercial terms) |
| Source-document links | **No** for invoices | `invoice_ids` empty in practice | Sub → invoice move → payment; usage events → charge lines |

### Concurrency / integrity

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Atomic invoice + counters + (optional) deferral | **No** | Counters only | One reducer txn for commercial + AR (+ schedule create) |
| Idempotent billing run | **No** | Retries double-count invoices | `billing_run_key` / period key unique per sub+period; no-op if already invoiced |
| Idempotent usage rating | **No** | No usage table | Unique `(org, source, event_id)` intent; rate once |
| Deterministic invoice generation | **No** | Approximate month=30d | Calendar-aware periods; fixed rating inputs; ordered line application |
| Stale-state rejection | Partial | Active required for invoice; draft for activate | Pause/close reject invoice; version checks on amend |
| Cadence consistency | **Broken** | `month` vs `monthly` | Normalize period vocabulary plan↔contract↔calculator |
| No client multi-step financial commit | Intent violated | UI “Generate invoice” implies AR without server JE | Never advance period without invoice row or explicit dry-run mode |
| Live exception queues | **No** | Full-table only | Bounded SQL: due-to-bill, past-due, rating backlog, amend pending |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). Streaming usage ingest, payment-rail charge, tax-authority e-invoice, and FX providers belong in **procedures/workers**, with reducers applying durable intents idempotently.

---

## 4. Reference workflows

1. **Publish plan / catalogue SKU** — Partial create; versioning/tiers/bundles Absent.
2. **Confirm SO → subscription contract + lines** — Partial header; lines Absent.
3. **Activate (end trial / start billing)** — Partial state; no first invoice/entitlement.
4. **Billing run (deterministic period)** — Unsuitable (counters only; cadence bug).
5. **Taxed AR invoice → open receivable** — Absent in domain (manual SO invoice exists elsewhere).
6. **Payment / automated token charge** — Schema only / Absent.
7. **Dunning → suspend entitlement → auto-close** — Absent (`auto_close_limit` unused).
8. **Usage ingest → idempotent rate → billable charge** — Absent.
9. **Mid-term amendment with proration** — Absent (flags only).
10. **Upgrade/downgrade / bundle change** — Absent.
11. **Renewal / term extension** — Absent.
12. **Cancel with credit / final invoice** — Unsuitable (header close).
13. **Minimum commitment true-up** — Absent.
14. **Tiered / volume pricing** — Absent.
15. **Deferred revenue recognize to P&L** — Present (manual schedule path).
16. **Rule-driven auto-deferral on invoice** — Unsuitable (rules unused).
17. **Contract credit / collections write-off** — Absent.
18. **Customer entitlement grant/revoke** — Absent (platform flags ≠ this).
19. **Multi-currency / index-linked price adjust** — Absent / Partial currency ids.
20. **CSV catalogue bootstrap** — Present (plans/headers).
21. **Live due-to-invoice / past-due queues** — Absent.
22. **Drill-down sub → invoice → payment → rev-rec** — Partial (rev-rec only).

### Acceptance scenarios (≥12)

1. Admin creates active plan with cadence `month`, product, journal, currency, tax-capable product link; audit CREATE; plan appears on live `subscription-plans` key.
2. From confirmed SO, create subscription: server copies SO lines into `subscription_line`, derives MRR from lines (rejects client MRR mismatch), sets `state=draft`, normalizes `recurring_rule_type` to calculator vocabulary.
3. Activate draft → `active`; optional first invoice or trial end date; company B cannot activate company A’s contract.
4. Deterministic billing run for period P with idempotency key K: creates draft/posted `OutInvoice` from lines (+ usage charges), taxes, appends `invoice_ids`, advances `recurring_next_date` once; retry with K is no-op.
5. Cadence advance: monthly/yearly uses calendar rules (not 30-day approx only); plan `month` and contract `monthly` never diverge.
6. Posted invoice opens AR; payment application clears receivable; aging drills to subscription code.
7. Recognition rule matching product creates deferred schedule on invoice post; `recognize_deferred_revenue` posts Entry in open period; remaining deferred rolls down.
8. Mid-term upgrade: amendment version increases price; proration credit/charge for unused/remaining days; invoice or credit memo in same commercial txn; audit before/after.
9. Cancel: final invoice and/or credit per policy; entitlements revoked; state closed; cannot generate further invoices.
10. Usage: stream N events with unique event ids; rating reducer bills quantity×tier once per event; duplicate event id ignored; charges appear on next billing run.
11. Minimum commitment: period usage below commit invoices commit amount; overage uses tier ladder.
12. Bundle: parent plan expands to component lines; cancel parent tears down components atomically.
13. Dunning: after `auto_close_limit` failed payments (or past-due days), health→at_risk, entitlement suspended, then close — with audit events.
14. Credit memo from amendment applies to open AR or creates refund path without orphaning deferred schedules.
15. Multicurrency: foreign contract invoices at FX snapshot; company-currency AR/MRR local consistent; revaluation uses existing FX tools without double-count.
16. Index-linked annual uplift (e.g. CPI/IPCA flag on plan) adjusts unit price on renewal boundary only, with audit.
17. Unreliable card market: `payment_mode=draft_invoice` + local rail intent (EFT/boleto/PayNow) via worker; failure does not corrupt billing period.
18. Withholding on AR (where pack requires): invoice/payment metadata captures WHT; net collection reconciles.
19. Company isolation: company B cannot bill/close/recognize company A (domain + e2e).
20. Period lock blocks invoice post and recognition; open period allows both and appears on P&L / AR drill-down.
21. Exception subscriptions update live: due-today, past-due, rating-backlog, amend-pending — without full-table client scans.
22. Platform `billing_account` changes never mutate customer `subscription` AR (clear product boundary test).

---

## 5. Localization matrix (subscriptions / tax / payment rails / FX)

Country packs today are **tax-seed + company-ID metadata** (`spacetimedb/src/core/country_pack.rs`). Subscriptions need **invoice evidence, withholding on AR, currency/index, and payment-rail overlays** — not only sale-tax seeds. Pack metadata must not be mistaken for live statutory adapters or PSP integrations.

**i18n:** UI ships **English only** (`SupportedLanguage = "en"`). Subscription strings live under module/dashboard configs and `en.json` where present. Country packs are not language packs.

Rates and rules below are **dated requirements as of 2026-07-17**, cited from official sources where linked — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA only in-tree) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|-----------------------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` only | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| VAT/GST on recurring invoice | GST-AU 10%; GST-NZ 15% seeds — **not** sub-wired | VAT-ZA 15% — **not** sub-wired | ICMS/IVA seeds — recurring SaaS often service ISS/IVA rules **outside** reducers | GST/SST/PPN/VAT seeds — **not** sub-wired |
| E-invoicing / tax invoice | ATO/IRD tax invoice rules for B2B — worker validation | Tax invoice for VAT vendors | NF-e / NFS-e (BR), AFIP/ARCA (AR), SII (CL) via **procedures** | IRAS / MyInvois / e-Faktur / BIR / RD — **workers**, not in-reducer HTTP |
| Withholding on AR collections | Rare for domestic SaaS; watch non-resident rules | WHT-ZA seed exists (AP-oriented) — AR path **Absent** | IRRF-BR seed; common on services — need AR payment hook | Varying WHT on services; pack-driven payment metadata |
| Multi-currency / FX | AUD/NZD functional common | ZAR functional | BRL/ARS/CLP; **ARS volatility** → FX snapshot critical on each invoice | SGD hub + MYR/IDR/PHP/THB; invoice-date FX |
| Index-linked pricing | CPI / corporate uplift clauses common | Inflation-linked enterprise deals | IPCA/IGPM-style uplifts (BR); high-inflation AR contracts | Less statutory; corporate CPI clauses |
| Recurring card reliability | Cards common; still need invoice fallback | Cards + EFT; load-shedding ops reality | Cards unreliable vs **boleto/PIX** (BR), transfers (AR/CL) | Cards + **PayNow/FPX/QRIS**/local wallets — invoice-first default for SME |
| Local payment rails (worker) | Direct debit / BECS-style intents | EFT / debit order intents | PIX/boleto/transfer intents | PayNow/FPX/QRIS/PromptPay intents |
| Dunning / collections culture | Formal past-due + credit control | Past-due + manual collections | Aggressive FX + local rail retry | Mix of card retry + e-invoice portals |
| Entitlement suspend on non-pay | Product policy | Same | Same — critical when cards fail | Same |
| Subscriptions pack gap | GST tax on each recurring tax invoice; AUD/NZD FX | VAT tax invoice fields; ZAR | NFS-e/NF-e workers; PIX/boleto; IRRF on settle; index uplift tables | E-invoice workers; multi-rail; SST/GST per line |

### Official sources (dated; verify)

| Region | Authority / reference |
|--------|----------------------|
| Australia GST | [ATO — GST](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst) |
| New Zealand GST | [IRD — GST](https://www.ird.govt.nz/gst) |
| South Africa VAT / WHT | [SARS — VAT](https://www.sars.gov.za/tax-rates/value-added-tax-vat/) |
| Singapore GST | [IRAS — GST](https://www.iras.gov.sg/taxes/goods-services-tax-gst) |
| Malaysia e-Invoice | [LHDN MyInvois](https://www.hasil.gov.my) |
| Indonesia | [DJP / Coretax](https://www.pajak.go.id) |
| Brazil NF-e / NFS-e | [Receita Federal](https://www.gov.br/receitafederal) |
| Thailand VAT | [Revenue Department](https://www.rd.go.th) |
| Philippines VAT | [BIR](https://www.bir.gov.ph) |
| Chile IVA | [SII](https://www.sii.cl) |
| Argentina IVA | [AFIP / ARCA](https://www.afip.gob.ar) |

Neighboring Southern African markets (e.g. Botswana, Namibia, Mozambique) have **no** in-tree packs.

---

## 6. SpacetimeDB architecture decision (Subscriptions & Billing)

Quality benchmark for integrated subscription → AR → revenue recognition: NetSuite SuiteBilling / revenue recognition patterns ([SuiteBilling](https://www.netsuite.com/portal/products/erp/financials/suitebilling.shtml); [Revenue Recognition](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2788750.html)). Architecture constraints from SpacetimeDB: reducers are automatically transactional; procedures are the HTTP boundary ([SpacetimeDB Functions](https://spacetimedb.com/docs/functions/); [Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Subscription semantics](https://spacetimedb.com/docs/subscriptions/semantics)).

| Topic | Decision |
|-------|----------|
| **Atomic billing run** | `generate_subscription_invoice` (or successor `run_subscription_billing`) must create the AR document (`AccountMove` OutInvoice + lines), update `invoice_ids` / counters / next date, optionally spawn deferred schedule, and audit **in one reducer**. Advancing the period without an invoice row is **forbidden** (current behavior = Unsuitable transitional debt). |
| **Determinism** | Billing inputs = contract version + priced lines + rated usage charges for the period + tax table snapshot + FX snapshot. No wall-clock randomness; use `ctx.timestamp` only for audit/as-of. Replace 30-day month approx with explicit period boundaries stored on the billing-run row. |
| **Idempotency** | Unique `billing_run_key` (e.g. `sub_id + period_start`) and usage `event_id`. Pattern: durable intent tables (as in expenses/inventory) — `subscription_billing_intent` / `usage_rating_intent`. |
| **Usage streaming** | Ingest path: client/worker → append-only `usage_event` (or intent) via reducer with idempotent key; **rating reducer** converts events → `usage_charge` rows; billing run consumes unbilled charges. HTTP from meters stays in workers; reducers never call out. |
| **Amendments** | Versioned contract or append-only amendment rows; proration computed server-side; financial credit/charge in same txn as commercial terms change. |
| **Entitlements** | Customer entitlement table keyed by subscription/partner/product feature; grant on activate/paid invoice per policy; revoke on dunning/cancel — **separate** from platform `billing_account` feature flags. |
| **Dunning** | State machine reducers driven by payment failure intents from workers; apply `auto_close_limit`; bounded live queues for past-due. |
| **Live SQL** | Keep org-scoped plans/subscriptions/deferred keys. Add `subscription-lines`, due-to-bill, past-due, rating-backlog. Prefer company-filtered and bounded exception SQL. |
| **Isolation / scale** | Indexes: org, company, partner, state, `recurring_next_date`, billing_run_key, usage event_id. Domain tests: cross-company bill/close forbidden. Index names unique module-wide. |
| **External I/O** | Card charge, PIX/boleto/PayNow, e-invoice submission, FX providers, CPI feeds → **API workers / procedures** with durable intents. Reducers apply results only. |
| **Rev-rec** | Keep `recognize_deferred_revenue` as in-module GL post; wire rules engine to invoice post; never recognize from client-only KPIs. |
| **CSV** | Plans/draft headers OK; production must not invent Posted AR via CSV. |
| **Product boundary** | Document and test: `core/billing.rs` = Lumiere SaaS metering; `subscriptions/` = customer recurring billing. |

---

## 7. Priority classification

Executable checkboxes: [plans/subscriptions-billing-gap-fixes-plan.md](./plans/subscriptions-billing-gap-fixes-plan.md). Status below tracks investigation-time baseline (`Open`); flip to **Done** when the matching wave lands.

### Pilot-critical

| Gap | Status | Notes |
|-----|--------|-------|
| Wire `generate_subscription_invoice` → AR `OutInvoice` + `invoice_ids` | **Done** | Wave A — draft OutInvoice + billing_run ledger |
| Fix cadence vocabulary (`month` ↔ `monthly`) + calendar next-date | **Done** | Wave A — `normalize_rule_type` |
| Copy SO → `subscription_line` + server MRR from lines | **Done** | Wave A |
| Expose `subscription-lines` query key + minimal line UI | **Done** | Wave A — Lines tab |
| Idempotent billing-run key / no double period advance | **Done** | Wave A — `subscription_billing_run` |
| Tax on recurring invoice from line `tax_ids` + packs | **Done** (Wave B) | Wave B |
| Company ownership guards + isolation domain tests | **Done** | Wave A — `run_all_subscriptions_tests` |
| Close/cancel with final invoice or explicit no-charge policy | **Done** | Wave A — `no_charge`; final invoice = generate then close |
| Create must not trust arbitrary client `state` / MRR | **Done** | Wave A — forced draft + server MRR |
| Domain + Playwright: create → activate → bill → AR open | **Done** | Domain suite; UI smoke for lines/gen form |

### Competitive

| Gap | Status | Notes |
|-----|--------|-------|
| Proration + amendment versioning | **Done** (Wave C) | Wave C |
| Renewals / pause-resume | **Done** (Wave C) | Wave C |
| Dunning using `auto_close_limit` + past-due queue | **Done** (Wave E) | Wave E |
| Payment-token / worker charge + draft_invoice fallback | **Done** (Wave E) | Wave E |
| Auto deferred schedule from recognition rules on invoice | **Done** (Wave B) | Wave B |
| Credits / OutRefund from cancel or amend | **Done** (Wave C) | Wave C |
| Multicurrency FX snapshot on each invoice | **Done** (Wave B) | Wave B |
| Tiered pricing + minimum commitment true-up | **Done** (Wave D) | Wave D |
| Bundles / add-ons as structured lines | **Done** (Wave D) | Wave D |
| Bounded live queues (due / past-due / rating backlog) | **Done** (Wave E) | Wave D+E SQL + tabs |
| WHT / e-invoice worker hooks by pack | **Done** (Wave E) | Wave E tax settle intents |

### Differentiating

| Gap | Status | Notes |
|-----|--------|-------|
| Streaming usage ingest + idempotent rating reducers | **Done** (Wave D) | Wave D — worker HTTP still out-of-reducer |
| Customer entitlement graph synced to billing state | **Done** (Wave E) | Wave E — not platform `billing_account` |
| Index-linked pricing (CPI/IPCA) tables | **Done** (Wave E) | Wave E |
| Local payment-rail intents (PIX, PayNow, FPX, QRIS, boleto) | **Done** (Wave E) | Wave E |
| Real-time rating backlog + exception UX | **Done** (Wave E) | Wave D+E |
| Contract modification ↔ rev-rec schedule rebase | **Done** (Wave E) | Wave E |

**Recommended first wave (pilot):** cadence fix → SO→lines + server MRR → AR invoice inside billing run + `billing_run_key` → company guards + lines SQL/UI → isolation + lifecycle tests. Then tax/FX/rev-rec link; then amendments/proration; then usage/tiers; then dunning/entitlements/rails.

---

## 8. Recommended build waves

Tracked in [plans/subscriptions-billing-gap-fixes-plan.md](./plans/subscriptions-billing-gap-fixes-plan.md):

| Wave | Scope |
|------|-------|
| **A — Billing spine** | Cadence fix; SO→lines; AR invoice in `generate_subscription_invoice`; billing_run_key; company guards; lines query/UI; domain+e2e |
| **B — Tax, AR, rev-rec link** | Tax compute; payment apply path; recognition rules applied on invoice; live KPIs from real invoices |
| **C — Amendments & proration** | **Done** — version/amend reducers; upgrade/downgrade; cancel credits; pause/resume; Amendments tab |
| **D — Usage & commitments** | **Done** — usage ingest/rate; tiers; min commit; billing consumes charges; backlog tab |
| **E — Collections & rails** | **Done** — dunning; entitlements; rails/WHT intents; index uplift; exception queues |

---

## 9. Key file paths

```
spacetimedb/src/subscriptions/mod.rs
spacetimedb/src/subscriptions/tables.rs
spacetimedb/src/subscriptions/reducers.rs
spacetimedb/src/subscriptions/billing_helpers.rs
spacetimedb/src/subscriptions/subscription_wave_c.rs   # amendments / pause / renew / cancel
spacetimedb/src/subscriptions/subscription_wave_d.rs   # usage / tiers / commit / bundles
spacetimedb/src/subscriptions/subscription_wave_e.rs   # dunning / entitlements / rails / index
spacetimedb/tests/subscriptions/wave_c_test.rs
spacetimedb/tests/subscriptions/wave_d_test.rs
spacetimedb/tests/subscriptions/wave_e_test.rs
spacetimedb/src/data_ops/subscription_imports.rs
spacetimedb/src/core/billing.rs
spacetimedb/src/core/country_pack.rs
spacetimedb/src/accounting/journal_entries.rs          # create_invoice_from_sale_order / post_invoice (adjacent)
spacetimedb/src/seed.rs                                # Tier 10
spacetimedb/tests/platform/platform_smoke.rs

frontend/packages/stdb/src/commands/subscriptions-http.ts
frontend/packages/stdb/src/subscriptions/subscriptions-workspace.ts
frontend/packages/stdb/src/queries/erp-subscriptions.ts
frontend/packages/stdb/src/contract-tests/subscriptions.contract.ts
frontend/packages/query-hooks/src/hooks/subscriptions.ts
frontend/packages/ui/src/lib/subscriptions-form-configs.ts
frontend/packages/ui/src/lib/subscriptions-entity-configs.ts
frontend/web/app/(modules)/subscriptions/subscriptions-client.tsx
frontend/web/lib/subscriptions-create-params.ts
frontend/web/lib/subscriptions-revenue-params.ts
frontend/web/tests/e2e/phase-6-platform-smoke.spec.ts
api-server/src/routes/billing.rs                       # platform SaaS account
```

---

## Validation

| Check | Result |
|-------|--------|
| Tables/reducers vs `spacetimedb/src/subscriptions/*` | Verified 2026-07-17 |
| Imports vs `data_ops/subscription_imports.rs` | Verified |
| Platform billing vs `core/billing.rs` | Verified — separate surface |
| BFF keys vs reducers | 12 keys, 0 phantoms |
| Workspace keys vs `ERP_ORG_SQL` | plans/subs/deferred/rules wired; **no** `subscription-lines` |
| `cargo check` (`spacetimedb/`) | **Passed** 2026-07-17 |
| Domain/E2E suites executed in this investigation | Wave A adds `run_all_subscriptions_tests` (publish + call to prove); Playwright smoke exists |
| Acceptance scenarios | 22 listed (≥10 required) |
| Every gap has state + priority | Yes (§2 / §7) |

---

## Bottom line

Wave A closed the **AR draft spine** (SO→lines, cadence normalize, idempotent billing runs → draft OutInvoice). The domain is no longer finance-hollow at the header level, but remains **partial** vs NetSuite-class SuiteBilling until tax, posted AR/payment, amendments/proration, usage rating, and dunning land (Waves B–E). Platform `billing_account` must stay a separate concern.

### Related docs

- [Accounting NetSuite gap](./ACCOUNTING_NETSUITE_GAP.md) — AR/posting/deferred rev-rec adjacency; collections still Absent there
- [Sales & Order Management investigation](./SALES_ORDER_MANAGEMENT_INVESTIGATION.md) — SO confirm → subscription source
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — no Subscriptions wedge claim at investigation time
- Investigation brief: [subscriptions-billing-investigation-plan.md](./plans/subscriptions-billing-investigation-plan.md)
- Gap-fixes tracker: [subscriptions-billing-gap-fixes-plan.md](./plans/subscriptions-billing-gap-fixes-plan.md)
- Module: `spacetimedb/src/subscriptions/`
- Workspace: `frontend/packages/stdb/src/subscriptions/subscriptions-workspace.ts`
- UI: `frontend/web/app/(modules)/subscriptions/subscriptions-client.tsx`
- E2E smoke: `frontend/web/tests/e2e/phase-6-platform-smoke.spec.ts`
