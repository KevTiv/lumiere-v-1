# Subscriptions & Billing Gap Fixes — Tracker

Executable tracker for the full backlog (Pilot → Competitive → Differentiating). Source investigation: [../SUBSCRIPTIONS_BILLING_INVESTIGATION.md](../SUBSCRIPTIONS_BILLING_INVESTIGATION.md). Investigation brief: [subscriptions-billing-investigation-plan.md](./subscriptions-billing-investigation-plan.md).

**Product boundary:** Customer recurring billing lives in `spacetimedb/src/subscriptions/`. Platform SaaS org metering (`billing_account` / `core/billing.rs`) is **out of scope** unless a task explicitly bridges entitlements.

## Wave A — Pilot billing spine

- [x] Normalize cadence vocabulary (`day|week|month|year` ↔ `daily|weekly|monthly|yearly`) end-to-end; calendar-aware `calculate_next_date` (or store period boundaries on billing-run rows)
- [x] `create_subscription_from_sale_order` copies SO lines → `subscription_line`; server-computes MRR; reject client MRR / line-id spoofing
- [x] Harden create: force `state=draft` (or explicit activate); company ownership guards on activate/close/invoice
- [x] `generate_subscription_invoice` creates AR `OutInvoice` (+ lines from contract lines), appends `invoice_ids`, sets audit `accounting_invoice_created: true` **in one reducer**
- [x] Idempotent `billing_run_key` (e.g. subscription + period); retry is no-op (`subscription_billing_run`)
- [x] Wire `subscription-lines` into query registry + `ERP_ORG_SQL` + workspace keys + minimal line UI
- [x] Close path: explicit `no_charge` when active with zero invoices; state string `closed`
- [x] Domain suite `run_all_subscriptions_tests` + Playwright `subscriptions-wave-lifecycle.spec.ts` / phase-6 lines tab
- [x] Remove / fix tracker phantoms in `track-reducer-coverage.ts`

## Wave B — Tax, AR, rev-rec link

- [x] Tax compute on recurring invoice from line `tax_ids` + country pack
- [x] Payment application path from subscription invoice → clear AR (reuse accounting payments)
- [x] Apply `revenue_recognition_rule` on invoice create → auto `deferred_revenue_schedule` with origin move ids
- [x] FX snapshot at invoice date; `recurring_mrr_local` derived server-side
- [x] Live KPIs from real invoices / deferred remaining (not client-trusted header MRR alone)
- [x] Period-open gate on AR invoice create/post (same as recognize)
- [x] CSV: plans + draft headers only; no silent Posted AR via import
- [x] Publish + `run_all_subscriptions_tests` on Maincloud (`lumiere-v1-j1uo0`, 2026-08-15)
- [ ] Playwright smoke for tax invoice + pay path (optional follow-up)

## Wave C — Amendments & proration

- [x] Contract version / amendment reducers (upgrade, downgrade, quantity, price)
- [x] Proration engine using line flags + period boundaries; credit/charge in same txn as amend
- [x] Pause / resume lifecycle with invoice eligibility guards
- [x] Renewals / term extension
- [x] Cancel → OutRefund or credit memo + entitlement revoke hook point
- [x] Plan update/deactivate reducers (unused `UpdateSubscriptionPlanParams` today)
- [x] Amendment audit (before/after commercial terms)
- [x] Publish + `run_all_subscriptions_tests` on Maincloud (`lumiere-v1-j1uo0`, 2026-08-15)

## Wave D — Usage, tiers, commitments

- [x] `usage_event` (or intent) ingest with unique `(org, source, event_id)`
- [x] Idempotent rating reducer → `usage_charge` rows
- [x] Billing run consumes unbilled charges
- [x] Tiered / volume price ladders on plan or product
- [x] Minimum commitment true-up
- [x] Structured bundles / add-ons (replace metadata-JSON-only)
- [x] Rating-backlog bounded SQL + Ops surface
- [x] Publish + `run_all_subscriptions_tests` on Maincloud (`lumiere-v1-j1uo0`, 2026-08-15)

## Wave E — Collections, entitlements, regional rails

- [x] Dunning state machine using `auto_close_limit` + past-due days
- [x] Customer entitlement grant/revoke synced to activate / paid / dunning / cancel (**not** platform `billing_account`)
- [x] Payment-token charge intents via worker; `draft_invoice` fallback for unreliable card markets
- [x] Local rail intents (PIX, boleto, PayNow, FPX, QRIS, EFT) as durable integration intents
- [x] Pack-driven WHT / e-invoice workers on AR settle
- [x] Index-linked pricing tables (CPI/IPCA) on renewal boundary
- [x] Bounded exception SQL: due-to-bill, past-due, rating-backlog, amend-pending
- [x] Contract mod ↔ rev-rec schedule rebase
- [x] Domain suite wave E + Playwright collections/entitlement smoke (phase-6 tabs)
- [x] Publish + `run_all_subscriptions_tests` on Maincloud (`lumiere-v1-j1uo0`, 2026-08-15)

## Ops checklist (after each wave that touches schema)

1. [x] `make generate-stdb-ts-sdk` and `make generate-stdb-rust-sdk` + `make codegen` (Wave A)
2. [ ] Publish module (`spacetime publish lumiere-v1-j1uo0 --server local --clear-database -y`) — local server was down at Wave A land
3. [ ] `spacetime call lumiere-v1-j1uo0 run_all_subscriptions_tests --server local`
4. [ ] Playwright: `subscriptions-wave-lifecycle.spec.ts` + phase-6 platform smoke
5. [x] Update investigation §7 priority tables for Wave A Done

## Notes

- Reuse accounting helpers: `create_invoice_from_sale_order` / `post_invoice` patterns in `journal_entries.rs`; do not invent a second AR model.
- Reuse durable-intent patterns from expenses/inventory for billing-run and usage rating idempotency.
- Keep `/billing/account` (api-server) as Lumiere SaaS metering; document the boundary in UI copy if both surfaces are visible to operators.
