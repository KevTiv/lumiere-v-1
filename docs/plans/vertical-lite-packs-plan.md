# Vertical-Lite Packs Plan

## Scope

Introduce company-enabled feature packs only after the shared payment, messaging,
reporting, and AI governance foundations exist. Packs add small domain models,
reports, forms, and skill manifests; they must not fork CRM, accounting,
inventory, RBAC, import, or audit logic. No pack includes webshop, storefront,
online checkout, marketplace, or customer account portal behavior.

## Current Codebase References

- Shared CRM: `spacetimedb/src/crm/`, `frontend/web/app/(modules)/crm/`.
- Sales/POS/returns: `spacetimedb/src/sales/`, `frontend/web/app/(modules)/sales/`.
- Purchasing: `spacetimedb/src/purchasing/`, purchasing client/hooks.
- Inventory: `spacetimedb/src/inventory/`, inventory client/hooks.
- Manufacturing foundations: `spacetimedb/src/manufacturing/` and existing
  `phase-4-manufacturing-smoke.spec.ts` / `manufacturing-mutations.spec.ts`.
- Projects/tasks: `spacetimedb/src/projects/`; services can build on this where
  appropriate.
- Shared reports, AI, import, permissions, and documents are described in the
  companion plans and must be reused by every pack.

## 1. Current Codebase Evidence

Sales, purchasing, inventory, manufacturing, projects, CRM, and accounting all
have broad tables/UI/configuration. This supports pack composition. The missing
work is an explicit company-level pack registry, focused domain records and
workflow/report contracts, seed fixtures, and end-to-end scenarios for the SME
wedge.

## 2. Proposed Architecture

Define `VerticalPack` and `CompanyVerticalPack` configuration records with key,
version, enabled state, required permissions, module flags, onboarding checklist,
and compatible country/accounting options. Each pack registers declarative
extensions: entity/form configs, report catalogue entries, skill manifests,
navigation visibility, import mappings, and E2E fixtures. Pack reducers still
validate org/company scope and call shared accounting/stock operations.

## 3. Backend Changes

1. Add platform settings records/reducers for pack catalogue and company
   enablement, with audit and compatibility validation.
2. Add domain tables only when shared concepts cannot represent the workflow.
   Prefer references to Contact/Product/StockMove/AccountMove/SaleOrder/
   PurchaseOrder, never copied financial or inventory balances.
3. Add domain imports as extensions of `data_ops` import tracking, with rollback
   registration before exposing an import UI.
4. Implement reports as typed owner-report extensions and AI skills as reviewed
   manifests under the enterprise harness.

## 4. Frontend Changes

Use existing module clients, `forms/config/modules/*`, shared entity configs,
settings, module subscription hooks, and `CompanySwitcher`. Show pack controls
only to permitted administrators. Pack screens should be operational workspaces,
not marketing landing pages, and maintain a narrow workflow per vertical.

## 5. AI/Harness Changes

Each pack contributes green/amber skills only through the reviewed skill registry.
No pack gets unrestricted data access or direct posting. Any financial, stock,
bulk messaging, permission, import rollback, or export action remains governed
by the common risk policy.

## 6. Permissions and Audit Requirements

Pack enable/disable, configuration, onboarding import, domain state changes,
stock/money effects, report export, and skill execution require common audit
correlation. Pack permissions augment rather than bypass module permissions and
field access. Disabling a pack hides workflows but retains immutable business
history and documents.

## 7. E2E Test Requirements

Every pack needs: enablement/company isolation, onboarding/import rollback where
applicable, one operational happy path, a permission denial, one report, and one
green AI skill. Domain-specific first scenarios are listed below.

## 8. Packs, Gaps, Reports, Skills, and First E2E

### 1. Distributor / wholesaler pack

- **Required existing modules:** CRM contacts, sales orders/invoices/returns,
  purchasing, warehouses/stock moves/replenishment, payments/reconciliation,
  reports, messaging.
- **Missing domain models:** customer credit policy/limit and hold state,
  sales route/agent assignment, delivery run/stop, optional case/pack pricing,
  and distributor-specific price/credit approval policy. Reuse `ProductPackaging`
  and price lists before adding new packaging models.
- **Required reports:** daily business summary, cash/mobile-money, AR aging/
  customer balances, low stock, stock movement, sales by product/agent, purchase
  spend, payment fees.
- **Required AI skills:** low-stock scan, overdue/credit-hold summary, duplicate
  mobile-money scan, delivery-run summary, amber purchase-order/payment-reminder
  drafts.
- **First E2E:** phone-first credit customer receives sale, delivery reduces
  stock, partial MTN payment allocates to invoice, daily report/timeline shows
  the result, and a low-stock reorder draft is reviewed.

### 2. Shop / retail-lite pack

- **Required existing modules:** products/barcodes/stock, POS transactions,
  sales returns, cash/mobile-money accounts, customer contacts, daily reports.
- **Missing domain models:** shift/cash-drawer session close, cashier variance,
  simple retail price/discount authorization, and optional branch counter.
  Do not add catalogue/storefront/cart/customer account models.
- **Required reports:** daily sales by cashier/product, cash/mobile-money close,
  variance, returns, low stock, payment fee summary.
- **Required AI skills:** daily close summary, product sales/low-stock scan,
  amber variance investigation draft.
- **First E2E:** cashier opens session, sells barcode item, accepts cash and
  mobile money, records a return, closes drawer with variance review, and owner
  downloads a day-close PDF.

### 3. Farm / cooperative pack

- **Required existing modules:** contact roles, purchasing, inventory lots/
  traceability/quality, payments, warehouse, reports, messaging.
- **Missing domain models:** farmer/member profile, collection/delivery receipt,
  crop/season, grading/quality result, member advance/deduction settlement, and
  collection center. These must post through purchasing/payment/accounting,
  rather than create a separate farmer payable ledger.
- **Required reports:** collection by farmer/crop/grade, member balances,
  payables/advances, quality rejects, stock traceability, seasonal spend/volume.
- **Required AI skills:** collection anomaly/quality summary, farmer payment
  duplicate scan, amber collection-payment/reminder drafts.
- **First E2E:** register farmer with mobile-money identity, collect graded lot,
  create supplier payable, partially settle to wallet, and produce a season
  collection/payables report.

### 4. Workshop / light manufacturing pack

- **Required existing modules:** products/BOM/manufacturing orders, stock moves,
  purchasing, quality, sales, accounting, documents, reports.
- **Missing domain models:** work order/operation checkpoint, labor/time capture,
  simple job costing, scrap/rework reason, and customer job link. Reuse existing
  manufacturing order and inventory valuation; do not duplicate consumption or
  cost posting.
- **Required reports:** work-order status, planned-versus-actual material/labor,
  scrap/rework, WIP/finished goods, margin by job, low components.
- **Required AI skills:** component shortage scan, work-order delay summary,
  amber stock-adjustment/purchase-order draft.
- **First E2E:** create customer job and work order from BOM, reserve/consume
  components, record scrap, complete to finished goods, invoice job, and show
  job-cost/margin report.

### 5. Service / repair business pack

- **Required existing modules:** CRM, sales/invoices/payments, inventory spare
  parts, projects/tasks/activities, documents, messaging, reports.
- **Missing domain models:** service ticket, asset/equipment intake, diagnosis,
  estimate approval, repair status, technician assignment, labor entries, and
  warranty/return visit. Use sale orders/invoices for commercial documents and
  stock moves for consumed parts.
- **Required reports:** open jobs/aging, technician workload, turnaround time,
  parts consumption, service revenue/margin, unpaid customer balances.
- **Required AI skills:** open-job priority summary, customer update draft,
  estimate/purchase-order draft, parts-shortage scan.
- **First E2E:** log equipment/contact, diagnose and estimate, obtain approval,
  consume spare part, complete repair, invoice/partial payment, send copy-first
  goods-ready message, and run service owner report.

## 9. Risks / Open Questions

- Confirm the first launch vertical before investing in generic pack machinery;
  distributor/wholesaler is the stated wedge and should be first.
- Specify whether different packs can coexist in one company and how accounting
  policies/terminology compose.
- Validate local measurement, tax, traceability, cooperative governance, and
  warranty regulations before a pack leaves pilot scope.

## Suggested Implementation Order

1. Finish shared phone/payment/messaging/report/AI contracts.
2. Add lightweight pack enablement and distributor fixtures; ship the
   distributor/wholesaler pack first.
3. Add retail-lite using existing POS only after day-close controls exist.
4. Sequence farm, workshop, and service packs according to pilot commitments;
   each needs a separate design review and first E2E before expansion.

## Milestones and Acceptance Criteria

- A pack can be enabled for one company without leaking configuration/data to
  another.
- Its first workflow uses shared source-of-truth stock and accounting records.
- It has one pilot-ready report, one reviewed AI skill, and a deterministic E2E
  fixture before additional workflows are added.

## Security and Privacy Considerations

Pack models often add sensitive data such as farmer identities, customer assets,
or employee workload. Apply existing field policies, scoped queries, audit, and
the AI privacy guard from the outset; never use metadata blobs as an ungoverned
store for sensitive workflow data.
