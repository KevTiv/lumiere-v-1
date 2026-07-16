# Refresh the Sales and Order Management Investigation

## Summary

Rewrite `docs/SALES_ORDER_MANAGEMENT_INVESTIGATION.md` as a clean, internally consistent current-state assessment dated 2026-07-16. Treat NetSuite only as a quality benchmark and remove obsolete strike-through history and contradictory “absent/done” claims.

This is documentation-only: no tables, reducers, APIs, generated bindings, or UI code will change.

## Investigation and report changes

- Build an evidence-linked inventory from current source:
  - All sales tables and adjacent inventory, purchasing, accounting, workflow, audit, queue, and country-pack tables.
  - Every actual backend reducer, separated from frontend-only command declarations. Explicitly flag hooks for missing reducers such as line update/delete and order lock/unlock.
  - Sales workspace resources, SQL builders, organization/company filters, invalidation mappings, and the raw subscriptions used to derive exception queues.
  - UI tabs and operations, distinguishing end-to-end operations from backend-only, UI-only, or untested surfaces.
  - Rust domain tests, contract/unit tests, and Playwright workflows, distinguishing test existence from an executed passing result.

- Replace the gap matrix using strict definitions:
  - `Present`: usable end to end with operational, inventory, and financial consequences.
  - `Partial`: implemented at limited depth or missing an essential UI, policy, reporting, or integration layer.
  - `Absent`: no meaningful implementation.
  - `Unsuitable`: implementation exists but cannot safely meet the workflow or accounting requirement.
  - Assess quote lifecycle, CPQ, contracts, credit, approvals, pricing, promotions, allocation, split fulfilment, dropship, backorders, cancellation, exchanges, returns, commissions, multichannel routing, currencies, tax, Incoterms, cross-border documents, reporting, lifecycle controls, and integrations.
  - Reclassify backend-only CPQ/promotions/exchanges and incomplete dropship or commission workflows as partial where appropriate, rather than equating reducer presence with full capability.

- Document required invariants with columns for “currently enforced,” “evidence,” and “remaining requirement”:
  - Accounting: immutable FX/tax snapshots, invoice/delivery policy, AR exposure, returns and credit notes, COGS/inventory valuation, commission accrual/clawback, period locks, and cancellation compensation.
  - Authorization: tenant/company ownership, reducer permissions, field controls, approval segregation of duties, and restricted cross-entity access.
  - Audit: append-only lifecycle evidence, actor/reason capture, approval history, external references, and traceable source-document links.
  - Concurrency: atomic reservation and commitment, stale-state rejection, ATP rollback, partial fulfilment/backorders, cancellation/unreserve, idempotent external events, and no client-orchestrated multi-step commitments.

- Add reference workflows and acceptance scenarios covering:
  1. Draft quote creation and pricing.
  2. Send, expiry, acceptance, and confirmation.
  3. Approval and rejection with segregation of duties.
  4. Credit hold and exposure limits.
  5. Atomic reservation and ATP rollback.
  6. Partial shipment and backorder creation.
  7. Multi-location or multi-address split fulfilment.
  8. Dropship PO and fulfilment linkage.
  9. Pre-fulfilment cancellation and reservation release.
  10. Post-invoice cancellation requiring financial reversal.
  11. RMA receipt and credit note.
  12. Exchange and over-return prevention.
  13. Commission accrual, settlement, and clawback.
  14. Pricelist and promotion eligibility/stacking.
  15. Multi-currency FX snapshot and drill-down.
  16. Tax-inclusive/exclusive pricing and fiscal remapping.
  17. Cross-company isolation.
  18. Live exception queues and document drill-down.
  19. Cross-border document submission with retry and idempotency.

- Rebuild the localization matrix for:
  - Oceania: Australia and New Zealand.
  - Southern Africa: South Africa as the only current in-tree pack, with neighboring-market coverage explicitly absent.
  - Brazil/Southern Cone: Brazil, Argentina, and Chile.
  - Maritime Southeast Asia: Singapore, Malaysia, Indonesia, Philippines, and Thailand.
  - Compare currencies, tax display, seeded tax rules, e-invoicing/fiscal documents, payment terms, Incoterms, identifiers, current pack support, and required adapter boundaries. Cite current official tax-authority sources and label volatile rules as dated requirements rather than legal advice.
  - Record that the UI currently ships only an English locale and that country packs do not constitute full language localization.

- Replace the SpacetimeDB architecture section with a decision record:
  - Keep order confirmation, commitment, reservation, stock moves, dropship obligations, cancellation, and return receipt mutations in single reducers where atomicity is required.
  - Use state preconditions and idempotency keys for concurrent or repeated commands.
  - Use company-filtered subscriptions and bounded exception subscriptions; avoid replicating complete high-volume tables solely for client-side queue derivation.
  - Index tenant, company, state, partner, order, picking, and commitment lookup paths used by reducers and subscriptions.
  - Put carrier, tax-authority, payment, marketplace, and document-provider HTTP calls behind API workers/procedures using the existing queue pattern; reducers create durable intents and record results atomically.
  - Describe current statutory adapters as stubs, not reliable integrations.

- Assign every remaining gap one priority:
  - `Pilot-critical`: correctness, authorization, auditability, broken UI/backend contracts, atomic inventory/financial consequences, and isolation tests.
  - `Competitive`: contracts, quote acceptance, allocation depth, multi-route fulfilment, dropship lifecycle, pricing/promotion depth, reporting, and cross-border documents.
  - `Differentiating`: advanced CPQ, configurable commission plans/splits, SLA automation, omnichannel optimization, and integration observability.

## Validation

- Cross-check every inventory entry against backend declarations, frontend command/hook usage, subscription SQL, and test names.
- Run the SpacetimeDB module compile check and frontend typecheck; report failures without claiming unrelated failures were introduced by this documentation change.
- Run targeted repository searches to ensure:
  - Every requested report section exists.
  - At least ten acceptance scenarios are present.
  - Every gap has one allowed state and one priority.
  - Obsolete struck-through findings and the broken multi-entity documentation link are removed.
- Cite Oracle NetSuite and SpacetimeDB official documentation for benchmark and architectural claims, and official governmental sources for localization facts.

## Assumptions

- The existing investigation is replaced in place rather than creating a second report.
- Git history is the changelog; the refreshed document represents only the current snapshot.
- “Verified” means source-traced, with executed checks clearly distinguished from tests that merely exist.
- Findings may recommend later implementation work, but this task does not implement those recommendations or alter public interfaces.
