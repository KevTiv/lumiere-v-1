# Sales & Order Management Investigation — Quote-to-Cash

Current-state assessment of Lumiere sales / order management against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-16  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this refresh.

**Verdict:** Lumiere has a credible **MVP lead-to-cash spine** — Draft SO → optional send (`Sent`) → optional discount approval → confirm (hard reservation + draft OUT picking, or dropship PO path) → validate (quant move / backorder) → invoice → payment, plus **MVP RMA → receive → credit note**, and Ops UI for commissions / exception filters. Against the quality bar it is **strong** on commitment transactionality for the happy path, **partial** on quote portal, approvals UI, FX/reporting depth, dropship/CPQ/promotions productization, and live server-side queues, and **unsuitable** where the UI/BFF declares lock/line-edit reducers that do not exist in SpacetimeDB.

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/sales` + adjacent)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Sales core | `sale_order`, `sale_order_line`, `sale_order_option` | `sales_core.rs` | Options have CRUD + apply reducers |
| OMS extensions | `account_fiscal_position`, `account_fiscal_position_tax`, `account_incoterm`, `sale_promotion`, `sale_commission` | `oms_extensions.rs` | |
| Returns | `return_order`, `return_order_line` | `return_orders.rs` | MVP RMA |
| Pricing | `product_pricelist`, `product_pricelist_item` | `pricelists.rs` | Applied via `resolve_unit_price` on line create when `price_unit` is `None` |
| Delivery master | `stock_picking_batch`, `delivery_carrier`, `delivery_price_rule`, `shipping_method` | `delivery_shipping.rs` | |
| POS | `pos_config`, `pos_payment_method`, `pos_loyalty_program`, `pos_session`, `pos_order`, `pos_order_line`, `pos_payment`, `pos_loyalty_card` | `pos_config.rs`, `pos_transactions.rs` | Separate retail runtime |
| Inventory (adjacent) | `stock_picking`, `stock_move`, `stock_quant` | inventory module | Confirm reserves; validate moves; backorder spawn |
| Accounting (adjacent) | `account_move` / lines, `account_payment_term`, `partner_credit_control` | accounting module | Credit gate on confirm **and** invoice post |
| Country packs (adjacent) | `country_pack_definition`, `country_pack_tax_rule`, `company_country_pack` | `core/country_pack.rs` | Tax seed + metadata; not full OMS localization |
| CRM bridge | Opportunity → SO | CRM module | `convert_opportunity_to_sale_order` |
| Workflow | Approval gate on SO confirm | workflow + sales confirm | Discount/amount → `ToApprove` |

### 1.2 Backend reducers (callable SpacetimeDB surface)

**Orders (`sales_core.rs`):** `create_sale_order`, `update_sale_order`, `create_sale_order_line`, `send_sale_order_quotation`, `confirm_sales_order` (+ internal `confirm_sales_order_impl`), `cancel_sale_order`, `compute_so_totals`

**Returns (`return_orders.rs`):** `create_return_order`, `confirm_return_order`, `cancel_return_order`, `create_credit_note_from_return_order`  
(`UpdateReturnOrderParams` style update reducer: **absent**)

**OMS extensions (`oms_extensions.rs`):** `create_fiscal_position`, `create_fiscal_position_tax`, `create_incoterm`, `create_sale_promotion`, `apply_sale_promotion_to_order`, `create_sale_order_option`, `update_sale_order_option`, `delete_sale_order_option`, `apply_sale_order_options`, `accrue_sale_commission`, `settle_sale_commissions`, `cancel_sale_commission`, `reverse_sale_commission_settlement`, `create_exchange_order_from_return`  
(Helpers: `create_dropship_purchase_orders_for_sale`, `accrue_sale_commission_for_order`, `confirm_exchange_rate_snapshot`)

**Pricelists:** `create_pricelist`, `update_pricelist`, `delete_pricelist`, `create_pricelist_item`, `delete_pricelist_item`

**Delivery:** `create|start|complete|cancel_picking_batch`, `create_delivery_carrier`, `create_delivery_price_rule`, `create_shipping_method`

**POS:** config/session/order/loyalty reducers (separate `/pos` usage)

**Adjacent OMS-critical:** `create_invoice_from_sale_order`, `post_invoice` (+ `ensure_partner_credit_allows_invoice`), stock picking confirm/assign/validate/`validate_stock_picking_backorder`, quant reserve/unreserve/move (wired from SO confirm / picking validate), `convert_opportunity_to_sale_order`, payment reconcile updating SO `amount_paid` / `amount_residual`

### 1.3 Frontend-only / broken contracts

Declared in `frontend/packages/stdb/src/commands/sales-http.ts` (`SALES_BFF_REDUCERS`) and query-hooks, **with no matching `#[reducer]` under `spacetimedb/`**:

| BFF / hook name | UI usage | Backend |
|-----------------|----------|---------|
| `lock_sale_order` / `unlock_sale_order` | Orders bulk actions in `sales-client.tsx` | **Missing** |
| `update_sale_order_line` / `delete_sale_order_line` | Hooks instantiated; **no mutate call sites** in Sales UI | **Missing** |

Also BFF-listed but not SpacetimeDB sales reducers (import path / other modules): `import_sale_order_csv`, `import_sale_order_line_csv`, `create_invoice_from_sale_order` (accounting).

**Backend-only (reducer exists; Sales UI does not call):**

| Reducer | Domain test | Sales UI |
|---------|-------------|----------|
| Dropship path inside `confirm_sales_order` (`is_dropship`) | None with `is_dropship: true` | No form field / toggle |
| `create_sale_promotion` / `apply_sale_promotion_to_order` | Via `run_sales_oms_extensions_test` | Hook unused |
| `create_sale_order_option` / `apply_sale_order_options` | Via OMS extensions test | Hook unused; not in workspace keys |
| FX snapshot on confirm | No dedicated sales domain test | No dedicated UX |

### 1.4 Subscriptions & queries

`SALES_WORKSPACE_RESOURCE_KEYS` (`frontend/packages/stdb/src/subscriptions/sales-workspace.ts`); SQL builders in `erp-subscriptions.ts`:

| Key | Live SQL | Filter |
|-----|----------|--------|
| `sale-orders`, `sale-order-lines` | Yes | `organization_id` |
| `return-orders`, `return-order-lines` | Yes | `organization_id` |
| `sale-commissions` | Yes | `organization_id` |
| `pricelists`, `pricelist-items` | Yes | `organization_id` |
| `partner-credit-controls` | Yes | `organization_id` |
| `stock-pickings` | Yes | `organization_id` |
| `account-payment-terms` | Yes | `organization_id` |
| `pos-loyalty-programs`, `pos-loyalty-cards` | Yes | `organization_id` |
| `picking-batches`, `delivery-carriers`, `delivery-price-rules`, `shipping-methods`, `pos-payment-methods` | Yes | `company_id` IN session companies |

**Not in sales workspace keys:** `sale-promotions`, `sale-order-options`, fiscal positions / Incoterms masters (may load via other workspaces or BFF).

**Exception queues:** Dashboard + Ops tab derive queues client-side from subscribed tables (`ToApprove`, sent quotes, credit holds, returns awaiting receive, open pickings, commissions). There are **no** server-side queue tables or filtered exception subscriptions dedicated to those views.

### 1.5 UI operations (`/sales`)

Tabs from `salesModuleConfig` (`frontend/web/lib/module-dashboard-configs.ts`) + `sales-client.tsx` / `sales-ops-panel.tsx`:

| Tab | End-to-end operations | Gaps |
|-----|----------------------|------|
| Dashboard | MTD KPIs; exception cards deep-link to Ops | Queues are client filters |
| Ops | Queue panels; commission accrue/settle/cancel/reverse; SO drill-down | Not a server workbench |
| Orders | Create draft; edit header; send quotation; confirm; cancel; recompute; invoice; PDF; CSV; chatter; **lock/unlock (broken)** | Lock/unlock call missing reducers |
| Order lines | Create line; CSV | No line update/delete UI; reducers missing |
| Pricelists / items | Create; activate/deactivate; delete | Auto price on line create when unit omitted |
| Deliveries | Picking-batch lifecycle | |
| Fulfillment | Confirm / assign / validate / partial validate + backorder / cancel | Multi-warehouse split unused |
| Returns | RMA → confirm → receive → credit note → cancel; **exchange** | Exchange untested in domain suite |
| Invoices | OutInvoice list + totals | |
| Carriers / price rules / shipping / POS masters | Create-oriented entity tabs | |
| Promotions / CPQ options | — | No Sales tabs |

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain `run_all_sales_tests` | confirm→invoice; delivery qty; cancel releases reservation; draft update; ATP shortfall; credit hold on confirm; pricelist apply; send quotation; backorder; fiscal remap; Incoterm+promotion+options; commission accrue/settle/clawback | Dropship, FX snapshot, exchange, exception queues, lock/unlock, line update/delete |
| Playwright | `mvp-lead-to-cash`, `mvp-sales-returns`, `mvp-invoice-correction`, `sales-mutations`, `sales-invoice-flow` (+ smoke/auth helpers) | Promotions, CPQ, dropship, commissions Ops, lock |
| Contract | `sales.contract.ts` enumerates `SALES_BFF_REDUCERS` | Does not prove backend reducers exist |
| CRM bridge | Opportunity → SO in CRM domain tests | |

---

## 2. Gap matrix (quality bar vs inventory)

Definitions:

- **Present** — usable end to end with operational, inventory, and/or financial consequences.
- **Partial** — implemented at limited depth, or missing an essential UI, policy, reporting, or integration layer.
- **Absent** — no meaningful implementation.
- **Unsuitable** — surface exists but cannot safely meet the workflow requirement (e.g. UI without backend).

| Capability | State | Evidence |
|------------|-------|----------|
| Quote document lifecycle | **Partial** | `send_sale_order_quotation` → `Sent` + expiry flag; no customer portal / accept; expiry UX thin |
| Order confirmation | **Present** | Draft/Sent/ToApprove → Sale; draft OUT picking + hard reserve (non-dropship) |
| CPQ / configuration | **Partial** | Option CRUD + `apply_sale_order_options`; domain test; **no Sales UI**; not workspace-subscribed |
| Sales contracts | **Absent** | Subscriptions/HR contracts ≠ commercial SO contracts |
| Credit checks | **Present** | `ensure_partner_credit_allows_invoice` on confirm and invoice post; Ops credit queue filter |
| Approvals | **Present** | Discount/amount → `ToApprove`; Ops Approve / Reject (SoD) + workflow resume / `confirm_sales_order_impl` |
| Pricing rules | **Present** | Pricelist Fixed/%/Formula; `resolve_unit_price` when `price_unit` is `None` |
| Promotions / coupons | **Partial** | `SalePromotion` + `apply_sale_promotion_to_order` + test; **no Sales UI** |
| Allocation / ATP | **Partial** | Hard reserve at warehouse `lot_stock_id`; soft line availability fields unused; no advanced allocation |
| Split fulfilment | **Partial** | Partial validate + backorder; one picking per confirm; shipping/picking policies unused; no multi-address split |
| Drop shipment | **Partial** | Confirm with `is_dropship` creates draft POs, skips warehouse OUT; **no UI**, **no domain test** |
| Backorders | **Present** | `validate_stock_picking_backorder` + UI `createBackorder` + domain test |
| Cancellations | **Partial** | Uninvoiced cancel releases pickings + unreserve; invoiced cancel blocked — post-invoice needs credit note path |
| Exchanges | **Partial** | `create_exchange_order_from_return` + Returns UI; **not** in `run_all_sales_tests` |
| Returns / RMA | **Present** | Confirm → return picking → credit note; Playwright + domain coverage on spine |
| Commissions | **Partial** | Accrue (invoice hook / manual), settle GL, clawback, Ops UI + domain tests; no plan splits / SLA automation |
| Multichannel / POS → SO | **Partial** | POS separate runtime; picking metadata stamps `source_id` / `medium_id` / `route_ids` only |
| Multi-currency | **Partial** | `currency_id` + confirm FX snapshot into metadata (fail closed without rate); **no domain test**; limited drill-down |
| Tax incl/excl | **Partial** | Tax `price_include` + line taxes; fiscal position remap on line create |
| Incoterms | **Present** | `AccountIncoterm` + SO `incoterm_id`; invoice copies `invoice_incoterm_id` |
| Payment terms | **Present** | FK on SO → copied to invoice |
| Cross-border docs | **Absent** | No commercial invoice / packing list / customs packet from sales; pack `nfe_adapter` / `e_invoice` metadata are stubs |
| Exception queues (live) | **Partial** | Ops + dashboard client filters over org SQL; not bounded server exception subscriptions |
| Quant movement on deliver | **Present** | Validate consumes reserved / transfers quants |
| Order lock / unlock | **Unsuitable** | UI + BFF without SpacetimeDB reducers |
| Line update / delete | **Unsuitable** | BFF/hooks without SpacetimeDB reducers; no UI mutate path |

---

## 3. Required invariants

### Accounting

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Confirm/invoice qty consistency | Partial | `qty_to_invoice` / `qty_invoiced` updated on invoice-from-SO path | Delivery-based invoicing policy must not double-bill |
| Immutable FX snapshot | Partial | Rate written into SO `metadata` at confirm | First-class columns + invoice post must consume same snapshot; domain test |
| Tax snapshot / fiscal remap | Partial | Remap on line create | Remap on confirm/invoice; audit immutable tax lines |
| Credit / AR exposure | Yes (confirm + post) | `ensure_partner_credit_allows_invoice` | Clearer UX; policy choice confirm vs invoice documented |
| RMA credit notes | Partial | Credit note from `received` RMA | Full revenue/COGS reversal policy verification |
| Commission accrual / clawback | Partial | Accrue on OutInvoice post / manual; clawback on cancel/return paths | Reseller splits; settlement period locks |
| Period locks | Partial | Accounting close elsewhere | Sales mutations must respect fiscal lock |
| Post-invoice cancellation | Partial | Cancel blocked when invoiced | Explicit compensation workflow (credit note), not cancel alone |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Reducer permissions | Yes (pattern) | `check_permission` on sales resources | Audit every OMS extension reducer |
| Tenant / company ownership | Partial | Org scope on create/update; cancel/confirm derive company from order | Explicit `company_id` guards on all OMS reducers |
| Approval SoD | Yes | Backend reject + Ops UI disables Approve for requester | Keep Workflow secondary path |
| Cross-entity isolation | Partial | Org SQL filters | Isolation tests for company A vs B on confirm/cancel |
| Broken lock surface | No | Lock/unlock UI without reducers | Remove UI or implement reducers |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Append-only mutation log | Partial | `write_audit_log_v2` on core sales paths | Close gaps on every OMS/POS mutator |
| Actor / reason | Partial | Cancel reason optional → metadata | Require reason on credit-sensitive cancels |
| Approval history | Partial | Workflow request linkage | Sales-visible approval timeline |
| External references | Partial | Pack adapter metadata stubs | Persist provider IDs from procedures/workers |
| Source-document links | Partial | SO ↔ picking ↔ invoice FKs | Report drill-down SO → picking → move → invoice → payment |

### Concurrency / inventory

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Atomic confirm + reserve | Yes (non-dropship) | Single reducer; ATP fail closed | Dropship PO + sale state atomicity tests |
| Stale-state rejection | Partial | State preconditions on confirm/cancel/send | Idempotency keys for external/retry commands |
| Validate moves stock | Yes | Quant consume/receive on validate | |
| Partial fulfilment / backorder | Yes | Backorder reducer + UI | Multi-location split |
| Cancel unreserve | Yes (uninvoiced) | Cancel + open picking cancel + unreserve | Residual after partial ship policy |
| No client multi-step commit | Yes (intent) | Approval resume server-side | Keep; never orchestrate reserve across round-trips |
| Exception queues | Partial | Client derivation | Bounded server subscriptions / views |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). External HTTP belongs in procedures/workers, not reducers.

---

## 4. Reference workflows

1. **Draft quote creation and pricing** — Draft SO + lines; pricelist resolve; taxes/fiscal position.
2. **Send, expiry, acceptance, confirmation** — Send → `Sent`; expiry sets `is_expired`; confirm → Sale (portal accept **missing**).
3. **Approval and rejection with SoD** — High discount → `ToApprove`; Sales Ops Approve / Reject (SoD); workflow resume secondary.
4. **Credit hold and exposure limits** — Confirm/post blocked; Ops credit filter.
5. **Atomic reservation and ATP rollback** — Confirm reserves or fails; cancel unreserves.
6. **Partial shipment and backorder** — Partial validate → backorder picking.
7. **Multi-location / multi-address split fulfilment** — **Not implemented** (single picking path).
8. **Dropship PO and fulfilment linkage** — Backend PO create on confirm; UI/tests **missing**.
9. **Pre-fulfilment cancellation** — Cancel SO + pickings + unreserve.
10. **Post-invoice cancellation** — Blocked; requires credit-note compensation.
11. **RMA receipt and credit note** — MVP path + e2e exists.
12. **Exchange and over-return prevention** — Exchange reducer + UI; over-return policy depth limited.
13. **Commission accrual, settlement, clawback** — Ops + domain tests; splits open.
14. **Pricelist and promotion eligibility/stacking** — Pricelist auto; promotion backend-only; stacking rules thin.
15. **Multi-currency FX snapshot and drill-down** — Metadata snapshot; reporting drill-down thin.
16. **Tax-inclusive/exclusive and fiscal remapping** — Remap on line create.
17. **Cross-company isolation** — Org filters; dedicated isolation tests still needed.
18. **Live exception queues and document drill-down** — Ops client filters + deep links.
19. **Cross-border document submission** — Pack metadata stubs only; no retry/idempotent submission from sales.

### Acceptance scenarios (19)

1. Create Draft SO with lines, payment terms, currency, tax IDs; totals match untaxed + tax; audit CREATE.
2. Send quotation → state `Sent`; past `validity_date` marks `is_expired` and blocks unsafe confirm paths.
3. Confirm Draft/Sent → state `Sale`, draft OUT picking + moves linked by `sale_line_id`, `reserved_quantity` increased **or** explicit ATP fail.
4. Max line discount over policy → `ToApprove`; second confirm without approval fails; approver resume → `Sale` (SoD).
5. Partner with payment hold / over credit limit cannot confirm or post; exception visible in Ops credit queue.
6. Validate assigned picking → move/picking done, quants relocated, `qty_delivered` updated; invoice residual correct.
7. Partial validate short qty → residual backorder picking created **or** explicit cancel remainder.
8. Cancel confirmed uninvoiced SO with open picking → Cancelled, picking cancelled, reservation released.
9. Create invoice from Sale → linked `OutInvoice`; post blocked if credit control fails; payment updates SO residual.
10. RMA for delivered qty → confirm → receive → credit note → post; AR reduced.
11. Cancel RMA after receive/refund attempted fails closed.
12. Dropship flagged line creates draft PO(s), never reserves own warehouse qty (acceptance for productization).
13. Company B cannot confirm/cancel company A’s SO.
14. Multi-currency SO stores rate/snapshot used on invoice post; report drills SO → picking → move → invoice → payment.
15. Tax-inclusive price yields correct net/tax; fiscal position remaps taxes when set.
16. Subscription clients see live `ToApprove` / credit-hold / backorder / commission queues without polling (target: server-bounded filters).
17. Pricelist item with min qty / date range applied automatically on line create when `pricelist_id` set and `price_unit` omitted.
18. Apply promotion / CPQ options from Sales UI materializes lines and recomputes totals (target; UI missing today).
19. Cross-border document submission records durable intent, retries idempotently via worker/procedure, and links external IDs (target; stubs only today).

---

## 5. Localization matrix (sales / order–relevant)

Country packs today are **tax-seed + company-ID metadata** (`spacetimedb/src/core/country_pack.rs`). Sales still needs commercial overlays (tax display, payment norms, e-invoicing procedures, Incoterm catalogs). Pack metadata flags such as `nfe_adapter` / `e_invoice` are **stubs**, not live integrations.

**i18n:** Only `frontend/packages/i18n/src/locales/en.json` ships `sales.*` keys. Country packs are not language packs.

Rates and rules below are **dated requirements as of 2026-07-16**, cited from official sources where linked — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA only in-tree) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|-----------------------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` only (BW/NA/MZ/etc. **absent**) | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| Tax seed | GST-AU 10%; GST-NZ 15% | VAT-ZA 15% + WHT-ZA 20% | ICMS-BR / IRRF-BR; IVA-AR 21%; IVA-CL 19% | GST-SG 9%; SST-MY 6%; PPN-ID 11%; VAT-TH 7%; VAT-PH 12% |
| Currency | AUD / NZD | ZAR | BRL / ARS / CLP (`inflation_mode` optional BR/AR) | SGD / MYR / IDR / PHP / THB |
| Company ID meta | ABN / NZBN | — | CNPJ (BR) | UEN (SG); others thin |
| E-invoice / fiscal meta | BAS reporting flag (AU) | — | `nfe_adapter: true` (BR stub) | `e_invoice: peppol` (MY), `coretax` (ID); IRAS flag (SG) |
| Tax on price (commercial norm) | GST typically exclusive B2B | VAT exclusive common | Complex ICMS/IVA; BR NF-e | GST/SST/PPN/VAT; mix retail incl / B2B excl |
| Payment terms (ops norm) | 7/14/30 EOM | ~30 days; mobile-money ops | Installments / indexation sensitivity | 30 days; LC for import-heavy |
| Incoterms / trade | Export common; SO Incoterm master present | Regional + deep-sea | Mercosur / Pacific docs | High import dropship volume — dropship productization critical |
| OMS pack gap | GST display + ABN on invoice PDF | VAT + WHT on credit notes | NF-e outbound **outside** reducers | E-invoice as **procedures/workers**, not reducers |

### Official sources (dated; verify)

| Region | Authority / reference |
|--------|----------------------|
| Australia GST | [ATO — GST](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst) |
| New Zealand GST | [IRD — GST](https://www.ird.govt.nz/gst) |
| South Africa VAT | [SARS — VAT](https://www.sars.gov.za/tax-rates/value-added-tax-vat/) |
| Singapore GST | [IRAS — GST](https://www.iras.gov.sg/taxes/goods-services-tax-gst) |
| Malaysia e-Invoice | [LHDN MyInvois / e-Invoice](https://www.hasil.gov.my) |
| Indonesia | [DJP / Coretax](https://www.pajak.go.id) |
| Brazil NF-e | [Receita Federal — NF-e](https://www.gov.br/receitafederal) |
| Thailand VAT | [Revenue Department](https://www.rd.go.th) |
| Philippines VAT | [BIR](https://www.bir.gov.ph) |
| Chile IVA | [SII](https://www.sii.cl) |
| Argentina IVA | [AFIP / ARCA](https://www.afip.gob.ar) |

Neighboring Southern African markets (e.g. Botswana, Namibia, Mozambique) have **no** in-tree packs.

---

## 6. SpacetimeDB architecture decision (Sales OMS)

Quality benchmark for integrated order-to-cash controls: Oracle NetSuite order management / SuiteSuccess operational patterns ([NetSuite documentation](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/)). Architecture constraints from SpacetimeDB: reducers are automatically transactional; procedures are the HTTP boundary ([SpacetimeDB Functions](https://spacetimedb.com/docs/functions/); [Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Subscription semantics](https://spacetimedb.com/docs/subscriptions/semantics)).

| Topic | Decision |
|-------|----------|
| **Atomic mutations** | Keep order confirmation, commitment, reservation, stock moves, dropship obligation creation, cancellation, and return-receipt mutations in **single reducers** (or one internal `*_impl`) wherever atomicity is required. Never split reserve across client round-trips. |
| **Preconditions / idempotency** | Enforce state preconditions on confirm/send/cancel/validate. Add idempotency keys for concurrent or repeated external commands (marketplace, payment, fiscal submit). |
| **Subscriptions** | Prefer company-filtered and **bounded exception** subscriptions (`state = ToApprove`, credit-hold partners, open shortfall pickings, commissions awaiting settle). Avoid replicating complete high-volume tables solely for client-side queue derivation. |
| **Indexes** | Index tenant, company, state, partner, order, picking, and commitment lookup paths used by reducers and subscriptions. Index names must remain unique module-wide. |
| **External I/O** | Carrier rating, tax-authority, payment, marketplace, and document-provider HTTP calls go behind **API workers / procedures** using the existing queue/intent pattern. Reducers create durable intents and record results atomically; they must not block on HTTP. |
| **Statutory adapters** | Treat current pack `nfe_adapter` / `e_invoice` / IRAS metadata as **stubs**, not reliable integrations. |
| **FX / tax** | Snapshot rate and tax computation onto SO/invoice lines at confirm/invoice time; keep snapshots immutable for audit. |
| **Broken contracts** | Do not ship UI actions for reducers that are not published (`lock`/`unlock`, line update/delete) — either implement or remove from BFF/UI. |

---

## 7. Priority classification (remaining gaps)

Snapshot after 2026-07-16 gap-fix wave. Items marked **Closed in-tree** shipped reducers/UI/tests at MVP depth; remaining rows are still open polish.

### Pilot-critical

| Gap | Status | Notes |
|-----|--------|-------|
| `lock_sale_order` / `unlock_sale_order` | **Closed in-tree** | Reducers + lock guards on update/confirm/send/lines |
| `update_sale_order_line` / `delete_sale_order_line` | **Closed in-tree** | Reducers + Order Lines delete action |
| Company isolation tests | **Closed in-tree** | `test_company_isolation_on_confirm` in `run_all_sales_tests` |
| Confirm/send/cancel failure UX | **Closed in-tree** | API error body surfaced; invoiced cancel guides to RMA |
| FX snapshot fail-closed test | **Closed in-tree** | Domain test + first-class `currency_rate` on confirm |
| Lead-to-cash + RMA e2e green | **Verify** | Re-run Playwright after publish/bindings |
| Audit coverage OMS/POS | **Partial** | Core + OMS advanced audited; POS sweep still thin |

### Competitive

| Gap | Status | Notes |
|-----|--------|-------|
| Quote acceptance | **Closed in-tree** | `accept_sale_order_quotation` + Orders action |
| Sales approve/reject UI | **Closed in-tree** | Ops ToApprove: Approve / Reject via approval inbox + SoD requester disable; Workflow deep-link secondary |
| Dropship UI + domain test | **Closed in-tree** | Form `isDropship` + dropship domain test |
| Promotions + CPQ apply UI | **Closed in-tree** | Apply promotion / apply options actions |
| Exchange test + over-return | **Closed in-tree** | Domain test + residual over-return guard |
| Split fulfilment by route | **Closed in-tree** | One OUT picking per `route_id` |
| Server-bounded exception SQL | **Closed in-tree** | `sale-orders-to-approve` / `sale-commissions-pending` / `partner-credit-holds` |
| FX first-class field | **Closed in-tree** | `SaleOrder.currency_rate` at confirm |
| Delivery-based invoicing | **Closed in-tree** | `invoice_policy` + invoice qty refresh |
| Commercial packet export | **Closed in-tree** | JSON packet download from Orders |
| Post-invoice cancel UX | **Closed in-tree** | Cancel error mentions RMA/credit note |

### Differentiating

| Gap | Status | Notes |
|-----|--------|-------|
| Advanced CPQ constraints | **MVP in-tree** | `sale_cpq_constraint` (`oms_advanced.rs`) |
| Commission plans / splits | **MVP in-tree** | `sale_commission_plan` + splits |
| SLA automation | **MVP in-tree** | Scheduled `sales_sla_escalation_job` |
| Omnichannel allocation | **MVP in-tree** | `apply_omnichannel_allocation` |
| Integration observability | **MVP in-tree** | `sales_integration_intent` + results |
| Sales contracts | **MVP in-tree** | `sale_contract` draft create |

**Still open for polish:** full binding regenerate/publish on all targets, server-bounded exception subscriptions, POS audit sweep, richer CPQ configurator UI, e2e for new actions.

---

## Bottom line

Lumiere’s OMS spine plus the 2026-07-16 gap-fix wave close the prior broken lock/line contracts, productize dropship/promo/CPQ/accept/exchange paths at MVP depth, and add differentiating tables in `oms_advanced.rs`. Sales Ops now has dedicated SoD Approve / Reject (Workflow remains secondary). Remaining polish is server-bounded exception SQL, POS audit sweep, and e2e verification after binding publish.

### Related docs

- [CRM lifecycle investigation](./CRM_LIFECYCLE_INVESTIGATION.md) — upstream lead → opportunity → SO
- [Accounting NetSuite gap](./ACCOUNTING_NETSUITE_GAP.md) — AR/posting/credit adjacent
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — wedge A lead-to-cash
- Refresh brief: [sales-order-management-investigation-refresh-plan.md](./plans/sales-order-management-investigation-refresh-plan.md)
- Sales module: `spacetimedb/src/sales/`
- Sales workspace: `frontend/packages/stdb/src/subscriptions/sales-workspace.ts`
- Domain tests: `spacetimedb/tests/sales/` (`run_all_sales_tests`)
