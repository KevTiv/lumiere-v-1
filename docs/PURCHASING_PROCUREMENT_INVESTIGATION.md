# Purchasing & Procurement Investigation — Procure-to-Pay

Current-state assessment of Lumiere purchasing / procurement against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-16  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this refresh unless noted under Validation.

**Verdict:** Lumiere has a credible **MVP procure-to-pay spine** — Draft PO → optional send → optional approval → confirm (`Purchase` + draft IN picking) → `receive_po_line` (validate inbound → quants + `qty_received`) → `create_bill_from_purchase_order` → `post_invoice` with **qty three-way match guard** → AP payment via accounting — plus requisition lifecycle, supplier intake, partner banks, landed costs, and the 2026-07-16 gap-fix waves (RFQ/tender, returns, advanced procurement tables). Against the quality bar it is **strong** on bill-post match blocking, atomic receipt for stocked products, and P2P e2e coverage; **partial** on price-variance match, encumbrance ledgers, WHT liability lines, and full entity UIs for advanced tables.

**V1 roadmap reconciliation:** [`docs/V1_ROADMAP.md`](./V1_ROADMAP.md) both lists three-way match as Done and as a TRUE gap. Source truth after gap-fix: **qty three-way match Present** on vendor-bill post; **per-PO qty tolerance + persisted `match_state` + exception SQL Present**; **price variance enforcement still Partial**.

**Compile check:** `cargo check` in `spacetimedb/` — **passed** (2026-07-16, post gap-fix).

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/purchasing` + adjacent)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Purchasing core | `purchase_order`, `purchase_order_line`, `purchase_requisition` | `purchase_orders.rs` | Requisition comments say “RFQ”; UI labels “Purchase Agreements” |
| Vendor | `res_partner_bank`, `supplier_intake_request` | `vendor_management.rs` | Intake state machine Draft→…→Onboarded |
| Landed costs | `stock_landed_cost`, `stock_landed_cost_lines` | `landed_costs.rs` | Allocation / apply to quant value |
| Inventory (adjacent) | `stock_picking`, `stock_move`, `stock_quant` | inventory module | Seed links pickings to POs; **confirm/receive reducers do not create pickings or move quants** |
| Accounting (adjacent) | `account_move` / lines, payments, budgets | accounting | `create_bill_from_purchase_order`; 3-way on `post_invoice` for `InInvoice` with `invoice_origin = PO{id}` |
| Sales (adjacent) | Dropship PO create | `sales/oms_extensions.rs` | SO confirm with `is_dropship` → draft POs |
| Workflow | Approval gate | `workflow/` + PO send/confirm | `gate_action_with_approval` on send/confirm only |
| Country packs (adjacent) | tax rules incl. WHT seeds | `core/country_pack.rs` | Not purchasing-specific overlays |
| Budget (adjacent) | budgeting tables | `accounting/budgeting.rs` | Actuals sync on journal post — **not** PO encumbrance |

### 1.2 Backend reducers (callable SpacetimeDB surface)

**Orders / requisitions (`purchase_orders.rs`):**  
`create_purchase_order`, `send_purchase_order` (+ `send_purchase_order_impl`), `confirm_purchase_order` (+ `confirm_purchase_order_impl`), `cancel_purchase_order`, `update_purchase_order`, `lock_purchase_order`, `unlock_purchase_order`, `add_purchase_order_line`, `remove_purchase_order_line`, `update_purchase_order_line`, `compute_purchase_order_line_totals`, `compute_purchase_order_totals`, `update_po_receipt_status`, `update_po_invoice_status`, `receive_po_line`, `invoice_po_line`, `create_purchase_requisition`, `submit_purchase_requisition`, `approve_purchase_requisition`, `close_purchase_requisition`, `cancel_purchase_requisition`

**Helpers (not reducers):** `compute_line_match_state`, `validate_three_way_match_po_lines`, `DEFAULT_QTY_MATCH_TOLERANCE` (`0.001`)

**Vendor (`vendor_management.rs`):**  
`create_partner_bank`, `update_partner_bank`, `delete_partner_bank`, `submit_supplier_intake`, `review_supplier_intake`, `approve_supplier_intake`, `reject_supplier_intake`, `hold_supplier_intake`, `update_supplier_intake`, `delete_supplier_intake`

**Landed costs (`landed_costs.rs`):**  
`create_landed_cost`, `add_landed_cost_line`, `compute_landed_costs`, `post_landed_costs`, `cancel_landed_cost`, `update_landed_cost`, `delete_landed_cost`, `remove_landed_cost_line`, `apply_landed_costs`

**Adjacent P2P-critical:**  
`create_bill_from_purchase_order` (`journal_entries.rs`), `post_invoice` (+ `validate_in_invoice_three_way_match`), payment/reconcile reducers, stock picking validate (for true inventory receipt if wired), `create_dropship_purchase_orders_for_sale`, CSV imports in `data_ops/purchasing_imports.rs` (`import_purchase_order_csv`, `import_purchase_order_line_csv`, `import_supplier_info_csv`)

### 1.3 Frontend contracts (BFF / hooks)

[`PURCHASING_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/purchasing-http.ts) lists 45 keys. **All have matching SpacetimeDB reducers** (bill + CSV live outside `purchasing/`). No Sales-style “UI without reducer” Unsuitable contracts found for lock/line — lock/unlock and line update/remove **exist** in both BFF and backend.

| Surface | Status |
|---------|--------|
| `create_bill_from_purchase_order` | BFF + accounting reducer + UI + e2e |
| CSV imports | BFF + `purchasing_imports.rs` + UI bundle |
| `useUpdatePurchaseOrder` | Hook exists; **not imported** in `purchasing-client.tsx` |
| Match UI | Client-side `computeLineMatchState` mirrors backend labels; backend helper unused by other modules |

### 1.4 Subscriptions & queries

`PURCHASING_WORKSPACE_RESOURCE_KEYS` ([`purchasing-workspace.ts`](../frontend/packages/stdb/src/subscriptions/purchasing-workspace.ts)):

| Key | In `ERP_ORG_SQL` | Filter |
|-----|------------------|--------|
| `purchase-orders`, `purchase-order-lines`, `purchase-requisitions`, `partner-banks`, `account-payment-terms` | Yes | `organization_id` (empty extraWhere) |
| `landed-costs`, `supplier-intakes` | **No** | Workspace keys present; WS builders missing → silent skip; REST `/api/query` still used |
| `landed-cost-lines` | Not in workspace keys | |

**Exception / spend queues:** No purchasing Ops panel. Dashboard derives Open POs / Spend MTD / Pending receipt / Awaiting approval **client-side** from subscribed orders. No server-bounded keys (e.g. `purchase-orders-to-approve`, over-billed lines).

### 1.5 UI operations (`/purchasing`)

Tabs from `purchasingModuleConfig` + client-injected tabs ([`purchasing-client.tsx`](../frontend/web/app/(modules)/purchasing/purchasing-client.tsx)):

| Tab | End-to-end operations | Gaps |
|-----|----------------------|------|
| Dashboard | Live Open POs, Spend MTD, pending receipt, to-approve counts; top vendors | On-time vendor metrics placeholder; no match/exception queues |
| Purchase Orders | Create; send; confirm; cancel; lock/unlock; bill-from-PO; CSV; receive/invoice line actions | Header `update_purchase_order` unused |
| Order Lines | Add/edit/remove; match state display; receive/invoice qty | Match is client-computed |
| Purchase Agreements | Requisition create / submit / approve / close / cancel | Mislabel vs true RFQ; no convert-to-PO reducer |
| Vendors | Partner list (contacts) | Not a dedicated vendor master beyond intake |
| Partner banks | CRUD | |
| Landed costs | Create / lines / compute / post / apply (injected tab) | No live WS SQL |
| Supplier intakes | Submit / review / approve / reject / hold (injected tab) | No live WS SQL |

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain | `run_purchasing_bill_balanced_test` / `test_po_confirm_to_balanced_bill` (confirm → receive → bill) | Match reject, lock, requisition, intake, landed, company isolation, stock receipt |
| Inventory note | `stock_picking_quant_test.rs` documents `receive_po_line` does **not** post quants | Atomic receipt |
| Sales | Dropship PO create in `gap_fixes_test.rs` | Purchasing-side dropship UX |
| Playwright | `mvp-procure-to-pay` (@p0): happy path, partial receive matched, over-bill post rejected; `purchasing-module` shell/tabs/modals; approvals parity blocks PO confirm | Requisition→PO, returns, RFQ, budgets |
| Contract | `purchasing.contract.ts` enumerates BFF keys | Does not prove inventory atomicity |

---

## 2. Gap matrix (quality bar vs inventory)

Definitions:

- **Present** — usable end to end with operational, inventory, and/or financial consequences.
- **Partial** — implemented at limited depth, or missing an essential UI, policy, reporting, or integration layer.
- **Absent** — no meaningful implementation.
- **Unsuitable** — surface exists but cannot safely meet the workflow requirement.

| Capability | State | Evidence |
|------------|-------|----------|
| Requisition lifecycle | **Partial** | Create/submit/approve/close/cancel + UI; `purchase_ids` link field only — **no** reducer converting approved requisition → PO |
| RFQ / multi-vendor tender | **Absent** | No vendor quote lines, bid comparison, or award workflow; naming only on requisition comments |
| Blanket / purchase agreements depth | **Absent** | UI “Purchase Agreements” = requisition; `ExclusiveMode` is award exclusivity string, not blanket contract |
| Purchase contracts | **Absent** | No purchasing contract table (contrast sales `sale_contract` MVP) |
| PO draft / send / confirm / cancel | **Present** | Reducers + UI + approval gate on send/confirm; e2e confirm |
| PO line CRUD | **Present** | Add/update/remove + UI |
| PO lock / unlock | **Present** | Reducers + BFF + UI (audit missing — see invariants) |
| Inventory receipt on confirm | **Absent** | `confirm_purchase_order_impl` sets state only; no IN picking create |
| Qty receipt on PO | **Partial** | `receive_po_line` updates `qty_received` + receipt_status; **no quant/move** |
| Atomic receipt + commitment | **Unsuitable** (for stock) | Qty and stock can diverge; seed pickings are fixture-only |
| Bill from PO | **Present** | `create_bill_from_purchase_order` bills `qty_received - qty_invoiced` |
| Three-way match (qty) | **Present** | Post `InInvoice` with `PO{id}` origin blocked when billed > received/ordered + tol (`0.001`) |
| Three-way match (price / tolerance policy) | **Absent** | No price variance tolerance; fixed qty epsilon only |
| Match state productization | **Partial** | `compute_line_match_state` unused server-side; client duplicate; no persisted match column / queue |
| Partial receipt / bill exceptions | **Partial** | Partial receive + bill e2e; no Ops exception queue for over/under |
| Vendor bill → payment | **Partial** | Standard AP payment path in accounting; no purchasing residual/drill-down parity with sales SO paid fields |
| Purchasing budgets / encumbrance | **Absent** | Accounting budgets ≠ PO commitment at confirm |
| Vendor approvals / intake | **Present** | Supplier intake + review/approve/reject/hold + UI |
| Delegation | **Absent** | No purchasing delegation / substitute approver model |
| Durable approval histories | **Partial** | Workflow approval requests for PO send/confirm; requisition approve bypasses `gate_action_with_approval` |
| Vendor scorecards | **Absent** | Only `supplier_rank` bump on confirm |
| Lead-time analytics | **Absent** | Dashboard “Avg Lead Time” replaced by pending counts; on-time chart empty |
| Supplier risk | **Absent** | No risk scoring / holds beyond intake |
| Drop shipment (SO-driven) | **Partial** | Sales creates draft POs; purchasing UI does not specialize dropship lifecycle |
| Consignment | **Absent** | No consignment ownership / stock rules |
| Purchase returns | **Absent** | No vendor RMA / return-to-vendor; sales RMA is customer-side |
| Landed costs | **Present** | Create → compute → post → apply to quant value |
| Multi-currency / FX on PO | **Partial** | `currency_id` on PO/line; **no** PO FX snapshot field/test |
| Withholding tax on AP | **Partial** | Country-pack WHT tax seeds; not wired as purchasing AP withhold lifecycle |
| Import duties / customs docs | **Partial** | Landed costs can model duty amounts; no customs intent/adapter |
| Local vendor identifiers | **Partial** | Partner/company ID meta in packs; intake fields limited |
| Cross-border procurement | **Partial** | Incoterm fields on PO; no commercial/customs packet |
| Commodity-price volatility | **Absent** | No indexation / hedge / price-escalation on PO lines |
| Live spend subscriptions | **Partial** | Org-scoped PO SQL; Spend MTD client-derived; no commitment ledger feed |
| Exception queues (live) | **Absent** | No purchasing Ops; no bounded SQL keys |
| Audit coverage | **Partial** | Core PO lifecycle mostly audited; lock/unlock, add/update line, compute totals, receipt/invoice status, some intake/landed mutators missing `write_audit_log_v2` |

---

## 3. Required invariants

### Accounting

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Bill qty ≤ received / ordered | Yes (post) | `validate_in_invoice_three_way_match` + `validate_three_way_match_po_lines` | Price tolerances; configurable tolerance per company |
| Receive before bill (happy path) | Partial | Bill create uses `qty_received > qty_invoiced` | Prevent silent qty-only receive without stock when inventory policy requires it |
| Immutable FX snapshot | No (PO) | No `currency_rate` on PO | Snapshot at confirm/bill; consume on post |
| Landed cost valuation | Partial | `apply_landed_costs` adjusts quant value | Link to bill/duty lines; period lock |
| Budget / commitment | No | Budgets actualize on journal, not PO confirm | Encumbrance at confirm; release on cancel/bill |
| Period locks | Partial | Accounting close elsewhere | Block receive/bill/post when locked |
| Purchase returns / credit | No | Absent | Vendor return → stock out → AP credit note |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Reducer permissions | Yes (pattern) | `check_permission` on purchasing resources | Audit every landed/intake mutator |
| Tenant / company ownership | Partial | Org + company on create; guards on update paths vary | Isolation tests company A vs B |
| Approval SoD (PO) | Partial | Workflow gate on send/confirm; resume via approvals | Purchasing Ops Approve/Reject UI (Sales-style) |
| Requisition approve | Partial | Permission `"approve"` only — not workflow gate | Align with durable approval history |
| Delegation | No | Absent | Substitute approver + audit |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Append-only mutation log | Partial | Most PO/requisition/intake/landed paths | Close gaps: lock/unlock, add/update line, compute*, status updates, intake update/delete, landed update/delete |
| Approval history | Partial | Workflow requests for gated PO actions | Surface timeline in Purchasing UI; requisition via gate |
| Source-document links | Partial | `invoice_origin = PO{id}`; line invoice_ids; picking_ids often empty | PO → picking → move → bill → payment drill-down |

### Concurrency / inventory

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Atomic PO confirm | Yes (state) | Single reducer; approval gate | Optionally create IN picking in same txn |
| Atomic stock receipt | **No** | `receive_po_line` qty-only | Single reducer: qty + picking validate / quant receive |
| Stale-state rejection | Partial | State preconditions on confirm/cancel/send | Idempotency for bill create/post retries |
| Three-way fail closed | Yes | Post rejects over-bill | Domain test + e2e (e2e exists) |
| No client multi-step commit | Intent | Approval resume server-side | Never orchestrate receive+bill+post across optimistic client steps without server guards |
| Live exception queues | No | Client dashboard counts only | Bounded subscriptions for ToApprove / over-billed / partial receipt |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). External HTTP belongs in procedures/workers, not reducers.

---

## 4. Reference workflows

1. **Requisition create → submit → approve** — Present at state-machine depth; no auto PO generation.
2. **RFQ / tender compare** — **Not implemented** (Absent).
3. **Draft PO + lines → send → confirm** — Present; may enter `ToApprove` via workflow gate.
4. **Lock / unlock** — Present (reducers + UI).
5. **Receipt** — Qty path Present; stock path **missing** (Unsuitable for inventory-accurate P2P).
6. **Partial receipt → bill → match** — Present for qty; e2e covers Matched + post.
7. **Over-bill → post blocked** — Present; e2e asserts `/three-way match failed/i`.
8. **AP payment** — Accounting path; purchasing residual UX thin.
9. **Supplier intake SoD** — Intake approvals Present; not the same as PO workflow SoD UI.
10. **Landed cost post/apply** — Present reducers + UI.
11. **Dropship SO → draft PO** — Backend Present (sales); purchasing specialization Partial.
12. **Purchase return** — **Not implemented**.
13. **Cross-company isolation** — Org filters; dedicated purchasing isolation tests **missing**.
14. **Live spend / exceptions** — Client dashboard Partial; server queues Absent.
15. **Cross-border WHT / duties** — Pack seeds + landed costs Partial; adapters stubs.
16. **Tolerance edges** — Fixed `0.001` qty epsilon; price variance Absent.
17. **Budget commitment** — Absent at PO confirm.
18. **Blanket / contract** — Absent.

### Acceptance scenarios (18)

1. Create Draft PO with partner, currency, payment terms, and lines; totals = untaxed + tax; audit CREATE.
2. Send PO → `Sent` or `ToApprove` per approval rule; second confirm without approval fails; approver resume → `Purchase` (SoD).
3. Confirm PO → state `Purchase`, `date_approve` set, `supplier_rank` bumped; **and** (target) draft IN picking + moves linked by PO line — **stock half fails today**.
4. Lock PO blocks unsafe update/confirm/line edits; unlock restores; audit SET_ACTIVE/UPDATE (target: audit today missing on lock).
5. `receive_po_line` for partial qty updates `qty_received` and `receipt_status`; stock quants increase **or** explicit policy that inventory uses picking validate only (must be one documented path).
6. `create_bill_from_purchase_order` creates `InInvoice` for unbilled received qty with `invoice_origin = PO{id}`; line `qty_invoiced` increases.
7. Post bill when billed ≤ received + tol succeeds and balances; GL lines correct.
8. Force over-bill (`invoice_po_line` / manual) → line match `over_billed` → `post_invoice` fails closed with three-way error.
9. Cancel uninvoiced PO → `Cancelled`; open receipts/commitments released per policy.
10. Approved requisition can spawn PO (target; **missing** convert reducer) with `purchase_ids` linkage.
11. Multi-vendor tender: collect ≥2 quotes, compare, award, create PO (target; **Absent**).
12. Supplier intake: submit → review → approve by non-requester; reject/hold with reason; audit.
13. Landed cost: link pickings → compute → post → apply updates quant cost/value; audit.
14. Dropship SO confirm creates draft PO(s) with `origin` dropship marker and `sale_order_id` / line links; no warehouse OUT reserve on SO.
15. Company B cannot confirm/receive/bill company A’s PO.
16. Multi-currency PO stores FX snapshot used on bill post; report drills PO → picking → move → bill → payment.
17. Subscription clients see live ToApprove / partial-receipt / over-billed / spend-commitment queues without polling (target: server-bounded filters).
18. Purchase return for received qty → stock out → AP credit note → match residual (target; **Absent**).

---

## 5. Localization matrix (purchasing / AP–relevant)

Country packs today are **tax-seed + company-ID metadata** (`spacetimedb/src/core/country_pack.rs`). Purchasing still needs AP overlays (withholding at payment, import duty classification, vendor tax IDs, cross-border document procedures). Pack metadata flags such as `nfe_adapter` / `e_invoice` are **stubs**, not live integrations.

**i18n:** Purchasing UI strings ship under English locale (`en.json` includes `purchaseAgreements.*` and purchasing form keys). Country packs are not language packs.

Rates and rules below are **dated requirements as of 2026-07-16**, cited from official sources where linked — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA only in-tree) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|-----------------------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` only | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| VAT/GST seed | GST-AU 10%; GST-NZ 15% | VAT-ZA 15% | ICMS/IVA seeds | GST/SST/PPN/VAT seeds |
| Withholding | PAYG/WHT regimes vary by payment type — **not** purchasing-wired | WHT-ZA 20% seed | IRRF-BR seed | Local WHT on services/imports — pack-thin |
| Import duties | Customs value + GST on imports (ATO / NZ Customs) | SARS Customs | Siscomex / Mercosur | High import intensity; duties via landed cost Partial |
| Vendor identifiers | ABN / NZBN on supplier | VAT number | CNPJ / CUIT / RUT | UEN (SG); TIN variants |
| Cross-border docs | Commercial invoice / COO | SADC / deep-sea docs | NF-e / import DI | ASEAN + import permits |
| Commodity volatility | Soft commodity / fuel indexation common in contracts | Mining inputs | Agri / FX-linked ARS | Palm, electronics, FX |
| Purchasing pack gap | WHT at payment + ABN on bill PDF | WHT certificate on AP | Import DI + NF-e inbound **outside** reducers | E-invoice inbound as **procedures/workers**; duty codes |

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

Quality benchmark for integrated procure-to-pay controls: Oracle NetSuite purchasing / SuiteSuccess operational patterns ([NetSuite documentation](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/)). Architecture constraints from SpacetimeDB: reducers are automatically transactional; procedures are the HTTP boundary ([SpacetimeDB Functions](https://spacetimedb.com/docs/functions/); [Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Subscription semantics](https://spacetimedb.com/docs/subscriptions/semantics)).

| Topic | Decision |
|-------|----------|
| **Atomic mutations** | Keep PO confirm, receipt commitment, stock receive (when required), bill create qty bump, and three-way match rejection in **single reducers** (or one internal `*_impl`) wherever atomicity is required. Prefer `receive_po_line` (or a successor) to update PO qty **and** inventoriable stock in one transaction — do not leave stock sync to a client second step. |
| **Confirm vs receive** | Either (a) confirm creates draft IN picking and validate/receive moves quants while updating `qty_received`, or (b) document qty-only receive as non-inventory service PO policy. Dual paths must be explicit; today’s silent split is Unsuitable for stocked products. |
| **Preconditions / idempotency** | Enforce state preconditions on send/confirm/cancel/receive/bill. Add idempotency keys for repeated bill create/post and external customs/payment callbacks. |
| **Subscriptions** | Prefer company-filtered and **bounded exception** subscriptions (`state = ToApprove`, partial receipt, over-billed lines, open spend commitments). Wire `landed-costs` / `supplier-intakes` into `ERP_ORG_SQL`. Avoid deriving all queues solely from full-table client filters. |
| **Indexes** | Index tenant, company, state, partner, order, picking, and invoice-origin lookup paths. Index names must remain unique module-wide. |
| **External I/O** | Customs, tax-authority e-invoice inbound, payment-provider, and commodity-price feeds go behind **API workers / procedures** with durable intents/results. Reducers must not block on HTTP. |
| **Statutory adapters** | Treat pack `nfe_adapter` / `e_invoice` / IRAS metadata as **stubs**. |
| **Match** | Keep fail-closed qty match on `post_invoice`; persist or expose `compute_line_match_state` server-side; add configurable price/qty tolerances before claiming competitive 3-way match. |
| **Approvals** | Keep PO send/confirm behind `gate_action_with_approval`; align requisition approve with durable workflow history; add Purchasing Ops SoD UI. |

---

## 7. Priority classification (remaining gaps)

Snapshot after 2026-07-16 purchasing gap-fix waves (A–D). Tracker: [purchasing-p2p-gap-fixes-plan.md](./plans/purchasing-p2p-gap-fixes-plan.md).

### Pilot-critical

| Gap | Status | Notes |
|-----|--------|-------|
| Atomic inventory receipt | **Closed in-tree** | Confirm → IN picking; `receive_po_line` → validate → quants + `qty_received` |
| Company isolation tests | **Closed in-tree** | `run_purchasing_company_isolation_test` |
| Audit gaps (lock/lines/status/intake/landed) | **Closed in-tree** | Wave A audit sweep |
| `landed-costs` / `supplier-intakes` ERP_ORG_SQL | **Closed in-tree** | Live org SQL wired |
| P2P e2e + domain suite after publish | **Verify** | `run_all_purchasing_tests`; Playwright `mvp-procure-to-pay` |
| Header update unused in UI | **Closed in-tree** | `useUpdatePurchaseOrder` wired |

### Competitive

| Gap | Status | Notes |
|-----|--------|-------|
| True RFQ + tender comparison | **MVP in-tree** | `sourcing.rs` + Ops prompts |
| Requisition → PO conversion | **Closed in-tree** | `convert_purchase_requisition_to_po` |
| Purchase returns (vendor RMA) | **MVP in-tree** | `purchase_returns.rs` + vendor credit stub |
| Purchasing budgets / encumbrance | **Partial** | Metadata encumbrance on confirm; no budget ledger release |
| Configurable qty/price tolerances | **Partial** | Per-PO qty tol + price constant; price post-enforcement deferred |
| Match state + exception queues | **Closed in-tree** | Persisted `match_state`; `purchase-orders-to-approve` / `partial-receipt` |
| Purchasing SoD approve UI | **Closed in-tree** | `purchasing-ops-sod.tsx` |
| Dropship purchasing UX | **Closed in-tree** | Origin/SO badge on PO list |
| FX snapshot on PO | **Closed in-tree** | `currency_rate` on confirm |
| WHT on AP payment | **Partial** | Metadata breakdown on payment move; no liability JE |
| Lead-time / on-time analytics | **MVP in-tree** | Dashboard on-time from `date_planned` |

### Differentiating

| Gap | Status | Notes |
|-----|--------|-------|
| Blanket orders / purchase contracts | **MVP in-tree** | `procurement_advanced.rs` |
| Vendor scorecards + supplier risk | **MVP in-tree** | Scorecard + risk flag reducers |
| Consignment purchasing | **MVP in-tree** | Agreement create |
| Delegation / substitute approvers | **MVP in-tree** | `purchase_approval_delegate` |
| Commodity-price indexation | **MVP in-tree** | Index set reducer |
| Cross-border integration observability | **MVP in-tree** | Intent + result |
| Advanced landed-cost / duty classification | **Open** | HS/duty codes still polish |

**Still open for polish:** binding regenerate/publish, Playwright re-run, price-variance bill post, encumbrance ledger release, full WHT JE, dedicated entity tabs for RFQ/returns/advanced (prompt MVP today).

---

## Bottom line

Lumiere’s P2P spine is now **receipt-and-match strong at MVP depth**: PO confirm creates IN pickings, `receive_po_line` posts stock and qty atomically, and qty three-way match remains fail-closed on bill post. Gap-fix waves added RFQ/tender, vendor returns, SoD/exception queues, FX, and differentiating procurement tables. Remaining polish is price-variance enforcement, real encumbrance/WHT ledgers, entity UIs beyond Ops prompts, and verification after publish.

### Related docs

- [Sales & Order Management investigation](./SALES_ORDER_MANAGEMENT_INVESTIGATION.md) — dropship PO adjacency; Ops/SoD pattern mirrored
- [Accounting NetSuite gap](./ACCOUNTING_NETSUITE_GAP.md) — AP/posting/bill adjacent
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — wedge B procure-to-pay (claims reconciled in Verdict)
- Investigation brief: [purchasing-procurement-investigation-refresh-plan.md](./plans/purchasing-procurement-investigation-refresh-plan.md)
- Gap-fix tracker: [purchasing-p2p-gap-fixes-plan.md](./plans/purchasing-p2p-gap-fixes-plan.md)
- Purchasing module: `spacetimedb/src/purchasing/`
- Purchasing workspace: `frontend/packages/stdb/src/subscriptions/purchasing-workspace.ts`
- Domain tests: `spacetimedb/tests/purchasing/` (`run_all_purchasing_tests`)
- E2E: `frontend/web/tests/e2e/mvp-procure-to-pay.spec.ts`
