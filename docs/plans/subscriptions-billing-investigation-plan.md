# Subscriptions and Billing Investigation

## Summary

Create `docs/SUBSCRIPTIONS_BILLING_INVESTIGATION.md` as a clean, source-traced current-state assessment dated 2026-07-17. Treat NetSuite SuiteBilling / revenue recognition only as a quality benchmark (integrated ops/finance, multi-entity, drill-down, workflow controls, i18n, extensibility, lifecycle, integrations) — not a feature-copy checklist. Reconcile V1 roadmap silence on subscriptions against Phase 9 schema/UI presence. Keep platform `billing_account` (Lumiere SaaS entitlements) explicitly out of the customer-billing quality bar.

This investigation brief is documentation-only for the report itself. Implementation follows [subscriptions-billing-gap-fixes-plan.md](./subscriptions-billing-gap-fixes-plan.md).

## Investigation and report changes

- Build an evidence-linked inventory from current source:
  - All `spacetimedb/src/subscriptions/` tables plus adjacent accounting AR, sales SO, country packs, and `core/billing.rs`.
  - Every actual backend reducer, separated from unused `Update*Params`, tracker phantoms, and platform billing reducers.
  - Subscriptions workspace resources, `ERP_ORG_SQL` presence, absence of `subscription-lines` and exception queues.
  - UI tabs and operations vs finance-hollow invoice path.
  - Rust domain tests, contract tests, and Playwright — existence vs executed proof; note misnamed `subscription-smoke.spec.ts`.

- Gap matrix using strict definitions (`Present` / `Partial` / `Absent` / `Unsuitable`) covering:
  - Plan/catalogue, usage rating, proration, amendments, renewals, cancellations, minimum commitments, tiered pricing, bundles, dunning, collections, credits, entitlements.
  - Integration with revenue schedules, tax, receivables, contract modifications.
  - Classify `generate_subscription_invoice` as **Unsuitable** for AR (counters only; `accounting_invoice_created: false`).
  - Classify cadence `month` vs `monthly` as a pilot-critical correctness defect.

- Document required invariants (currently enforced / evidence / remaining) for accounting, authorization, audit, and concurrency — including idempotent billing runs and streaming usage rating.

- Reference workflows and ≥10 acceptance scenarios (target ≥20) covering SO→lines→activate→bill→AR→amend→usage→dunning→entitlement→isolation.

- Localization matrix for Oceania, Southern Africa (ZA), Brazil/Southern Cone, Maritime SEA — multi-currency, index-linked pricing, local payment rails, withholding, unreliable recurring-card markets. English-only UI. Dated official sources; not legal advice.

- SpacetimeDB architecture decision: transactional billing run + AR (+ optional deferral); streaming usage via idempotent rating reducers; company + bounded exception SQL; payment-rail / e-invoice / CPI HTTP behind workers/procedures; clear platform vs customer billing boundary.

- Priority every gap as `pilot-critical`, `competitive`, or `differentiating`.

## Validation

- Cross-check every inventory entry against backend declarations, BFF keys, workspace SQL, and test names.
- Run `cargo check` in `spacetimedb/` and report status.
- Ensure every requested report section exists; ≥10 acceptance scenarios; every gap has one state and one priority.
- Cite NetSuite and SpacetimeDB docs for benchmark/architecture; official sources for localization.

## Status

- [x] Investigation document written — [../SUBSCRIPTIONS_BILLING_INVESTIGATION.md](../SUBSCRIPTIONS_BILLING_INVESTIGATION.md)
- [x] Gap-fixes tracker created — [subscriptions-billing-gap-fixes-plan.md](./subscriptions-billing-gap-fixes-plan.md)
- [x] `cargo check` (`spacetimedb/`) passed 2026-07-17

## Assumptions

- No prior dedicated subscriptions/billing investigation document existed.
- Git history is the changelog; the document is a current snapshot.
- Platform SaaS `billing_account` remains a separate product surface from customer SuiteBilling-class workflows.
