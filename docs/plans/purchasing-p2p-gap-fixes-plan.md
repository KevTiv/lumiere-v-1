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

## Ops checklist after merge

1. `make generate-stdb-ts-sdk` and `make generate-stdb-rust-sdk`
2. `spacetime publish` (or local) with module path
3. `spacetime call <db> run_purchasing_bill_balanced_test` (+ new receipt/isolation tests)
4. Playwright: `mvp-procure-to-pay`, `purchasing-module`
