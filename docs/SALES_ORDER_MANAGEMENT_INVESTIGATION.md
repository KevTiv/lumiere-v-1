# Sales & Order Management Investigation — Quote-to-Cash

Status snapshot of Lumiere sales / order management against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, i18n, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-15

**Implementation status (2026-07-15):** Pilot-critical OMS integrity wired in-tree:
- Confirm reserves quants at warehouse `lot_stock_id` (services / dropship skip)
- Validate applies quant consume/receive
- Cancel releases open pickings + unreserves (blocks invoiced cancel)
- Company-scoped live SQL for carriers / price rules / shipping methods / POS payment methods
- Domain tests cover reserve, deliver qty effect, cancel release
- Seed + harness set `lot_stock_id` and on-hand quants so ATP can succeed

**Verdict:** Lumiere has a credible **MVP lead-to-cash spine** — Draft SO → optional discount approval → confirm (draft OUT picking + **hard reservation**) → validate (**quant move**) → invoice → payment, plus **MVP RMA → receive → credit note**. Schema is Odoo-wide (dropship, backorder, pricelist formulas, Incoterms, shipping policies); fulfilment policies / dropship orchestration / CPQ remain thin. Against the quality bar it is **stronger** on commitment transactionality, **partial** on pricing/approvals/returns policies, and **absent** on CPQ, exchanges, commissions, promotions, and live exception queues.

---

## 1. Verified inventory

### 1.1 Tables (backend `spacetimedb/src/sales` + adjacent)

| Area | Tables | Status |
|------|--------|--------|
| Sales core | `SaleOrder`, `SaleOrderLine`, `SaleOrderOption` | Present (`SaleOrderOption` has **no reducers**) |
| Returns | `ReturnOrder`, `ReturnOrderLine` | Present (MVP RMA) |
| Pricing | `ProductPricelist`, `ProductPricelistItem` | Present (CRUD; **not applied** on SO line create) |
| Delivery master | `StockPickingBatch`, `DeliveryCarrier`, `DeliveryPriceRule`, `ShippingMethod` | Present |
| POS | `PosConfig`, `PosPaymentMethod`, `PosLoyaltyProgram`, `PosSession`, `PosOrder`, `PosOrderLine`, `PosPayment`, `PosLoyaltyCard` | Present (retail; not B2B OMS) |
| Inventory (adjacent) | `StockPicking`, `StockMove`, `StockQuant` (`reserved_quantity`) | Present; backorder FKs **schema-only** |
| Accounting (adjacent) | `AccountMove` / lines, `AccountPaymentTerm` (+ lines), `PartnerCreditControl` | Present; credit gate on **invoice post**, not SO confirm |
| CRM bridge | Opportunity → SO via `convert_opportunity_to_sale_order` | Present |
| Workflow | Approval gate on SO confirm (discount/amount context) | Present |

**Schema notes (wide but thin)**

- Header flags `is_dropship`, `dropship_picking_*`, `purchase_order_ids`, free-form `incoterm` / `incoterm_location`, `shipping_policy` / `picking_policy`, `credit_amount` — stored; confirm **does not** honor dropship/policies or credit.
- Line availability fields (`qty_at_date`, `virtual_available_at_date`, `free_qty_today`) initialized; **never updated** by sales reducers.
- `SaleState::Sent` / `Done` exist; **no reducer assigns Sent or Done**.
- Picking `backorder_id` / `backorder_ids` exist; UI checkbox for create-backorder is **disabled**.

### 1.2 Reducers (verified callable surface)

**Orders:** `create_sale_order`, `update_sale_order` (Draft/Sent headers), `create_sale_order_line`, `confirm_sales_order`, `cancel_sale_order`, `compute_so_totals`

**Returns:** `create_return_order`, `confirm_return_order`, `cancel_return_order`, `create_credit_note_from_return_order`  
(`UpdateReturnOrderParams` exists; **no update reducer**)

**Pricelists:** `create_pricelist`, `update_pricelist`, `delete_pricelist`, `create_pricelist_item`, `delete_pricelist_item`

**Delivery:** `create|start|complete|cancel_picking_batch`, `create_delivery_carrier`, `create_delivery_price_rule`, `create_shipping_method`

**POS:** config/session/order/loyalty reducers (separate `/pos` runtime)

**Adjacent oms-critical:** `create_invoice_from_sale_order`, `post_invoice` (+ `ensure_partner_credit_allows_invoice`), stock picking confirm/assign/validate/`done_stock_move`, `reserve_stock_quant` / `unreserve_stock_quant` / `move_stock_quant` (manual; **not** wired from SO confirm/validate), `convert_opportunity_to_sale_order`, payment reconcile updating SO `amount_paid` / `amount_residual`

**Missing / unused:** send quotation, apply pricelist to lines, allocate/reserve on confirm, create backorder, dropship→PO, exchange order, commission settle, promotion/coupon engine (POS `coupon_id` field only), `SaleOrderOption` CRUD

### 1.3 Subscriptions & queries

`SALES_WORKSPACE_RESOURCE_KEYS` (`frontend/packages/stdb/src/subscriptions/sales-workspace.ts`):

| Key | Live org SQL | Notes |
|-----|--------------|-------|
| `sale-orders`, `sale-order-lines` | Yes | Core OMS |
| `return-orders`, `return-order-lines` | Yes | RMA |
| `pricelists`, `pricelist-items` | Yes | Pricing master |
| `picking-batches` | Yes (company) | Batching only |
| `account-payment-terms` | Yes | Via sales workspace |
| `pos-loyalty-programs`, `pos-loyalty-cards` | Yes | Loyalty master |
| `delivery-carriers`, `delivery-price-rules`, `shipping-methods`, `pos-payment-methods` | **Keys listed; no ERP SQL builders** | Effectively **BFF-only** |

Fulfillment/invoices use inventory + accounting hooks outside the sales live set (`stock-pickings`, `account-moves`). **No** subscription-backed exception queues (credit hold, approval pending, backorder, ATP shortfall).

### 1.4 UI operations (`sales-client` + hooks)

| Tab / surface | Operations |
|---------------|------------|
| Dashboard | MTD revenue / orders-by-state KPIs; quick create SO / pricelist / delivery |
| Orders | Create draft; confirm (Draft/Sent); cancel; recompute totals; create invoice; PDF; lock/unlock; CSV; chatter |
| Order lines | Create line; CSV |
| Pricelists / items | Create; activate/deactivate; delete |
| Deliveries | Picking-batch lifecycle |
| Fulfillment | Confirm / assign / validate / **partial validate** / cancel picking (`createBackorder` UI **disabled**) |
| Returns | Create RMA → confirm → receive → credit note → cancel |
| Invoices | OutInvoice list + recalculate totals |
| Carriers / price rules / shipping / POS masters | Create-oriented entity tabs |

**Hooks exist, UI missing:** `useUpdateSaleOrder`, line update/delete (asserted by `sales-mutations.spec.ts`). **No** send-quote, approve-from-UI for `ToApprove`, credit-hold queue, or SO edit form.

### 1.5 Tests

| Layer | Coverage |
|-------|----------|
| Domain | `run_all_sales_tests`: confirm→invoice, confirm→delivery qty, draft header update |
| E2E | `mvp-lead-to-cash`, `mvp-sales-returns`, `mvp-invoice-correction`, `sales-mutations`, `sales-invoice-flow` |
| CRM bridge | Opportunity → SO in CRM domain tests |

**Not covered:** cancel with open picking, hard reservation/ATP fail, dropship, backorder, SO-level credit, pricelist application, multi-currency FX, approval resume UI, partial delivery financials, exchange, commission.

---

## 2. Gap matrix (quality bar vs inventory)

| Capability | State | Notes |
|------------|-------|-------|
| Quote document lifecycle | **Partial / unsuitable** | Single `sale_order` entity; `validity_date` + Draft; **Sent never set**; no customer-accept / portal |
| Order confirmation | **Present** | Draft/Sent/ToApprove → Sale; creates draft OUT picking |
| CPQ / configuration | **Absent** | `SaleOrderOption` shell only |
| Sales contracts | **Absent** | Subscriptions/HR contracts ≠ commercial SO contracts |
| Credit checks | **Partial** | `PartnerCreditControl` on **invoice post**; not on confirm; SO `credit_amount` unused |
| Approvals | **Partial** | Discount/amount gate → `ToApprove`; resume via workflow; **no sales UI approve** |
| Pricing rules | **Partial** | Pricelist item Fixed/%/Formula CRUD; line `price_unit` is caller-supplied |
| Promotions / coupons | **Absent** | POS `coupon_id` field only |
| Allocation / ATP | **Partial** | Confirm reserves make-to-stock qty at `lot_stock_id`; soft line availability fields still unused |
| Split fulfilment | **Partial** | Partial validate UI; one picking per confirm; policies unused; no multi-warehouse split |
| Drop shipment | **Unsuitable** | Flags skip reserve; **no** PO / dropship picking generation |
| Backorders | **Unsuitable** | Schema + disabled UI; validate does not spawn backorder |
| Cancellations | **Partial** | SO cancel → Cancelled + open picking cancel + unreserve; blocked if invoiced |
| Exchanges | **Absent** | |
| Returns / RMA | **Present** (MVP) | Confirm → return picking → credit note; receive updates quants |
| Commissions | **Absent** | |
| Multichannel / POS → SO | **Partial** | POS separate runtime; not B2B OMS / marketplace routing |
| Multi-currency | **Partial** | `currency_id` on SO/lines/pricelist; **no FX snapshot** on confirm |
| Tax incl/excl | **Partial** | Tax `price_include` + line tax fields; fiscal position stored **not remapped** |
| Incoterms | **Partial** | Free-form on SO; invoice gets location only (`invoice_incoterm_id: None`) |
| Payment terms | **Present** | FK on SO → copied to invoice |
| Cross-border docs | **Absent** | No commercial invoice / packing list / customs packet from sales |
| Exception queues (live) | **Absent** | Dashboard = KPI charts, not ops workbench |
| Quant movement on deliver | **Present** | `validate_stock_picking` consumes reserved / transfers quants |

---

## 3. Required invariants

### Accounting

- Confirm may mark lines billable (**invoice-on-order** today); delivery-based invoicing must not double-bill — `qty_to_invoice` / `qty_invoiced` must stay consistent with posted `OutInvoice` / credit notes.
- Credit notes from RMA require `state == received` and must link `credit_move_id`; posting credit notes must reverse revenue/COGS per accounting policy (not status-only).
- Partner credit hold must block **commitment that creates AR exposure** (today: post invoice; target bar: confirm *or* invoice depending on policy, never silently create uncollectible AR).
- Payment reconcile updating SO `amount_paid` / `amount_residual` must match posted allocations on linked moves.
- Cancel/return after invoice requires financial compensation (credit note / reversing entry) — cancel alone is insufficient once invoiced.

### Authorization

- Every sales reducer: `check_permission` on `sale_order` / related resources with action (`create`, `confirm`, `cancel`, …).
- Company ownership: `company_id_from_scope` / org scope on order; **strengthen** company guard on confirm/cancel (today org-scoped without explicit `company_id` param on confirm).
- Field policy / SoD: approval gate actors ≠ requester; credit-control upsert permission distinct from sales confirm.
- Cross-tenant: org filter on all sales SQL subscriptions; company filter on pickings/returns.

### Audit

- Mutations end with `write_audit_log_v2` (CREATE/UPDATE/confirm/cancel/refund paths). Close gaps: pricelist updates beyond create, POS config/session mutations, pure `compute_so_totals` if kept as mutator.
- Cancel reason (optional) → audit metadata; approval request ids linked from `ToApprove` transitions.

### Concurrency / inventory (SpacetimeDB)

- **Atomic commitment:** confirm must either (a) hard-reserve quants + create picking moves in one reducer, or (b) explicitly fail closed on ATP shortfall — never leave “Sale” without a reservation policy decision.
- **Validate must move inventory:** `validate_stock_picking` (or a dedicated sales deliver reducer) must call `move_stock_quant` / equivalent so quantity_done has warehouse consequences.
- Cancel before delivery must unreserve and cancel open pickings/moves in the **same transaction**; cancel after partial delivery requires backorder/residual policy.
- Partial delivery: done qty + residual backorder (or cancelled remainder) must both exist as rows, not only reduced `quantity_done`.
- Subscriptions drive **exception queues**; clients must not invent local “reserved” state.
- No client-orchestrated multi-step confirm (approval resume stays server-side via `confirm_sales_order_impl(..., skip_approval_check=true)`).

---

## 4. Reference workflows

1. **Quote → order** → Draft SO (+ validity) → [send] → customer accept → confirm → Sale + reservation + OUT picking
2. **CRM win** → opportunity convert → SO → confirm → fulfill → invoice → pay (MVP e2e)
3. **Approval** → high discount confirm → `ToApprove` → approver resume → Sale
4. **Credit hold** → partner over limit → confirm or invoice blocked; queue for credit clerk
5. **Split / partial ship** → validate partial qty → backorder residual → subsequent ship → invoice per policy
6. **Dropship** → SO line dropship → auto PO → vendor ship → customer receipt → invoice without own stock
7. **Cancel pre-delivery** → cancel SO + cancel picking + unreserve (atomic)
8. **Return** → RMA → receive → credit note → post (MVP e2e)
9. **Exchange** → return + replacement SO linked (future)
10. **Commission** → confirmed invoiced sale → accrue commission by rule (future)

### Acceptance scenarios (≥10)

1. Create Draft SO with lines, payment terms, currency, tax IDs; totals match untaxed + tax; audit CREATE.
2. Confirm Draft → state `Sale`, draft OUT picking + moves linked by `sale_line_id`, and **reserved_quantity** increased (or explicit ATP fail).
3. Validity-expired SO cannot confirm.
4. Max line discount over policy → `ToApprove`; second confirm without approval fails; approval resumes to `Sale`.
5. Partner with payment hold / over credit limit cannot post (and, when implemented, cannot confirm) invoice/order; exception visible in queue.
6. Validate assigned picking → move/picking done, **quants relocated**, `qty_delivered` updated; invoice/residual qty correct.
7. Partial validate short qty → residual backorder picking created **or** explicit cancel remainder; UI not status-only.
8. Cancel confirmed SO with open picking → SO Cancelled, picking cancelled, reservation released; no orphan moves.
9. Create invoice from Sale → linked `OutInvoice`; post blocked if credit control fails; payment updates SO residual.
10. RMA for delivered qty → confirm → receive → credit note → post; delivered qty reduced; AR reduced.
11. Cancel RMA after receive/refund attempted fails closed.
12. Dropship flagged line (once built) creates PO and never reserves own warehouse qty.
13. Company B cannot confirm/cancel company A’s SO (cross-company isolation).
14. Multi-currency SO stores rate/snapshot used on invoice post; report drills SO → picking → move → invoice → payment.
15. Tax-inclusive price (`price_include`) yields correct net/tax; fiscal position remaps taxes when set (once wired).
16. Subscription clients see live `ToApprove` / credit-hold / backorder queues without refresh polling.
17. Pricelist item with min qty / date range applied automatically on line create when `pricelist_id` set (once wired).

---

## 5. Localization matrix (sales / order–relevant)

Country packs today are **tax-seed + company-ID metadata**. Sales needs commercial overlays (tax display, payment norms, e-invoicing, Incoterms practice).

| Concern | Oceania (AU/NZ) | Southern Africa (ZA+) | Brazil / Southern Cone (BR/AR/CL) | Maritime SEA (SG/MY/ID/PH/TH) |
|---------|-----------------|------------------------|-----------------------------------|--------------------------------|
| Tax on price | GST 10%/15% typically **exclusive** B2B; retail may incl | VAT 15% exclusive common; retail incl | ICMS/IVA complex; BR NFe; often price + tax separate | GST/SST/PPN/VAT; SG/MY e-invoice adapters in pack meta |
| Pack tax seed | GST-AU, GST-NZ | VAT-ZA (+ WHT) | ICMS/IRRF BR; IVA AR/CL | GST-SG; SST-MY; PPN-ID; VAT-TH/PH |
| Currency | AUD/NZD | ZAR | BRL/ARS/CLP (inflation_mode optional on BR/AR) | SGD/MYR/IDR/PHP/THB |
| Payment terms | 7/14/30 EOM; BAS timing AU | 30 days common; mobile-money settlement ops | Often installment + indexation sensitivity | 30 days; LC/trade finance for import-heavy |
| Tax-inclusive retail | POS `iface_tax_included` path | Same | Consumer invoices; B2B NFe | Consumer GST-incl; B2B exclusive |
| Incoterms / trade | Export common; free-form Incoterm field today | Regional + deep-sea | Mercosur / Pacific trade docs | High import dropship volume — dropship quality critical |
| Cross-border docs | Commercial invoice + COO | SARS / SADC docs | NFe / fiscal docs (`nfe_adapter` meta) | IRAS / Peppol MY / Coretax ID (`e_invoice` meta) |
| Credit / collections | Standard AR aging | High mobile-money remittance | Inflation → frequent price list revision | Distributor credit common |
| Pack gap for OMS | GST display + ABN on invoice PDF | VAT + WHT on credit notes | NFe outbound **outside** reducer; fiscal position map | E-invoice adapters as **procedures**, not reducers |

**i18n:** Sales UI uses `sales.*` keys in `en.json`; many dashboard/create labels still English-hardcoded. Region packs do not yet drive tax picker, Incoterm catalogs, or default payment terms on SO create.

---

## 6. SpacetimeDB architecture decision (Sales OMS)

| Topic | Decision |
|-------|----------|
| **Transactions** | Keep quote→confirm→reserve→picking creation in **one reducer** (or a single internal `confirm_*_impl`). Returns: confirm RMA + return moves atomic; credit note separate but only from `received`. Never split reserve across client round-trips. |
| **Subscriptions** | Expand live SQL for carriers/price-rules/shipping/POS payment methods (keys already listed). Add **materialized exception views** or filtered subscriptions: `sale_orders WHERE state=ToApprove`, open pickings with shortfall, credit-hold partners, RMAs awaiting receive. Keep stock pickings in inventory workspace but compose on fulfillment tab. |
| **Isolation** | Org filter on every sales SQL; company filter on SO/returns/pickings. Confirm/cancel should take or derive `company_id` and enforce ownership like create/update. |
| **Scale** | Index paths: org/company/partner/state on `sale_order`; `order_id` on lines; picking by sale/company. Avoid full-table scans for availability — use quant indexes + bounded ATP checks inside confirm. Do not recompute all open-order ATP on every subscription tick. |
| **Reservation model** | **Pilot-critical:** on confirm, call `reserve_stock_quant` (or fail) for make-to-stock lines; link reserved qty to moves. Dropship/MTO lines skip own-warehouse reserve and spawn purchasing obligations. |
| **Delivery integrity** | `validate_stock_picking` must invoke quant move (or dedicated reducer used only after quant move succeeds). Partial validate creates backorder picking in-transaction. |
| **External-service boundary** | Reducers: pricing resolve, reserve, approvals, document state, audit. **Procedures/API workers:** carrier rating HTTP, payment gateway, NFe/Peppol/Coretax submission, freight booking, marketplace connectors. Store provider shipment/invoice IDs on picking/move rows; never block reducers on HTTP. |
| **FX / tax** | Snapshot rate + tax computation results onto SO/invoice lines at confirm/invoice time (immutable for audit); pack-driven tax tables already exist — wire fiscal position remapping inside sales/invoice reducers. |

---

## 7. Priority classification

### Pilot-critical

- ~~Keep lead-to-cash e2e green (CRM → SO → fulfill → invoice → pay)~~ (preserve)
- ~~Keep RMA → credit note e2e green~~ (preserve)
- ~~**Wire quant reserve on confirm + quant move on validate**~~ **Done**
- ~~Cancel SO releases pickings/reservations when uninvoiced~~ **Done**
- Credit control remains enforced on invoice post; surface failures in UI *(UI surfacing deferred)*
- Company/org isolation on SO confirm/cancel *(cancel enforces company via order + pickings)*
- ~~Sales subscription SQL builders for listed logistics keys~~ **Done**
- Approval gate remains server-side; add minimal approve action in UI or document Workflow as sole path *(unchanged — Workflow path)*

### Competitive

- ~~Apply pricelist items on line create~~ **Done** (`resolve_unit_price` when `price_unit` is None)
- ~~SO edit UI~~ **Done** (header fields: client ref / note / Incoterms); line update/delete hooks already existed
- ~~Quote send (`Sent`)~~ **Done** (`send_sale_order_quotation` + UI); expiry UX still thin
- ~~Backorder creation on partial validate~~ **Done** (`validate_stock_picking_backorder`; UI create-backorder enabled)
- ~~SO-level credit check on confirm~~ **Done** (`ensure_partner_credit_allows_invoice` before confirm)
- Tax fiscal-position remapping; Incoterm id parity with PO/invoice
- ~~Exception queues via subscriptions~~ **Done** (dashboard live queue strip; sales workspace subscribes `partner-credit-controls` + `stock-pickings`)
- ~~Multi-currency rate snapshot on confirm~~ **Done** (rate written into SO `metadata` at confirm; fail closed when currencies differ and no `currency_rate`)
- ~~Domain tests for cancel, ATP fail, credit hold, pricelist apply, send quote, backorder~~ **Done** (`run_all_sales_tests`)
- Quote expiry: `is_expired` set when send/confirm hits past `validity_date`

### Differentiating

- True dropship orchestration (SO → PO → vendor ship → customer)
- CPQ / configurable products (`SaleOrderOption` → real engine)
- Promotions engine (not only POS coupons)
- Exchange orders with linked RMA + replacement
- Commission accrual + partner settlement
- Multichannel fulfilment routing (POS / web / marketplace → allocation)
- Live ops workbench (NetSuite-class exception cockpit) with drill-down SO → stock → GL

---

## Bottom line

Lumiere already supports an **operational quote-to-cash pilot** with returns and approval hooks that beat a spreadsheet OMS. The gap to the stated NetSuite **quality** bar is not “copy every module,” but enforcing that **every commercial exception has inventory and financial consequences inside SpacetimeDB transactions**, finishing **pricing/reservation/backorder/dropship** behind existing schema flags, and using **subscriptions as live exception queues** rather than KPI dashboards alone. CPQ, commissions, promotions, and exchange are differentiators — not pilot blockers — once commitment integrity is fixed.

### Related docs

- [CRM lifecycle investigation](./CRM_LIFECYCLE_INVESTIGATION.md) — upstream lead → opportunity → SO
- [Accounting NetSuite gap](./ACCOUNTING_NETSUITE_GAP.md) — AR/posting/credit adjacent
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVESTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — wedge A lead-to-cash (note: returns marked Done in wave summary; older Sales table rows still say Gap)
- Sales module: `spacetimedb/src/sales/`
- Sales workspace: `frontend/packages/stdb/src/subscriptions/sales-workspace.ts`
- Domain tests: `spacetimedb/tests/sales/` (`run_all_sales_tests`)
)
