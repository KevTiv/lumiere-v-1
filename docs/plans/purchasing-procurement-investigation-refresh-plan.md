# Refresh the Purchasing and Procurement Investigation

## Summary

Create `docs/PURCHASING_PROCUREMENT_INVESTIGATION.md` as a clean, internally consistent current-state assessment dated 2026-07-16. Treat NetSuite only as a quality benchmark. Reconcile contradictory V1 roadmap claims about three-way match against source.

This is documentation-only: no tables, reducers, APIs, generated bindings, or UI code will change.

## Investigation and report changes

- Build an evidence-linked inventory from current source:
  - All purchasing tables and adjacent inventory, accounting, workflow, audit, sales-dropship, country-pack, and budget tables.
  - Every actual backend reducer, separated from frontend-only command declarations. Explicitly place `create_bill_from_purchase_order` and CSV imports in their owning modules.
  - Purchasing workspace resources, SQL builders, organization/company filters, and whether exception queues exist.
  - UI tabs and operations, distinguishing end-to-end operations from backend-only, UI-only, or untested surfaces.
  - Rust domain tests, contract/unit tests, and Playwright workflows, distinguishing test existence from an executed passing result.

- Replace the gap matrix using strict definitions:
  - `Present`: usable end to end with operational, inventory, and financial consequences.
  - `Partial`: implemented at limited depth or missing an essential UI, policy, reporting, or integration layer.
  - `Absent`: no meaningful implementation.
  - `Unsuitable`: implementation exists but cannot safely meet the workflow or accounting requirement.
  - Assess requisition → source/RFQ/tender → PO → receipt → bill → payment, plus blanket/contracts/budgets, vendor approvals/delegation, tolerances/3-way match, scorecards/lead-time/risk, partial exceptions, consignment/dropship/returns, and geography overlays.
  - Classify `receive_po_line` carefully: qty-on-PO without stock quant movement is Partial/Unsuitable for “atomic receipt,” not Present for inventory receipt.

- Document required invariants with columns for “currently enforced,” “evidence,” and “remaining requirement”:
  - Accounting: commitments, FX/tax snapshots, three-way match, AP exposure, landed costs, period locks, purchase returns.
  - Authorization: tenant/company ownership, reducer permissions, field controls, approval segregation of duties, delegation.
  - Audit: append-only lifecycle evidence, actor/reason capture, durable approval histories, source-document links.
  - Concurrency: atomic receipt and commitment updates, stale-state rejection, idempotent bill post, no client-orchestrated multi-step commitments.

- Add reference workflows and acceptance scenarios covering:
  1. Requisition create → submit → approve.
  2. RFQ / multi-vendor tender compare (or Absent path).
  3. Draft PO + lines + send / confirm with approval gate.
  4. Lock / unlock PO.
  5. Receipt (qty and stock paths).
  6. Partial receipt and bill.
  7. Three-way match block on over-bill.
  8. Payment against vendor bill.
  9. Supplier intake SoD.
  10. Landed cost allocate / post.
  11. Dropship SO → draft PO.
  12. Purchase return.
  13. Cross-company isolation.
  14. Live spend / exception queues.
  15. Cross-border WHT / duties / vendor IDs.
  16. Tolerance edge cases.
  17. Budget / commitment (or Absent/Partial path).
  18. Blanket / contract (or Absent path).

- Rebuild the localization matrix for:
  - Oceania: Australia and New Zealand.
  - Southern Africa: South Africa as the only current in-tree pack.
  - Brazil/Southern Cone: Brazil, Argentina, and Chile.
  - Maritime Southeast Asia: Singapore, Malaysia, Indonesia, Philippines, and Thailand.
  - Compare withholding, import duties, local vendor identifiers, cross-border procurement, and commodity-price volatility. Cite current official sources and label volatile rules as dated requirements rather than legal advice.
  - Record that the UI currently ships only an English locale.

- Replace the SpacetimeDB architecture section with a decision record:
  - Keep receipt + commitment + bill-match guards in single reducers where atomicity is required.
  - Prefer creating IN pickings / quant moves atomically with receipt commitment (or document why qty-only receive is intentional).
  - Use company-filtered subscriptions and bounded spend/exception subscriptions.
  - Put customs, tax-authority, and payment-provider HTTP behind API workers/procedures with durable intents.
  - Describe current statutory adapters as stubs.

- Assign every remaining gap one priority:
  - `Pilot-critical`: correctness, authorization, auditability, atomic inventory/financial consequences, isolation tests, broken receipt/stock contracts.
  - `Competitive`: RFQ/tender, blanket/contracts, returns, budgets/commitments, scorecards, exception queues, dropship purchasing UX.
  - `Differentiating`: supplier risk analytics, commodity hedging overlays, advanced delegation, integration observability for cross-border docs.

## Validation

- Cross-check every inventory entry against backend declarations, frontend command/hook usage, subscription SQL, and test names.
- Run the SpacetimeDB module compile check and report status without claiming unrelated failures were introduced by this documentation change.
- Ensure:
  - Every requested report section exists.
  - At least fifteen acceptance scenarios are present.
  - Every gap has one allowed state and one priority.
  - V1 roadmap three-way match contradiction is explicitly reconciled.
- Cite Oracle NetSuite and SpacetimeDB official documentation for benchmark and architectural claims, and official governmental sources for localization facts.

## Assumptions

- This is a new investigation document (none existed for purchasing).
- Git history is the changelog; the document represents only the current snapshot.
- “Verified” means source-traced, with executed checks clearly distinguished from tests that merely exist.
- Findings may recommend later implementation work, but this task does not implement those recommendations or alter public interfaces.
