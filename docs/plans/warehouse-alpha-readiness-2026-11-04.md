# Warehouse alpha readiness

Date: 2026-11-04

This change completes bounded Product/Warehouse behavior under the existing
[alpha scope decision](product-fleet-alpha-2026-10-31.md). It does not promote the
broader Inventory/WMS lifecycle or change its evidence scores.

## Operator behavior

- Products and Warehouse activate explicit Inventory read/subscription sets.
  Excluded WMS list hooks remain mounted but disabled; full Inventory retains
  its existing defaults. Ancillary contact/document/pricelist/device reads and
  the subscription registry's existing session retention remain unchanged.
- Warehouse transfers show Receive, Deliver, Internal transfer, Other movement,
  or Unavailable from readable source/destination location usage. Exact native
  identifiers and operation owners are preserved. This classification is optional:
  a purchasing operator's authorized receipt list remains available without
  location-master access, and denied, failed, stale or loading location reads
  cannot supply cached task labels.
- Warehouse stock correction points to Counts. Direct quantity setting, quant
  creation and quant CSV import remain outside this bounded operator surface.
- Alpha workflow results return to Products or Warehouse with exact record
  filters. Canonical transfer records stay at `/inventory/transfers/:id`; their
  breadcrumbs and missing-record returns lead to Warehouse in alpha.
- Warehouse setup distinguishes missing company, loading, unavailable reads,
  missing locations, assisted setup and ready. Template creation requires an
  active readable template in the selected company, with valid location and
  operation references. Exact u64 identifiers are retained through mapping.

## Stock correction rules

Adjustments and count posting share a prepare/apply boundary. Posting rejects
stale observed quantities, invalid balances, counts below reserved stock,
ambiguous targets and closed inventory periods. Adjustment drafts also retain
their observed cost; a changed cost requires a fresh draft. Quantity write-downs
recompute stock value and retain the exact quant identity and reservation.

Count posting validates every line before applying any line. Duplicate count
identities, foreign parent relations and empty counts reject. Corrections use
the product's stock unit and do not infer conversions. Service/serial products,
owned/variant quants and ambiguous stock layers require their dedicated workflow;
the generic correction path rejects them. Count posting also rejects packaged
balances because its input has no package selector. An adjustment can target an
explicit validated package. Product and existing stock currency must match the
operating company's currency; no currency conversion is inferred.

These changes do not add accounting journal posting. A processed adjustment
must not be presented as a posted accounting entry.

## Assisted first-warehouse setup

The template form does not bootstrap the first warehouse. An authorized
administrator must provision actual business reference records using the
existing named session operations, under the intended operating company:

1. Confirm the company and its currency, plus product stock units, are readable.
2. Create the required company-owned locations with
   `erp.create_company_stock_location`, passing the selected `companyId` and
   `CreateStockLocationParams`. The stock location uses `usage: internal` and
   must be active. Create receiving/dispatch locations according to the chosen
   operating policy; retain exact returned/read-back IDs.
3. Create the warehouse with `erp.create_warehouse`, the same `companyId` and
   `CreateWarehouseParams`, using those actual location IDs. Required operation
   type fields are codes in the current model, rather than picking-type row
   references. The existing fixture convention is in=1, out=2, internal=3,
   pack=4 and pick=5; verify the intended operational configuration instead of
   deriving codes from row order. The bounded simple policy uses `one_step`
   reception, `ship_only` delivery and `mrp_one_step` manufacture.
4. Freshly query the exact warehouse and locations as the operator. Reload
   `/warehouse`; setup must become ready only when those references are readable.
5. Establish opening stock through the authorized count/correction workflow and
   record the business reason. Verify quantities, reservations and value before
   receiving or fulfilling orders.

Use the existing generated commands and authenticated session boundary, preserving
native permission checks. Do not use synthetic `alpha-demo-seed` fixtures as real
business setup or write directly to tables. A standalone self-service warehouse
bootstrap command/UI remains future work.

## Live acceptance entry point

`frontend/web/playwright.warehouse-alpha.config.ts` runs the existing real-service
receipt/recovery, picking/backorder, internal transfer, cycle count and navigation
proofs serially to avoid shared stock-fixture contention. Inventory helper actions
for admitted tabs now enter `/warehouse`; quality and immediate replenishment
execution remain on their existing broader Inventory surfaces.

With the local disposable ERP stack configured, run from `frontend/web`:

```sh
pnpm run test:e2e:warehouse-alpha
```

Also execute `run_inventory_adjustment_test` (which includes the new correction
regressions) and `run_all_inventory_tests` against the matching development module.
Browser test discovery and synthetic presentation tests do not establish native
ERP acceptance. Keep matching-source live proof, hosted revision checks and release
acceptance open until actually executed.

## Validation record

- 92 focused Product/Warehouse, navigation, input, read-plan and workflow tests
  passed.
- 20 UI navigation, mounted read-activation and selected-company tests passed.
- Both Warehouse presentation browser cases passed at 390px and 1440px, including
  task filtering/reset, exact source quantities, transfer URL/reload and overflow.
  These use synthetic props and do not execute ERP mutations. An earlier cold
  390px run timed out waiting for its URL; the strict assertion was retained and
  passed in the final two-width run. An intervening run was stopped to avoid
  concurrent compiler memory pressure.
- Query-hooks and STDB package semantic typechecks passed. A focused compiler
  check of all 26 changed web source/test files reported zero diagnostics; this
  does not replace the full web/CI gate.
- The full development Rust module check passed; three native tests of the
  production correction-balance policy passed. A disposable SpacetimeDB 2.8.2
  server started successfully, but the development WASM build exhausted workspace
  disk during module compilation. Persisted reducer tests were not executed.
  Temporary build artifacts and the disposable runtime were removed afterward.
- The live Warehouse acceptance configuration discovers 13 cases, including its
  authentication setup. Full ERP browser execution remains open in this session.
- i18n duplicate/key/locale checks, immutable browser operations/transport,
  unchanged opaque-record baseline and lifecycle-evidence validation passed.
- Changed-file lint introduced zero errors. Applying the UI lint configuration
  across all touched package files also reports 651 existing errors, mostly the
  shared unused imports in the split Inventory hooks; these were checked against
  the base and left outside this change.

No deployment or production inventory mutation is part of this change.

## CI follow-up

The initial head `90817ef58231fc42d41c8b0d93c7f8c3434ea0f1` passed full frontend
typechecking, Rust/SpacetimeDB checks, frontend tests/browser regressions and
production builds. Its live domain reducer sequence, including
`run_inventory_adjustment_test`, also passed on the matching CI module. This
supplies the persisted correction proof that the local disk-limited build could
not execute; it does not imply the full Inventory aggregate ran.

The same E2E run had 28 browser passes and five failures. Three receipt scenarios
revealed an excessive read dependency: purchasing users may read their stock
pickings without reading stock locations. Transfer task labels now degrade to
Unavailable while the primary picking read remains authoritative. The distributor
test now explicitly expects its unchanged Inventory handoff. The missing-record
return test uses the shared Button's actual accessible role and additionally
clicks through to verify the Warehouse destination.

The serial acceptance configuration also includes partial-receipt billing and
the distributor continuation, so all five failing scenarios are selected. Fresh
matching-head CI results remain the gate for these follow-up changes.
