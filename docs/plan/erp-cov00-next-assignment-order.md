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

Current disposition: `IMPLEMENTED` for six bounded Inventory slices; runtime acceptance is pending. COV-06a drives one exact picking through Inventory confirm → assign → validate with canonical same-id state readback and stable move identity. COV-06b partially validates an assigned picking using the source-owned `backorder_ids` relation and exact child linkage. COV-06c moves one untracked quant between internal locations, snapshots exact source/destination identity before dispatch, verifies exact quantity convergence after dispatch, removes first/latest destination selection, and preserves stale/deny effect sets. COV-06d posts one cycle count with exactly one counted line through the existing wizard, snapshots the optional pre-existing quant at the counted identity before dispatch, verifies exact convergence (same id updated, or exactly one new id created) to the counted quantity, adds durable commit recording to `post_cycle_count_adjustments`, and grants the warehouse persona the `stock_cycle_count`/`stock_count_sheet` permissions the reducers already required but the fixture never granted. COV-06e relocates one lot-tracked quant through the same `move_stock_quant` path, adds a lot-lock/expiry integrity check that path never had (a locked lot could previously be relocated freely), and syncs the lot's own denormalized `location_id` to the destination when the move empties its presence at the source. COV-06f extends COV-06a's exact confirm → assign → validate certification to a serial-tracked product: no backend defect existed (the reducer path already selects deterministically by expiry order, not iteration/newest-row), so this closes a certification gap rather than a correctness one — the serial converges free → reserved → in_use across the two stages and the source quant depletes to zero. COV-06g fails one quality check for one on-hand product, fixing two "first match wins" defects in the same class COV-06c closed for `move_stock_quant`: `resolve_quality_source_location` picked an arbitrary on-hand location when more than one existed (a native test had a comment working around this rather than fixing it), and `quarantine_quantity` merged into an arbitrary compatible destination quant — both now fail closed, and the reducer gained durable commit recording. Also surfaced (not fixed): `wh_qc_stock_loc_id` has no update path anywhere and the dev seed never sets it, so the "fail" UI now prompts for a quarantine location explicitly rather than relying on a warehouse setting that can never be configured today. See [`erp-cov06a-picking-lifecycle-status.md`](./erp-cov06a-picking-lifecycle-status.md), [`erp-cov06b-picking-backorder-status.md`](./erp-cov06b-picking-backorder-status.md), [`erp-cov06c-internal-quant-transfer-status.md`](./erp-cov06c-internal-quant-transfer-status.md), [`erp-cov06d-cycle-count-adjustment-status.md`](./erp-cov06d-cycle-count-adjustment-status.md), [`erp-cov06e-lot-tracked-quant-move-status.md`](./erp-cov06e-lot-tracked-quant-move-status.md), [`erp-cov06f-serial-tracked-picking-status.md`](./erp-cov06f-serial-tracked-picking-status.md), and [`erp-cov06g-quality-fail-quarantine-status.md`](./erp-cov06g-quality-fail-quarantine-status.md).

COV-06's stock-movement lineage (picking lifecycle, backorder, quant transfer, cycle-count, lot move, serial-tracked picking, quality fail) is now closed for its originally scoped set. Two small remaining gaps: `reserve_serial` (free → reserved) is not wired into the UI at all — only `use_serial`/`block_serial` are; and `wh_qc_stock_loc_id` has no update reducer. Neither is a movement path. Next bounded Inventory work should target replenishment (`execute_replenishment_rule` — described as "still timestamp-only, unsuitable for ops demand") as a distinct slice.

## First implementation convergence

Prioritize closing U4/U5 gaps on CRM/Sales/Purchasing/Accounting before adding new backend breadth, but migrate the reference cross-module action through COV-01 first so module agents inherit a proven outcome/readback pattern.

Inventory/Manufacturing and the people/service lane need stronger operator-reachable lifecycle proof. Fleet needs its canonical `/map` versus dedicated-route decision before UI expansion. Reports must not reach U4/U5 until malformed filters, unknown operators, missing timestamp/measure semantics and partial-source errors are truthful.

The first module agents should receive a bounded slice card containing both the required operator transition and its D/A/O/E evidence target. A passing domain/API test cannot substitute for missing O/E evidence.
