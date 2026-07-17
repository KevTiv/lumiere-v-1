# Purchasing & Procurement Investigation — Procure-to-Pay

Current-state assessment of Lumiere purchasing / procurement against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-17 (Wave E applied)  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this refresh unless noted under Validation.

**Verdict:** Lumiere has a credible **MVP procure-to-pay spine** — requisition **with lines** → convert/RFQ → Draft PO → send → optional approval → confirm (`Purchase` + draft IN picking + FX snapshot + encumbrance metadata) → `receive_po_line` (validate inbound → quants + `qty_received` + column `match_state`) → `create_bill_from_purchase_order` → `post_invoice` with **qty + price three-way match guards** → AP payment — plus supplier intake, landed costs, purchase returns MVP, Wave D advanced tables, and Wave E exception queues (`over-billed` / `landed-cost-lines` live). Against the quality bar it is **strong** on atomic stocked receipt, fail-closed qty/price match, SoD/exception subscriptions, and P2P e2e coverage; **partial** on real encumbrance/WHT ledgers, RFQ compare UX, and entity UIs beyond Ops prompts for advanced procurement.

**Quality benchmark (not a spec):** Oracle NetSuite Procurement / Advanced Procurement patterns emphasize integrated requisition→PO→receipt→bill→payment, configurable three-way match with exception routing, RFQ/sourcing, blanket/contracts, vendor performance visibility, and approval workflows ([NetSuite Procurement](https://www.netsuite.com/portal/products/erp/procurement/source.shtml); [NetSuite help / procurement docs](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/)). Lumiere is judged on whether it can meet that *depth of control*, not on SuiteApp parity.

**V1 roadmap reconciliation:** [`docs/V1_ROADMAP.md`](./V1_ROADMAP.md) both lists three-way match as Done and as a TRUE gap. Source truth after Wave E (2026-07-17): **qty + price three-way match Present** on vendor-bill post; **per-PO qty/price tolerances + column `match_state` + over-billed exception SQL Present**.

**Compile check:** `cargo check` in `spacetimedb/` — **passed** (2026-07-17, post Wave E).

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/purchasing` + adjacent)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Purchasing core | `purchase_order`, `purchase_order_line`, `purchase_requisition` | `purchase_orders.rs` | Line `metadata.match_state`; PO `match_qty_tolerance`, `currency_rate`; requisition has `line_ids: Vec<u64>` but **no** `PurchaseRequisitionLine` table |
| Vendor | `res_partner_bank`, `supplier_intake_request` | `vendor_management.rs` | Intake state machine; `lead_time_days` on intake |
| Landed costs | `stock_landed_cost`, `stock_landed_cost_lines` | `landed_costs.rs` | Allocation / apply to quant value |
| Sourcing | `purchase_rfq`, `purchase_rfq_line`, `purchase_rfq_bid` | `sourcing.rs` | Multi-vendor bid + award → draft PO |
| Returns | `purchase_return`, `purchase_return_line` | `purchase_returns.rs` | Confirm → OUT picking; vendor credit stub |
| Advanced | `purchase_blanket_order`, `purchase_contract`, `vendor_scorecard`, `vendor_risk_flag`, `consignment_agreement`, `purchase_approval_delegate`, `commodity_price_index`, `purchasing_integration_intent` | `procurement_advanced.rs` | Wave D differentiators |
| Inventory (adjacent) | `stock_picking`, `stock_move`, `stock_quant` | inventory | Confirm creates IN pickings; receive validates → quants; consignment activate/receive in `inventory/consignment.rs` |
| Accounting (adjacent) | `account_move` / lines, payments, budgets | accounting | `create_bill_from_purchase_order`; 3-way on `post_invoice` for `InInvoice` with `invoice_origin = PO{id}`; WHT metadata on payment |
| Sales (adjacent) | Dropship PO create | `sales/oms_extensions.rs` | SO confirm with `is_dropship` → draft POs |
| Workflow | Approval gate | `workflow/` | `gate_action_with_approval` on PO send/confirm |
| Country packs (adjacent) | tax rules incl. WHT seeds | `core/country_pack.rs` | Not purchasing-specific overlays |
| Budget (adjacent) | budgeting tables | `accounting/budgeting.rs` | Actuals sync on journal post — **not** PO encumbrance ledger |

### 1.2 Backend reducers (callable SpacetimeDB surface)

**Orders / requisitions (`purchase_orders.rs`):**  
`create_purchase_order`, `send_purchase_order`, `confirm_purchase_order`, `cancel_purchase_order`, `update_purchase_order`, `lock_purchase_order`, `unlock_purchase_order`, `add_purchase_order_line`, `remove_purchase_order_line`, `update_purchase_order_line`, `compute_purchase_order_line_totals`, `compute_purchase_order_totals`, `update_po_receipt_status`, `update_po_invoice_status`, `receive_po_line`, `invoice_po_line`, `create_purchase_requisition`, `submit_purchase_requisition`, `approve_purchase_requisition`, `convert_purchase_requisition_to_po`, `close_purchase_requisition`, `cancel_purchase_requisition`

**Helpers (not reducers):** `compute_line_match_state`, `validate_three_way_match_po_lines`, `persist_line_match_state`, `DEFAULT_QTY_MATCH_TOLERANCE` (`0.001`), `DEFAULT_PRICE_MATCH_TOLERANCE` (`0.01`, **not enforced on post**)

**Vendor (`vendor_management.rs`):**  
`create_partner_bank`, `update_partner_bank`, `delete_partner_bank`, `submit_supplier_intake`, `review_supplier_intake`, `approve_supplier_intake`, `reject_supplier_intake`, `hold_supplier_intake`, `update_supplier_intake`, `delete_supplier_intake`

**Landed costs (`landed_costs.rs`):**  
`create_landed_cost`, `add_landed_cost_line`, `compute_landed_costs`, `post_landed_costs`, `cancel_landed_cost`, `update_landed_cost`, `delete_landed_cost`, `remove_landed_cost_line`, `apply_landed_costs`

**Sourcing (`sourcing.rs`):**  
`create_purchase_rfq`, `add_purchase_rfq_line`, `add_purchase_rfq_bid`, `award_purchase_rfq_bid`

**Returns (`purchase_returns.rs`):**  
`create_purchase_return`, `confirm_purchase_return`, `create_vendor_credit_from_purchase_return`

**Advanced (`procurement_advanced.rs`):**  
`create_purchase_blanket_order`, `release_blanket_to_po`, `create_purchase_contract`, `upsert_vendor_scorecard`, `set_vendor_risk_flag`, `create_consignment_agreement`, `set_purchase_approval_delegate`, `set_commodity_price_index`, `create_purchasing_integration_intent`, `record_purchasing_integration_result`

**Adjacent P2P-critical:**  
`create_bill_from_purchase_order` (`journal_entries.rs`), `post_invoice` (+ `validate_in_invoice_three_way_match`), payment/reconcile + WHT metadata hook, `validate_stock_picking_backorder`, `activate_consignment_agreement` / `receive_consignment_stock` (inventory), `create_dropship_purchase_orders_for_sale` (sales), CSV imports in `data_ops/purchasing_imports.rs`

### 1.3 Frontend contracts (BFF / hooks)

[`PURCHASING_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/purchasing-http.ts): **62** keys. **0 phantoms** — every key has a SpacetimeDB reducer (bill + CSV live outside `purchasing/`). Consignment activate/receive are inventory BFF, not purchasing BFF.

| Surface | Status |
|---------|--------|
| `create_bill_from_purchase_order` | BFF + accounting reducer + UI + e2e |
| CSV imports | BFF + `purchasing_imports.rs` + UI bundle |
| Query hooks | 61/62 BFF keys; **`add_purchase_rfq_line` has no dedicated hook** (create RFQ can embed a line) |
| Match UI | Client badges + persisted server `match_state` in line metadata |
| Advanced / RFQ / returns | Hooks present; UI is Ops `window.prompt` MVP (no entity tabs) |

### 1.4 Subscriptions & queries

`PURCHASING_WORKSPACE_RESOURCE_KEYS` ([`purchasing-workspace.ts`](../frontend/packages/stdb/src/subscriptions/purchasing-workspace.ts)): includes Wave E keys.

| Key | In `ERP_ORG_SQL` | Filter / notes |
|-----|------------------|----------------|
| `purchase-orders`, `purchase-order-lines`, `purchase-requisitions`, `purchase-requisition-lines`, `partner-banks`, `account-payment-terms` | Yes | Org-scoped |
| `landed-costs`, `landed-cost-lines`, `supplier-intakes` | Yes | Live WS (Wave A + E) |
| `purchase-orders-to-approve`, `purchase-orders-partial-receipt`, `purchase-order-lines-over-billed` | Yes | Bounded `extraWhere` exception queues |
| `purchase-rfqs`, `purchase-rfq-lines`, `purchase-rfq-bids` | Yes | Subscribed; **no list tab** |
| `purchase-returns`, `purchase-return-lines` | Yes | Subscribed; **no list tab** |
| Blanket / contract / scorecard / risk / consignment / commodity / integration | **No** | Intentional; BFF hints often `[]` |

**Spend:** Dashboard Spend MTD / vendor spend derived client-side from subscribed PO rows — not a dedicated commitment-ledger subscription.

### 1.5 UI operations (`/purchasing`)

Tabs from `purchasingModuleConfig` + client-injected tabs ([`purchasing-client.tsx`](../frontend/web/app/(modules)/purchasing/purchasing-client.tsx)) + SoD ([`purchasing-ops-sod.tsx`](../frontend/web/app/(modules)/purchasing/purchasing-ops-sod.tsx)):

| Tab / surface | End-to-end operations | Gaps |
|---------------|----------------------|------|
| Dashboard | Open POs, Spend MTD, pending/partial receipt, over-billed, to-approve, on-time MVP; vendor spend; Ops SoD + advanced prompts | No server spend-commitment feed; advanced = prompts |
| Purchase Orders | Create/update; send; confirm; cancel; lock/unlock; bill-from-PO; CSV; receive/invoice; dropship badge; SoD | |
| Order Lines | Add/edit/remove; match badges; receive/invoice qty | |
| Purchase Agreements | Requisition create (with lines) / submit / approve / **convert-to-PO** / create RFQ / close / cancel | Mislabel vs true agreements; convert copies lines (Wave E) |
| Vendors | Partner list + supplier CSV | Not dedicated vendor master beyond intake |
| Partner banks | CRUD | |
| Landed costs | Create / lines / compute / post / apply | Live `landed-cost-lines` WS |
| Supplier intakes | Submit / review / approve / reject / hold | |
| Ops SoD | Approve/Reject ToApprove POs | |
| Ops advanced prompts | RFQ bid/award, returns, blanket, contract, scorecard, risk, consignment, delegate, commodity, integration | No compare UI / entity tabs |

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain | `run_purchasing_bill_balanced_test`; isolation; Wave C smoke; `run_purchasing_wave_e_test` (req line copy, receive/bill isolation, price match); suite `run_all_purchasing_tests` | Blanket lines, WHT JE, dropship, landed apply depth |
| Inventory (adjacent) | Receipt → quant increase (inventory tests) | |
| Sales (adjacent) | Dropship PO create in sales gap tests | Purchasing-side dropship lifecycle |
| Playwright | `mvp-procure-to-pay` (@p0): happy path, partial receive matched, over-bill post rejected; `purchasing-module` shell/tabs/modals; approvals parity blocks PO confirm | Convert requisition, RFQ/returns/blanket Ops, landed post |
| Contract | `purchasing.contract.ts` enumerates BFF keys | Compile-only; does not prove backend presence |

---

## 2. Gap matrix (quality bar vs inventory)

Definitions:

- **Present** — usable end to end with operational, inventory, and/or financial consequences.
- **Partial** — implemented at limited depth, or missing an essential UI, policy, reporting, or integration layer.
- **Absent** — no meaningful implementation.
- **Unsuitable** — surface exists but cannot safely meet the workflow requirement.

| Capability | State | Evidence | Priority |
|------------|-------|----------|----------|
| Requisition lifecycle | **Present** (MVP) | Create with lines / add line / submit / approve / close / cancel; convert copies product/qty to draft PO | — |
| RFQ / multi-vendor tender | **Partial** | Tables + create/line/bid/award → PO with lines; Ops prompts; **no** bid-compare UI / sealed rounds | Competitive |
| Blanket / purchase agreements depth | **Partial** | `purchase_blanket_order` + `release_blanket_to_po` → **empty** draft PO; UI prompts only | Competitive |
| Purchase contracts | **Partial** | `create_purchase_contract` header only; no amend/renew/enforce | Competitive |
| PO draft / send / confirm / cancel | **Present** | Reducers + UI + approval gate on send/confirm; e2e | — |
| PO line CRUD | **Present** | Add/update/remove + UI | — |
| PO lock / unlock | **Present** | Reducers + BFF + UI + audit | — |
| Inventory receipt on confirm | **Present** | Confirm creates draft IN picking + moves (stocked products) | — |
| Qty + stock receipt on PO | **Present** | `receive_po_line` → `validate_stock_picking_backorder` posts quants and updates `qty_received` | — |
| Atomic receipt + commitment | **Present** (stocked) | Single reducer txn for stocked path; qty-only for non-stock/service | — |
| Bill from PO | **Present** | Bills `qty_received - qty_invoiced`; `invoice_origin = PO{id}` | — |
| Three-way match (qty) | **Present** | Post `InInvoice` blocked when billed > received/ordered + tol | — |
| Three-way match (price / tolerance policy) | **Present** | Per-PO `match_price_tolerance` (default 0.01) enforced on `post_invoice` debit product lines | — |
| Match state productization | **Present** | Persisted `metadata.match_state`; receive/invoice update; exception SQL | — |
| Partial receipt / bill exceptions | **Present** (MVP) | Partial receive + bill e2e; bounded partial-receipt + over-billed line queues; dashboard KPI | — |
| Vendor bill → payment | **Partial** | Standard AP payment path; WHT metadata Partial; residual UX thin | Competitive |
| Purchasing budgets / encumbrance | **Partial** | Confirm stamps `metadata.encumbrance`; no budget-line mutation / release | Competitive |
| Vendor approvals / intake | **Present** | Intake + review/approve/reject/hold + UI | — |
| Delegation | **Partial** | `purchase_approval_delegate` + set reducer; not wired into approval gate resolution | Differentiating |
| Durable approval histories | **Partial** | Workflow requests for PO send/confirm; requisition approve is permission-only | Competitive |
| Vendor scorecards | **Partial** | `vendor_scorecard` OTIF/quality upsert; no auto-rollup from receipts | Differentiating |
| Lead-time analytics | **Partial** | Dashboard on-time from `date_planned`; intake `lead_time_days`; no scorecard lead-time field | Competitive |
| Supplier risk | **Partial** | `vendor_risk_flag` set reducer; no automated holds from risk | Differentiating |
| Drop shipment (SO-driven) | **Partial** | Sales creates draft POs; purchasing shows origin/SO badge | Competitive |
| Consignment | **Partial** | Agreement create + inventory activate/receive; purchasing UI prompt-only | Differentiating |
| Purchase returns | **Partial** | Create/confirm → OUT picking; vendor credit stub; Ops prompts; smoke test | Competitive |
| Landed costs | **Present** | Create → compute → post → apply to quant value | — |
| Multi-currency / FX on PO | **Present** | `currency_rate` snapshot on confirm | — |
| Withholding tax on AP | **Partial** | Pack WHT seeds + payment metadata breakdown; no liability JE / certificates | Competitive |
| Import duties / customs docs | **Partial** | Landed costs model duty amounts; `purchasing_integration_intent` for customs/e-invoice | Differentiating |
| Local vendor identifiers | **Partial** | Partner/company ID meta in packs; intake fields limited | Competitive |
| Cross-border procurement | **Partial** | Incoterm fields + integration intents; adapters stubs | Differentiating |
| Commodity-price volatility | **Partial** | `commodity_price_index` set reducer; no PO line indexation engine | Differentiating |
| Live spend subscriptions | **Partial** | Org-scoped PO SQL + exception queues; Spend MTD client-derived | Competitive |
| Exception queues (live) | **Present** (MVP) | ToApprove + partial-receipt bounded SQL + SoD UI | — |
| Audit coverage | **Present** (MVP) | Core mutators + compute totals + CSV imports call `write_audit_log_v2` | — |
| Multi-entity isolation | **Present** (MVP) | Confirm + receive/bill isolation domain tests; bill-from-PO org guard | — |
| Phantom UI contracts | **Present** (cleared) | BFF ⊆ reducers (62/62) | — |

---

## 3. Required invariants

### Accounting

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Bill qty ≤ received / ordered | Yes (post) | `validate_in_invoice_three_way_match` + `validate_three_way_match_po_lines` | Configurable company defaults; price tolerances |
| Receive before bill (happy path) | Yes | Bill create uses `qty_received > qty_invoiced`; stocked receive posts quants in-txn | Explicit service/non-stocked policy docs |
| Immutable FX snapshot | Yes (confirm) | `currency_rate` set on confirm | Consume snapshot on bill post / reporting |
| Landed cost valuation | Partial | `apply_landed_costs` adjusts quant value | Link to bill/duty lines; period lock |
| Budget / commitment | Partial | Metadata encumbrance at confirm | Encumbrance ledger; release on cancel/bill |
| Period locks | Partial | Accounting close elsewhere | Block receive/bill/post when locked |
| Purchase returns / credit | Partial | Confirm OUT picking + draft `InRefund` stub | Full stock out + AP credit match residual |
| Price variance fail-closed | No | Constant unused | Enforce on `post_invoice` within tol |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Reducer permissions | Yes (pattern) | `check_permission` on purchasing resources | Keep deny-by-default for new Wave D mutators |
| Tenant / company ownership | Yes (MVP) | Org + company guards; confirm + receive/bill isolation (Wave E) | Expand to RFQ/return |
| Approval SoD (PO) | Partial | Workflow gate + Purchasing Ops Approve/Reject | Ensure resume path cannot self-approve |
| Requisition approve | Partial | Permission `"approve"` only — not workflow gate | Align with durable approval history |
| Delegation | Partial | Delegate table/reducer exists | Resolve substitute in `gate_action_with_approval` |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Append-only mutation log | Yes (MVP) | PO/RFQ/return/advanced/intake/landed + compute totals + CSV imports | Keep coverage on new mutators |
| Approval history | Partial | Workflow requests for gated PO actions | Surface timeline in Purchasing UI; requisition via gate |
| Source-document links | Partial | `invoice_origin = PO{id}`; RFQ award lines; picking links on confirm/receive | PO → picking → move → bill → payment drill-down |

### Concurrency / inventory

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Atomic PO confirm | Yes | Single reducer; approval gate; IN pickings + FX + encumbrance metadata | |
| Atomic stock receipt | Yes | `receive_po_line` validates inbound picking and updates qty in one reducer txn | Keep domain + e2e green after publish |
| Stale-state rejection | Partial | State preconditions on confirm/cancel/send | Idempotency for bill create/post retries |
| Three-way fail closed | Yes (qty + price) | Post rejects over-qty/over-price; e2e + Wave E domain | Keep green after publish |
| No client multi-step commit | Intent | Approval resume server-side | Never orchestrate receive+bill+post across optimistic client steps without server guards |
| Live exception queues | Yes (MVP) | Bounded ToApprove / partial-receipt / over-billed subscriptions | Spend-commitment feed |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). External HTTP belongs in procedures/workers, not reducers.

---

## 4. Reference workflows

1. **Requisition create → submit → approve → convert** — Present; convert copies requisition lines onto draft PO (Wave E).
2. **RFQ / tender compare** — Backend award Present; **compare UI Absent** (award-by-id Ops prompt).
3. **Draft PO + lines → send → confirm** — Present; may enter `ToApprove` via workflow gate.
4. **Lock / unlock** — Present (reducers + UI + audit).
5. **Receipt** — Stocked path Present (picking validate + quants); non-stock qty-only Present.
6. **Partial receipt → bill → match** — Present for qty; e2e covers Matched + post; partial-receipt queue Present.
7. **Over-bill → post blocked** — Present (qty + price); e2e + Wave E domain.
8. **AP payment** — Accounting path; WHT metadata Partial.
9. **Supplier intake SoD** — Intake approvals Present; PO SoD via Ops + approvals inbox.
10. **Landed cost post/apply** — Present reducers + UI + live lines WS.
11. **Dropship SO → draft PO** — Backend Present (sales); purchasing badge Partial.
12. **Purchase return** — MVP Present (confirm OUT + credit stub); entity UI Partial.
13. **Cross-company isolation** — Confirm + receive/bill isolation domain tests Present (Wave E).
14. **Live spend / exceptions** — ToApprove / partial-receipt / over-billed queues Present; spend commitment Partial (client-derived).
15. **Cross-border WHT / duties** — Pack seeds + landed + integration intents Partial; adapters stubs.
16. **Tolerance edges** — Per-PO qty + price tol Present and enforced on post.
17. **Budget commitment** — Metadata stamp Partial; ledger Absent.
18. **Blanket / contract** — Create/release MVP Partial (empty PO / header-only).

### Acceptance scenarios (≥18)

1. Create Draft PO with partner, currency, payment terms, and lines; totals = untaxed + tax; audit CREATE.
2. Send PO → `Sent` or `ToApprove` per approval rule; second confirm without approval fails; approver resume → `Purchase` (SoD).
3. Confirm PO → state `Purchase`, `date_approve` set, `supplier_rank` bumped, `currency_rate` snapshot, encumbrance metadata, draft IN picking + moves for stocked lines.
4. Lock PO blocks unsafe update/confirm/line edits; unlock restores; audit recorded.
5. `receive_po_line` for partial qty updates `qty_received`, posts stock via inbound picking validate (stocked), persists `match_state`.
6. `create_bill_from_purchase_order` creates `InInvoice` for unbilled received qty with `invoice_origin = PO{id}`; line `qty_invoiced` increases.
7. Post bill when billed ≤ received + tol succeeds and balances; GL lines correct.
8. Force over-bill → line match `over_billed` → `post_invoice` fails closed with three-way error.
9. Cancel uninvoiced PO → `Cancelled`; open receipts/commitments released per policy (encumbrance release still target).
10. Approved requisition converts to draft PO with `origin`/`metadata` linkage **and** line items copied (Wave E).
11. Multi-vendor tender: ≥2 bids, compare (target UI), award, create PO with lines at bid price.
12. Supplier intake: submit → review → approve by non-requester; reject/hold with reason; audit.
13. Landed cost: link pickings → compute → post → apply updates quant cost/value; audit.
14. Dropship SO confirm creates draft PO(s) with dropship metadata/origin; purchasing list shows badge; no warehouse OUT reserve on SO.
15. Company B cannot confirm/receive/bill company A’s PO (Wave E domain).
16. Multi-currency PO stores FX snapshot used on bill post; report drills PO → picking → move → bill → payment.
17. Subscription clients see live ToApprove / partial-receipt / over-billed queues without polling; spend-commitment feed (target depth).
18. Purchase return for received qty → OUT picking → AP credit note → match residual.
19. Price variance beyond tol blocks bill post (target; **not enforced today**).
20. Blanket release creates PO with catalog/qty lines within remaining commitment (target; empty PO today).

---

## 5. Localization matrix (purchasing / AP–relevant)

Country packs today are **tax-seed + company-ID metadata** (`spacetimedb/src/core/country_pack.rs`). Purchasing still needs AP overlays (withholding at payment, import duty classification, vendor tax IDs, cross-border document procedures). Pack metadata flags such as `nfe_adapter` / `e_invoice` are **stubs**, not live integrations. Durable intents (`purchasing_integration_intent`) are the correct SpacetimeDB boundary for future workers.

**i18n:** UI ships **English only** (`SupportedLanguage = "en"`). Purchasing strings live under `purchasing.*` in `en.json`. Country packs are not language packs.

Rates and rules below are **dated requirements as of 2026-07-17**, cited from official sources where linked — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA only in-tree) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|-----------------------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` only | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| VAT/GST seed | GST-AU 10%; GST-NZ 15% | VAT-ZA 15% | ICMS/IVA seeds | GST/SST/PPN/VAT seeds |
| Withholding | PAYG/WHT regimes vary by payment type — pack seeds not purchasing-wired to liability JE | WHT-ZA 20% seed; payment metadata Partial | IRRF-BR seed; payment metadata Partial | Local WHT on services/imports — pack-thin; same Partial payment hook |
| Import duties | Customs value + GST on imports (ATO / NZ Customs); model via landed cost | SARS Customs; landed cost Partial | Siscomex / Mercosur; DI outside reducers | High import intensity; duties via landed cost + integration intent |
| Vendor identifiers | ABN / NZBN on supplier | VAT number | CNPJ / CUIT / RUT | UEN (SG); TIN variants |
| Cross-border docs | Commercial invoice / COO | SADC / deep-sea docs | NF-e / import DI | ASEAN + import permits; MY e-Invoice (MyInvois) |
| Commodity volatility | Soft commodity / fuel indexation common | Mining inputs | Agri / FX-linked ARS | Palm, electronics, FX — `commodity_price_index` hook only |
| Purchasing pack gap | WHT at payment + ABN on bill PDF | WHT certificate on AP | Import DI + NF-e inbound as **procedures/workers** | E-invoice inbound as **procedures/workers**; duty/HS codes polish |

### Official sources (dated; verify)

| Region | Authority / reference |
|--------|----------------------|
| Australia GST / imports | [ATO — GST](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst); [ABF / Customs](https://www.abf.gov.au) |
| New Zealand GST / Customs | [IRD — GST](https://www.ird.govt.nz/gst); [NZ Customs](https://www.customs.govt.nz) |
| South Africa VAT / Customs | [SARS — VAT](https://www.sars.gov.za/tax-rates/value-added-tax-vat/); [SARS Customs](https://www.sars.gov.za) |
| Singapore GST | [IRAS — GST](https://www.iras.gov.sg/taxes/goods-services-tax-gst) |
| Malaysia e-Invoice | [LHDN MyInvois](https://www.hasil.gov.my) |
| Indonesia | [DJP / Coretax](https://www.pajak.go.id) |
| Brazil NF-e / imports | [Receita Federal](https://www.gov.br/receitafederal) |
| Thailand VAT | [Revenue Department](https://www.rd.go.th) |
| Philippines VAT | [BIR](https://www.bir.gov.ph) |
| Chile IVA | [SII](https://www.sii.cl) |
| Argentina IVA | [AFIP / ARCA](https://www.afip.gob.ar) |

Neighboring Southern African markets (e.g. Botswana, Namibia, Mozambique) have **no** in-tree packs.

---

## 6. SpacetimeDB architecture decision (Purchasing / P2P)

Quality benchmark for integrated procure-to-pay controls: Oracle NetSuite purchasing / SuiteSuccess operational patterns ([NetSuite Sourcing / Procurement](https://www.netsuite.com/portal/products/erp/procurement/source.shtml)). Architecture constraints from SpacetimeDB: reducers are automatically transactional; procedures are the HTTP boundary ([SpacetimeDB Functions](https://spacetimedb.com/docs/functions/); [Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Subscription semantics](https://spacetimedb.com/docs/subscriptions/semantics)).

| Topic | Decision |
|-------|----------|
| **Atomic mutations** | Keep PO confirm, receipt commitment, stock receive, bill create qty bump, and three-way match rejection in **single reducers** (or one internal `*_impl`) wherever atomicity is required. `receive_po_line` updates PO qty **and** inventoriable stock in one transaction via picking validate — do not leave stock sync to a client second step. |
| **Confirm vs receive** | Confirm creates draft IN picking for stocked products + FX + encumbrance metadata; `receive_po_line` validates and posts quants atomically with `qty_received`. Qty-only path is intentional for non-stocked / service POs. |
| **Commitments** | Prefer eventual encumbrance as first-class budget-line mutations inside confirm/cancel/bill reducers — not client-orchestrated multi-step. Metadata stamp is an interim MVP only. |
| **Preconditions / idempotency** | Enforce state preconditions on send/confirm/cancel/receive/bill. Add idempotency keys for repeated bill create/post and external customs/payment callbacks. |
| **Subscriptions** | Prefer company-filtered and **bounded exception** subscriptions (`state = ToApprove`, partial receipt, over-billed — Wave E). Keep RFQ/returns in workspace SQL even before entity tabs. `landed-cost-lines` live. Avoid deriving all queues solely from full-table client filters. |
| **Isolation / scale** | Index tenant, company, state, partner, order, picking, and invoice-origin paths. Index names must remain unique module-wide. Isolation tests must cover confirm **and** receive/bill for company A vs B. |
| **External I/O** | Customs, tax-authority e-invoice inbound, payment-provider, and commodity-price feeds go behind **API workers / procedures** with durable `purchasing_integration_intent` rows. Reducers must not block on HTTP. |
| **Statutory adapters** | Treat pack `nfe_adapter` / `e_invoice` / IRAS metadata as **stubs** until worker adapters exist. |
| **Match** | Keep fail-closed qty match on `post_invoice`; persist `match_state`; add configurable price/qty tolerances before claiming competitive 3-way match. |
| **Approvals** | Keep PO send/confirm behind `gate_action_with_approval`; resolve `purchase_approval_delegate` inside the gate; align requisition approve with durable workflow history; keep Purchasing Ops SoD UI. |

---

## 7. Priority classification (remaining gaps)

Snapshot after Waves A–D (tracker: [purchasing-p2p-gap-fixes-plan.md](./plans/purchasing-p2p-gap-fixes-plan.md)). Closed items remain listed for audit trail.

### Pilot-critical

| Gap | Status | Notes |
|-----|--------|-------|
| Atomic inventory receipt | **Closed in-tree** | Confirm → IN picking; `receive_po_line` → validate → quants + `qty_received` |
| Company isolation tests | **Closed in-tree** | Confirm + receive/bill (`run_purchasing_wave_e_test`) |
| Audit gaps (lock/lines/status/intake/landed/compute/CSV) | **Closed in-tree** | Wave E compute + import audit |
| `landed-costs` / `supplier-intakes` ERP_ORG_SQL | **Closed in-tree** | Live org SQL wired |
| Requisition → PO **line copy** | **Closed in-tree** | `purchase_requisition_line` + convert copies lines |
| `landed-cost-lines` WS orphan | **Closed in-tree** | Workspace + ERP_ORG_SQL |
| P2P e2e + domain suite after publish | **Verify** | `run_all_purchasing_tests` (incl. Wave E); Playwright `mvp-procure-to-pay` |
| Phantom BFF keys | **Closed** | BFF includes `add_purchase_requisition_line` |

### Competitive

| Gap | Status | Notes |
|-----|--------|-------|
| True RFQ + tender **comparison UI** | **Open** | Backend award MVP; Ops prompts only |
| Purchase returns entity UI + full credit match | **Partial** | Backend MVP + smoke; prompt UI |
| Purchasing budgets / encumbrance ledger | **Partial** | Metadata only |
| Configurable **price** tolerances on post | **Closed in-tree** | Enforced on `post_invoice` |
| Over-billed exception queue key | **Closed in-tree** | `purchase-order-lines-over-billed` + dashboard KPI |
| Durable requisition approval (workflow gate) | **Open** | Permission-only today |
| Dropship purchasing UX depth | **Partial** | Badge Present |
| WHT liability JE / certificates | **Partial** | Payment metadata only |
| Lead-time / on-time analytics depth | **Partial** | Dashboard MVP |
| Local vendor ID overlays on bill/PDF | **Open** | Pack metadata only |

### Differentiating

| Gap | Status | Notes |
|-----|--------|-------|
| Blanket release with lines / remaining qty | **Partial** | Empty PO today |
| Contract amend/renew/enforce | **Partial** | Create only |
| Vendor scorecard auto-rollup | **Partial** | Manual upsert |
| Supplier risk → hold automation | **Partial** | Flag only |
| Consignment purchasing UI | **Partial** | Inventory path Present; purchasing prompt |
| Delegation wired into approval gate | **Partial** | Table/reducer Present |
| Commodity-price indexation on lines | **Partial** | Index set only |
| Cross-border integration workers | **Partial** | Intent/result Present; HTTP outside |
| Advanced landed-cost / HS duty classification | **Open** | Polish |

**Still open for polish (Wave F+):** publish + Playwright re-run after schema deploy, encumbrance ledger release, full WHT JE, dedicated entity tabs for RFQ/returns/advanced (prompt MVP today), requisition workflow-gate approval.

---

## Validation

| Check | Result |
|-------|--------|
| Tables/reducers vs `spacetimedb/src/purchasing/*` | Verified 2026-07-17 |
| BFF keys vs reducers | 62 keys, 0 phantoms |
| Workspace keys vs `ERP_ORG_SQL` | Wave E keys wired (`landed-cost-lines`, requisition lines, over-billed) |
| `cargo check` (`spacetimedb/`) | **Passed** 2026-07-17 (post Wave E) |
| Domain/E2E suites executed in this refresh | **No** — existence only (`run_purchasing_wave_e_test` present) |
| V1 three-way match contradiction | Reconciled: qty + price Present |
| Acceptance scenarios | 20 listed (≥10 required) |
| Every gap has state + priority | Yes (§2 / §7) |

---

## Bottom line

Lumiere’s P2P spine is **receipt-and-match strong at MVP depth**: PO confirm creates IN pickings, `receive_po_line` posts stock and qty atomically, qty **and price** three-way match fail closed on bill post, and exception/SoD subscriptions (including over-billed) exist. Waves A–E closed requisition line copy, audit leftovers, isolation breadth, and price match. Remaining competitive/differentiating work (Wave F+) is real encumbrance/WHT ledgers, RFQ/returns/advanced entity UIs, requisition workflow-gate approval, and external integration workers.

### Related docs

- [Inventory & Warehouse Management investigation](./INVENTORY_WAREHOUSE_MANAGEMENT_INVESTIGATION.md) — PO receive → quant adjacency
- [Sales & Order Management investigation](./SALES_ORDER_MANAGEMENT_INVESTIGATION.md) — dropship PO adjacency; Ops/SoD pattern
- [Accounting NetSuite gap](./ACCOUNTING_NETSUITE_GAP.md) — AP/posting/bill adjacent
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — wedge B procure-to-pay (claims reconciled in Verdict)
- Investigation brief: [purchasing-procurement-investigation-refresh-plan.md](./plans/purchasing-procurement-investigation-refresh-plan.md)
- Gap-fix tracker: [purchasing-p2p-gap-fixes-plan.md](./plans/purchasing-p2p-gap-fixes-plan.md)
- Purchasing module: `spacetimedb/src/purchasing/`
- Purchasing workspace: `frontend/packages/stdb/src/subscriptions/purchasing-workspace.ts`
- Domain tests: `spacetimedb/tests/purchasing/` (`run_all_purchasing_tests`)
- E2E: `frontend/web/tests/e2e/mvp-procure-to-pay.spec.ts`
