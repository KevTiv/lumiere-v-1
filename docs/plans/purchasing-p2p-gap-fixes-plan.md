# Purchasing P2P Gap Fixes — Tracker

Executable tracker for the full backlog (Pilot → Competitive → Differentiating). Source investigation: [../PURCHASING_PROCUREMENT_INVESTIGATION.md](../PURCHASING_PROCUREMENT_INVESTIGATION.md).

## Wave A — Pilot integrity (landed)

- [x] Atomic IN picking on `confirm_purchase_order` + inbound validate → quants
- [x] `receive_po_line` drives picking validate (qty + stock in one path)
- [x] Company isolation domain tests (`run_purchasing_company_isolation_test`)
- [x] Audit gaps: lock/unlock, line add/update, status updates, intake/landed update/delete
- [x] Wire `landed-costs` / `supplier-intakes` into `ERP_ORG_SQL`
- [x] Domain + inventory receipt tests (`run_purchasing_incoming_picking_test`, updated `test_receipt_increases_quant`)

## Wave B — Competitive productization

- [x] Configurable qty/price tolerances + persist/expose match state
- [x] Server-bounded exception SQL + Purchasing Ops SoD Approve/Reject
- [x] Requisition → PO conversion reducer + UI
- [x] FX snapshot on PO confirm
- [x] Dropship purchasing UX visibility
- [x] Wire `useUpdatePurchaseOrder` in UI
- [x] Lead-time / on-time dashboard metrics (MVP)

## Wave C — Competitive depth

- [x] RFQ / multi-vendor tender MVP (quote lines + compare + award) — `purchasing/sourcing.rs`; BFF + Ops/Agreements prompts
- [x] Purchase returns (vendor RMA → stock out → AP credit) — `purchasing/purchase_returns.rs` + `create_vendor_credit_from_purchase_return` stub; smoke via `run_purchasing_wave_c_smoke_test`
- [x] Purchasing budgets / encumbrance at confirm — **metadata only**: `{"encumbrance": amount_total}` on PO confirm (no `crossovered_budget` mutation; actuals still sync on journal post)
- [x] WHT on AP payment (consume pack seeds) — small hook on `post_payment` for OutBound+Supplier when active `TaxTypeUse::Withholding` exists; writes WHT breakdown onto payment `AccountMove.metadata` (no liability lines / certificates yet)

## Wave D — Differentiating

- [x] Blanket orders / purchase contracts (`procurement_advanced.rs`: `purchase_blanket_order` + `release_blanket_to_po`, `purchase_contract`)
- [x] Vendor scorecards + supplier risk (`vendor_scorecard` / `upsert_vendor_scorecard`, `vendor_risk_flag` / `set_vendor_risk_flag`)
- [x] Consignment purchasing (`consignment_agreement` / `create_consignment_agreement`)
- [x] Delegation / substitute approvers (`purchase_approval_delegate` / `set_purchase_approval_delegate`)
- [x] Commodity-price indexation hooks (`commodity_price_index` / `set_commodity_price_index`)
- [x] Cross-border integration intents (customs/e-invoice) (`purchasing_integration_intent` create + record result)
- [x] BFF + query-hooks + Ops/dashboard `window.prompt` quick actions (sales `oms_advanced` pattern)

## Wave E — Remaining pilot + match controls (2026-07-17)

- [x] `purchase_requisition_line` table + create/add reducers; convert copies lines to PO
- [x] Requisition create form product/uom/qty → `lines`; BFF `add_purchase_requisition_line`; workspace/ERP_ORG_SQL `purchase-requisition-lines`
- [x] Audit `compute_purchase_order_*_totals` + CSV import reducers
- [x] Isolation: org B cannot receive/bill org A PO (`create_bill_from_purchase_order` org guard + `run_purchasing_wave_e_test`)
- [x] Wire `landed-cost-lines` into workspace + `ERP_ORG_SQL`
- [x] `match_price_tolerance` on PO; price variance enforced on `post_invoice`
- [x] First-class `purchase_order_line.match_state` + `purchase-order-lines-over-billed` exception queue + dashboard KPI
- [x] Domain tests: requisition convert, receive/bill isolation, price match block (`run_purchasing_wave_e_test`)

## Wave F — Deferred

- [ ] Real encumbrance / budget-line ledger + release on cancel/bill
- [ ] WHT liability JE / certificates
- [ ] Full RFQ compare / returns / blanket entity tabs
- [ ] Requisition workflow-gate approval
- [ ] Delegation resolution inside approval gate
- [ ] Commodity indexation / HS duty / integration workers

## Ops checklist after merge

1. `make generate-stdb-ts-sdk` and `make generate-stdb-rust-sdk` (done in Wave E)
2. `make codegen` (done in Wave E)
3. `spacetime publish` (or local) with module path
4. `spacetime call <db> run_all_purchasing_tests` (includes Wave E)
5. Playwright: `mvp-procure-to-pay`, `purchasing-module`
