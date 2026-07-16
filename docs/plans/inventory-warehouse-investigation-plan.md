# Inventory and Warehouse Management Investigation

## Summary

Create `docs/INVENTORY_WAREHOUSE_MANAGEMENT_INVESTIGATION.md` as a clean, source-traced current-state assessment dated 2026-07-16. Treat NetSuite only as a quality benchmark (integrated ops/finance, multi-entity, drill-down, workflow controls, i18n, extensibility, lifecycle, integrations) — not a feature-copy checklist. Reconcile V1 roadmap “lot/serial/cycle/replenishment shipped” claims against depth of enforcement and UI/BFF contract truth. Reconcile purchasing investigation notes that claimed `receive_po_line` is qty-only against current stock-posting path.

This is documentation-only: no tables, reducers, APIs, generated bindings, or UI code will change.

## Investigation and report changes

- Build an evidence-linked inventory from current source:
  - All inventory tables and adjacent UoM, purchasing landed costs, sales ATP reservation, accounting COGS/valuation helpers, country packs.
  - Every actual backend reducer, separated from frontend-only BFF command declarations (explicitly list ~20 phantom keys).
  - Inventory workspace resources, `ERP_ORG_SQL` presence, org vs company filters, absence of exception queues.
  - UI tabs and operations, distinguishing end-to-end ops from display-only, phantom, or untested surfaces.
  - Rust domain tests, contract tests, and Playwright workflows — existence vs executed proof.

- Gap matrix using strict definitions:
  - `Present`: usable end to end with operational and/or financial stock consequences.
  - `Partial`: limited depth or missing UI/policy/reporting/integration layer.
  - `Absent`: no meaningful implementation.
  - `Unsuitable`: surface exists but cannot safely meet the workflow requirement.
  - Cover item masters, variants, UoM, bins, lots, serials, expiry, quality, transfers, reservations, ATP, safety stock, replenishment, cycle counting, landed cost, costing methods, directed putaway/picking, waves, packing, cartonization, consignment, quarantine, cross-docking, 3PL, inventory-close reconciliation.
  - Classify `execute_replenishment_rule` as Unsuitable for ops (timestamp-only). Classify wave process/delete and warehouse-task lifecycle phantoms as Unsuitable.

- Document required invariants (currently enforced / evidence / remaining):
  - Accounting: quant value, COGS costing methods, landed costs, period locks, inventory close.
  - Authorization: tenant/company ownership, reducer permissions, field controls.
  - Audit: append-only lifecycle evidence on stock mutators.
  - Concurrency: reservation correctness, atomic picking validate, hot-item contention, no client multi-step stock commits.

- Reference workflows and at least ten acceptance scenarios covering receipt→quant, SO ATP fail-closed, cycle-count post, reservation contention, backorder residual, phantom UI failures, company isolation, remote/intermittent ops expectations, FEFO/lot enforcement targets, replenishment demand creation targets.

- Localization matrix for Oceania, Southern Africa (ZA), Brazil/Southern Cone, Maritime SEA — packs, mixed metric/local units, remote warehouses, long import lead times, seasonal agriculture, intermittent connectivity. English-only UI. Dated official sources; not legal advice.

- SpacetimeDB architecture decision: transactional reserve/validate/receive; company + bounded subscriptions; hot-quant indexes; 3PL/customs HTTP behind procedures/workers; prove reservation correctness and subscription scale.

- Priority every gap as `pilot-critical`, `competitive`, or `differentiating`.

## Validation

- Cross-check every inventory entry against backend declarations, BFF keys, subscription SQL, and test names.
- Run `cargo check` in `spacetimedb/` and report status.
- Ensure every requested report section exists; ≥10 acceptance scenarios; every gap has one state and one priority.
- Cite NetSuite and SpacetimeDB docs for benchmark/architecture; official sources for localization.

## Assumptions

- No prior dedicated inventory/WMS investigation document existed (only `MULTI_ENTITY_PLATFORM_INVENTORY.md`).
- Git history is the changelog; the document is a current snapshot.
- “Verified” means source-traced; executed checks are clearly distinguished from tests that merely exist.
- Findings may recommend later implementation; this task does not implement them.
