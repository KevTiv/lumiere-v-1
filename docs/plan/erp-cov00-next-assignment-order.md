# COV-00 next assignment order

After review of the census and source-level defect pass, use this dependency order rather than starting broad module rewrites:

```text
COV-00A operation census ───────────────┐
COV-00B exposure manifest ──────────────┼─> COV-00 acceptance
COV-00C correctness defect ownership ───┤
COV-00D D/A/O/E evidence calibration ───┘

                         ┌─> COV-01a transport/correlation receipt
COH-02/10 typed outcomes ┼─> COV-01b exact effect readback
                         ├─> COV-01c UI semantic outcomes/navigation
                         └─> COV-01d certification helper cleanup/replay proof

UX-07 false-success/forms ──────────────> affected COV module adoption
UX-08 reporting truthfulness ───────────> COV-20 + COV-26
COV-00C allow-empty/degraded-read map ──> COV-26 shared resource states

COV-00 acceptance ─────────────────────> COV-02 first-org seed/personas

then parallel module lanes:
A CRM → Sales
B Purchasing → Inventory → Manufacturing
C Accounting → Expenses / Subscriptions / POS
D HR / Projects / Helpdesk / Fleet / IoT
E Documents / Calendar / Messages / Reports / Approvals / Imports / Settings
```

## Immediate bounded assignments

### COV-00A

Refresh the operation denominator and dispositions. Do not create UI merely to increase reachability counts.

### COV-00B

Create the one first-org exposure denominator and settle `/map` versus dedicated Fleet ownership.

### COV-00C

Audit and assign the current correctness defect classes recorded in `erp-cov00-correctness-evidence-defect-register.md`:

- false success after missing/failed action;
- newest/latest/heuristic effect correlation;
- denied/unavailable/error collapsed to legitimate empty data;
- degraded runtime-form/config fallback that still permits mutation;
- analytics/filter/time/measure/source-state truthfulness;
- semantic overclaim between transport acceptance, observed convergence and authoritative effect disposition.

Return owners and downstream package IDs; do not mass-fix runtime code inside the census task.

### COV-00D

Build the module primary-lifecycle proof grid with four independent columns:

```text
D domain invariant
A authenticated API/generated operation
O actual operator/UI transition
E exact effect identity + replay/lost-response recovery
```

Known browser suites using direct BFF lifecycle transitions must be classified accurately, not discarded. Setup/fixture calls are acceptable; the exact transition claimed as operator proof must be user-driven.

### COV-02A

Current disposition: `ACCEPTED`; the inventory baseline has been consumed by COV-02B. The six classified fixture authorities, seven required personas, and all COV-03..24 module gaps are recorded in [`erp-cov02a-seed-persona-inventory-status.md`](./erp-cov02a-seed-persona-inventory-status.md). This inventory does not promote the dev demo seed into product-onboarding or operator-path proof.

### COV-02B

Current disposition: `ACCEPTED`. The versioned manifest, explicit organization selection, seven named personas, deterministic role/membership provisioning, and 22-owner health report reuse the existing authorization owners and were executed by COV-02C.

### COV-02C

Current disposition: `ACCEPTED`. The dedicated stack produced healthy seven-persona and 22-owner readback, all seven browser logins passed, all six managed roles were denied role administration, IoT gained its required baseline, and a PostgreSQL recreation plus STDB clear/reseed passed independently. Fixture setup remains distinct from module operator-path proof.

### COV-03

Current disposition: `ACCEPTED` for the bounded opportunity-to-sale-order slice. The `sales-crm` persona now drives the existing UI transition, canonical readback enforces exactly one tenant/company/opportunity-linked sale order, replay does not redispatch, and the limited reader is denied by the named operation boundary. This does not promote all CRM recovery or navigation evidence to U4/U5; see [`erp-cov03-crm-opportunity-convergence-status.md`](./erp-cov03-crm-opportunity-convergence-status.md).

### COV-04

Current disposition: `ACCEPTED` for the bounded sale-order confirmation slice. The `sales-crm` persona now confirms through the existing Sales UI, readback keeps the in-place sale order as the stable result while reporting every exact `stock_picking.sale_id` effect, stale replay is rejected without changing the effect set, and the limited reader is denied. This does not promote the complete Sales lifecycle to U4/U5; see [`erp-cov04-sales-order-confirmation-status.md`](./erp-cov04-sales-order-confirmation-status.md).

### COV-05

Current disposition: `IMPLEMENTED` for the three-slice first-adoption chain; runtime acceptance is pending. COV-05a confirms the PO and correlates inbound receipts through exact `stock_picking.purchase_id`. COV-05b captures the exact open `stock_move.purchase_line_id` identity before receipt and requires the same move/picking after validation. COV-05c snapshots the durable `purchase_order.invoice_ids` relation before bill dispatch and accepts exactly one new `account_move` id after readback. All slices preserve stale/deny effect sets. See [`erp-cov05-purchase-order-confirmation-status.md`](./erp-cov05-purchase-order-confirmation-status.md), [`erp-cov05b-purchase-receipt-status.md`](./erp-cov05b-purchase-receipt-status.md), and [`erp-cov05c-vendor-bill-status.md`](./erp-cov05c-vendor-bill-status.md).

The original Lane-B first-adoption path (PO → receipt → vendor bill) is now implemented without newest-row/id-delta effect discovery. Full COV-05 remains open. Next bounded Purchasing work should target three-way-match rejection/recovery or partial receipt/backorder billing; bill posting/payment belongs with COV-08 Accounting.

### COV-06

Current disposition: `IMPLEMENTED` for the bounded stock-picking lifecycle slice; runtime acceptance is pending. The existing `warehouse-manufacturing` persona drives one exact picking through Inventory confirm → assign → validate. Each transition requires canonical same-id state readback, validation requires the source picking to be `done`, the original move-id set must complete without replacement, stale transitions are rejected, and the limited reader remains denied. See [`erp-cov06a-picking-lifecycle-status.md`](./erp-cov06a-picking-lifecycle-status.md).

Next bounded Inventory work should target partial validation/backorder identity or one internal-transfer quant convergence path. Do not expand this slice into cycle counts, lots/serials, quality or replenishment.

## First implementation convergence

Prioritize closing U4/U5 gaps on CRM/Sales/Purchasing/Accounting before adding new backend breadth, but migrate the reference cross-module action through COV-01 first so module agents inherit a proven outcome/readback pattern.

Inventory/Manufacturing and the people/service lane need stronger operator-reachable lifecycle proof. Fleet needs its canonical `/map` versus dedicated-route decision before UI expansion. Reports must not reach U4/U5 until malformed filters, unknown operators, missing timestamp/measure semantics and partial-source errors are truthful.

The first module agents should receive a bounded slice card containing both the required operator transition and its D/A/O/E evidence target. A passing domain/API test cannot substitute for missing O/E evidence.
