# Product, Warehouse and Fleet alpha scope

**Decision date:** 2026-10-31

**Source baseline:** `8361d7d3b6e204e6629830e0877a04f41a516677`

**Status:** implemented alpha candidate; focused local validation recorded below; full integration and release acceptance remain open

**Request:** include Product and Fleet in the alpha release, subsequently extended to Warehouse, and use Mobbin references to improve the modules.

**Fleet clarification:** tenants register and operate their own vehicles, follow their lifecycle, record garage interventions/maintenance and costs, inspect the history, and enter mileage manually. Automatic mileage from installed GPS trackers through IoT is a future extension. Fleet is not a vehicle-rental product.

## 1. Product decision

The alpha workspace adds **Products** at `/products`, **Warehouse** at `/warehouse`, and **Fleet** at `/fleet` alongside the existing Finance modules. Products and Warehouse are bounded workspaces using the existing Inventory operation owners. The broad legacy Inventory workspace remains available in the full profile and through its existing Finance handoff routes in alpha. `/map` remains a hidden geospatial showcase.

This is an explicit alpha scope decision. It does not award U4/U5, promote the broader Inventory/Fleet evidence matrix, or claim deployment. The server's current organization, company, role and field permissions remain authoritative.

| Workspace | Alpha scope | Boundary |
| --- | --- | --- |
| Products | Discover and inspect the catalog; use the existing supported product and category creation/editing paths; follow catalog relationships and existing import handoffs. | No webshop/e-commerce, stock movement, warehouse certification or new product persistence owner. Historical imported prices and current catalog prices retain their existing meanings. |
| Warehouse | Stock by product/location, lots and serials, transfers and stock moves, inventory adjustments, cycle counts, locations/warehouse setup and replenishment rules/scheduling. | No 3D/map, quality, waves/packages, warehouse tasks, routing, barcode or full WMS certification. Immediate replenishment execution is withheld from this bounded toolbar until its native `execute` permission can be represented faithfully. |
| Fleet | Existing tenant-owned vehicle register/details, driver assignment, garage interventions/maintenance with real service-cost posting, inspection/cost history and manual odometer editing. Broader vehicle retirement and lifecycle acceptance remain open. | No rental/booking flow, automatic GPS mileage, telematics worker, dispatch optimization, fuel accounting/TCO claim, asset-disposal integration or new Kanban assignment adapter. |

The full workspace exposes Products and Warehouse for their focused catalog and stock-operation jobs, and retains Inventory for the broader legacy workspace. These three entries use `module:inventory`; separate menu entries do not create a new permission or duplicate product or stock records.

## 2. Admission and discovery owners

`frontend/packages/ui/src/lib/product-surface-catalog.ts` remains the single product-surface authority. Products, Warehouse and Fleet keep `firstOrgExposure: "review"` and receive a separate `boundedAlpha` decision with a scope and this document's path. `isFirstOrgSurfaceAdmitted` retains strict lifecycle admission. `isFirstOrgNavigationAdmitted` combines that admission with the explicitly selected bounded alpha workspaces; `isFirstOrgRouteAdmitted` uses the same decision plus the existing Finance support-route list.

`workspace-profile.ts` includes Products, Warehouse and Fleet in `finance-alpha` discovery. `navigation-catalog.ts` supplies both sidebar and command-palette links. The profile name is retained for compatibility. Inventory remains outside alpha global navigation; unknown, unrelated review, AI, internal and showcase routes receive no new admission. No role, backend allowlist or generated contract changes are needed for this decision.

The product-surface census covers `/products` and `/warehouse` as separate bounded routes owned by COV-06. COV-06's broader Inventory/WMS and COV-15's broader Fleet lifecycle remain at their recorded evidence levels. `scripts/validate-cov00d-evidence-matrix.py` must continue to pass without changing their D/A/O/E scores or `launch_admission` merely to expose these alpha workspaces.

The profile permits the bounded module IDs in Settings where a form module is registered. Fleet currently uses static forms, and Product/Warehouse forms retain their existing Inventory owners; this decision does not register new Settings form modules or expose the whole Inventory form/import catalog. Existing Product imports remain available under the established Finance import policy. In-module Warehouse import tools retain their native owners and permission gates.

## 3. Source findings and implementation

| Area | Baseline finding | Implementation |
| --- | --- | --- |
| Product discovery | Product work is inside the large Inventory workspace; there is no dedicated Product route. | A bounded `/products` catalog composed from existing queries, form definitions and operation owners. Supported category/UOM choices, record relationships and import handoffs are preserved. |
| Warehouse discovery | Operational stock, locations, transfers and count flows already live inside Inventory, mixed with wider WMS surfaces. | Project the selected operational tabs, preserve canonical `/inventory/transfers/:id` links, join readable names without changing source quantities/units, and retain current mutation owners. |
| Fleet list and history | The list already uses `moduleCollection`; driver, service and inspection workflows share `useFleetActions`. | Keep one action owner and the current design tokens/components; improve list/filter and record hierarchy while keeping real actions reachable. |
| Fleet retry | The form adapter generates a fresh service/inspection request key on each submit. | Retain the submitted payload and identity for unresolved saves; use exact readback and explicit same-request recovery. |
| Fleet detail | Vehicle detail defaults failed history/lookups to empty arrays and does not reuse the list's company filtering. | Distinguish unavailable/denied/loading from empty and confirmed zero; keep current company and authorized lookup scope intact. |
| Admission and release record | Fleet and Inventory are review surfaces and these bounded workspaces are absent from alpha discovery. | Document the explicit bounded-alpha decision, preserve strict lifecycle evidence, register `/products` and `/warehouse`, and test the shared sidebar, palette and direct-route policy. |

The new workspaces retain existing query, form and mutation owners. The shared surface catalog controls discovery and direct-route admission; native permissions continue to control data and effects. This change is independent of existing open alpha/setup workstreams.

## 4. Mobbin reference decisions

These inspected references inform structure inside Lumière's current components, theme and ERP vocabulary.

| Reference | Decision used | Limit |
| --- | --- | --- |
| [Square catalog](https://mobbin.com/screens/52090cd8-c029-420e-a92e-60f2a586815a) and [Klaviyo catalog](https://mobbin.com/screens/7021c620-ec7c-4131-ba4b-7e692499324d) | Group catalog navigation and filtering with the table and its main action. | Preserve Lumière's product fields, permissions and operation owners; do not import reference branding or example records. |
| [Snowflake list](https://mobbin.com/screens/59f6c345-3e8a-4d5e-973e-e80389fce80e) | Structural example for keeping list navigation and filtering together. | Cross-domain reference for layout only; no inference about Fleet or ERP semantics. |
| [Turo vehicle search](https://mobbin.com/screens/e975c01c-b24c-4ea1-bbe9-7f51b07c869e) | Vehicle search with a clear way to reset filters when nothing matches. | Search-empty presentation only. Its rental business model does not apply to Lumière's tenant-owned Fleet, and the reference does not establish maintenance, mileage or accounting behavior. |
| [Uvodo inventory](https://mobbin.com/screens/00a34dc2-db3f-4a71-a408-0508f3e061ff), [Fresha stock on hand](https://mobbin.com/screens/17fb76f9-8b9d-4365-a4e3-dae35775780a), and [Square item/location table](https://mobbin.com/screens/78f2c018-e2c9-440c-8b5c-e631b2539163) | Readable product identity/SKU, named locations, quantities and table-adjacent search/location filtering. | Borrow presentation only. Preserve existing count, stock and transfer operation owners; no new direct-set quantity shortcut, storefront or reference sample data. |

Reference-led interface changes do not prove business outcomes. The implemented screens and actual interaction evidence determine what this release record may claim.

## 5. Existing Fleet accounting evidence

[COV-15](../plan/erp-cov15-fleet-service-cost-status.md) already accepts the bounded monetary service/inspection path: service amount plus selected journal/expense/offset accounts, exactly one same-scope Posted balanced entry, canonical service-to-entry linkage, exact request replay, period-lock rollback and reader denial. Preserve that owner and its tests.

That accepted slice does not certify the full Fleet lifecycle. Driver assignment, fuel history, canonical employee/fuel effects, wider refresh/direct-navigation/cross-company proof and independent human usability/accessibility review remain separate acceptance items unless this change supplies exact evidence. The existing service-type prerequisite is an explicit fresh-tenant release gate: `create_fleet_vehicle_service_type` remains denied by the current browser operation contract. A prerequisite notice explains the limitation but does not implement setup. Any pilot provisioning needs an already authorized path; a seeded test service type is not operator setup proof. Existing `RecordHeaderActions` for `vehicle` already supplies exact-readback details and manual odometer editing, which this work preserves.

## 6. Acceptance register

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Catalog/admission | Full and alpha navigation; sidebar/palette agreement; direct route and reload; Products/Warehouse/Fleet visible only through the intended policy and existing permissions; `/map` and unrelated review routes stay contained. | Profile/catalog and mounted palette tests pass (33 cases). Fixture tab containment and Warehouse tab reload pass; live palette/direct-route browser acceptance remains pending. |
| Product operator work | Catalog search/filter/reset, named categories/UOMs, permitted create/edit, retained invalid entries, import/record handoffs; distinguish loading/denied/failed from empty. | Implemented; 7 catalog, 5 creation validation and 5 existing product-record tests passed. Live tenant operation acceptance remains open. |
| Warehouse operator work | Named product/location/UOM joins, exact location filters, source on-hand versus counted quantities in the list and detail, transfer record links, permissioned stock/setup/count actions, invalid-input rejection and excluded-tab containment. | Projection/detail and count-input/scope model tests pass (14 cases); 4 existing count-observation tests also pass. Integrated browser results are below; native effect acceptance remains open. |
| Fleet operator work | Tenant-owned vehicle registration/search/filter/reset, details, lifecycle, assignment, garage maintenance/service costs, manual mileage and inspection entry; scope changes cannot expose stale company choices/history. Preserve the existing exact-readback detail/odometer actions; identify broader lifecycle gaps without claiming new telemetry. | Implemented; 22 Fleet route/owner tests and 9 mounted production vehicle-page tests passed. No full lifecycle claim. |
| Fleet exact effects | Preserve COV-15 monetary proof; unresolved response retains original request; same-request recovery cannot create duplicate service/inspection/accounting effects. | Historical bounded proof preserved; 21 existing exact-effect/lifecycle query-hook tests pass against pinned contracts 0.3.158. New uncertainty/reload/scope cases are included in the Fleet owner tests. |
| Visual/keyboard | Actual before/after renders at desktop and narrow widths; reachable controls, focus and dialogs; no hidden required fields or page overflow introduced. | Actual before/after captures at 1440px and 390px are recorded below. Ten fixture browser cases pass across fresh batches, including filters, Escape dismissal, error states, retained form input and no document overflow. Full keyboard/accessibility and human review remain open. |
| Integration | Focused unit/model/UI checks, relevant types/lint/i18n and unchanged COV evidence ratchet; matching-head CI and selected real-service browser proof. | 120 focused unit/model/component cases, 10 browser fixture cases and 39-file focused compiler check pass. Full-project typecheck, matching-head CI and selected real-service acceptance remain open; limits are recorded below. |
| Human/release | Independent task review, separately authorized release, actual served revision and read-only hosted smoke. | Not performed by source implementation. |

Use existing tests before creating a second harness: `workspace-profile.test.ts`, `product-surface-catalog.test.ts`, `inventory-module.spec.ts`, `inventory-mutations.spec.ts`, `fleet-record.test.ts`, `fleet-history-effect.test.ts`, `fleet-lifecycle.test.ts` and `cov15-fleet-service-cost.spec.ts`. Add targeted regressions only for behavior changed here. UI fixtures with simulated HTTP prove component behavior, not live ERP or accounting effects.

### Execution record

- Baseline `python3 scripts/validate-cov00d-evidence-matrix.py`: passed on `8361d7d3b6e204e6629830e0877a04f41a516677` before edits. No evidence scores were changed.
- Warehouse helper model checks: `node --import tsx 'app/(modules)/inventory/warehouse-workspace.test.ts'` passed 8/8. They cover exact IDs/units/source quantities, unknown/denied joins, source-versus-counted labels in list/detail, action/record owner preservation, tab containment and withholding immediate replenishment execution without its exact permission gate. These are pure model checks, not live command proof.
- Count-input/scope helper checks: `node --import tsx 'app/(modules)/inventory/cycle-count-input.test.ts'` passed 6/6, and the existing `src/inventory/cycle-count-adjustment.test.ts` observation suite passed 4/4. Exact identifiers, invalid/blank quantity rejection, unchanged stock unit and revoked/changed scope are covered; this does not establish live end-to-end count acceptance.
- Updated UI profile/surface tests: 16/16 passed; changed catalog lint, COV evidence validator and whitespace check passed.
- Full application typechecking did not complete in this environment. Earlier default-heap runs exhausted memory; the isolated canonical attempt (`node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit`) was OS-killed with exit 137 under the 8 GiB limit before emitting diagnostics. This is not a typecheck pass; full typecheck/CI remains required.
- Product catalog/creation/record models: 17 tests passed. Fleet route/owner tests: 22 passed; production vehicle-page/read-model UI tests: 9 passed; existing Fleet exact-effect/lifecycle contract tests: 21 passed.
- Navigation/profile/surface and command-palette checks: 33 tests passed. Product and Warehouse discovery share an existing resource permission but remain separated by admitted surface IDs.
- Repository guards passed for i18n keys/duplicates/locale policy, shared Select usage, code ownership, opaque-record debt, browser-operation generation (949 operations), immutable operation transport, COV evidence/correctness/seed inventory, first-org fixture manifest, accounting casts and reducer literals. The opaque-record baseline decreased from 2,260 to 2,259; no allowance was added.
- Local dependencies were aligned to the repository’s vendored `@lumiere/contracts@0.3.158` before final contract checks. No generated contracts or pins were changed. Fleet generated types and operation descriptors are identical to the initially available cache.
- Known baseline/tooling limits: the trusted-route guard flags unchanged `api-server/src/routes/knowledge_guides.rs` at the two existing direct reducer sites. Canonical vendored verification was blocked by `spawnSync tar EPERM`, while a read-only Python equivalent validated the pin/tarball/lock integrity. Build-cache tooling could not run through this environment’s pnpm store; the HTTP-option artifact was not staged (its 6 parser tests pass); full native code generation was not rerun.
- Focused TypeScript compiler-API checking passed for 39 changed/new source and test files with the real web compiler options and aliases: zero option, syntax or semantic diagnostics. It found four Fleet union-narrowing issues, which were corrected and rechecked. Generated/fixture/build outputs were excluded; this focused check does not replace the full-project gate.
- Browser fixture suite: all 10 cases passed across fresh server/browser batches. The first five cases passed in the full run (Products/Fleet/Warehouse at 390px and Products/Fleet at 1440px); the remaining five passed with `--grep 'warehouse quantities.*1440|distinguishes|failed vehicle'`. The single full run exhausted the environment's memory during the sixth case and did not pass as a whole. CI runs the complete registered suite and remains an independent gate.
- Browser coverage uses production `ModuleView`, forms and the changed table/workspace projections with fixed synthetic props. It covers both widths, facet/reset/search behavior, Warehouse tab reload and correct source quantities, exact Fleet accounting links, unavailable/denied/empty states, and retained input on a deliberately rejected vehicle form. No live ERP query or mutation hooks run in this fixture; the separate mounted vehicle-page tests exercise the production controller against mocked boundaries.
- Actual baseline/candidate captures, measured highlight regions and standalone Mobbin comparison boards are in the [visual evidence index](../evidence/product-fleet-warehouse-alpha-2026-10-31/README.md). Both captures use UTC and the same synthetic records. The baseline is the source revision above; candidate evidence is included in this change's tree.
- Matching-head CI and live tenant acceptance have not been certified by these local results.
- No merge, deployment or production data changes are implied by this document.

## 7. Warehouse implementation and release boundaries

`warehouse-workspace.ts` projects exactly eleven existing tabs: `stock`, `lots`, `serials`, `transfers`, `stock-moves`, `adjustments`, `cycle-counts`, `cycle-wizard`, `warehouses`, `locations`, and `replenishment`. The workspace starts on Stock and presents Stock, Movements, Counts, and Setup groups. The URL allowlist and group membership use that same set; unsupported `?tab=` values cannot restore excluded panels. Canonical transfer record pages remain `/inventory/transfers/:id`.

Named joins retain the original IDs and numeric values. Stock on hand reads `StockQuant.quantity`; the Counted column shows `inventoryQuantity` only when `inventoryQuantitySet` is explicitly true, separately from available/reserved quantities. An unset count remains unavailable rather than presenting its stored default zero as an observation. Movement rows use their recorded `productUom`, while stock uses the product’s base unit; no conversion is inferred. Missing references show unavailable, and denied/failed required reads close the composed view instead of presenting cached names or zero stock.

The existing New warehouse form copies an existing operational template; it cannot initialize a first warehouse. Initial locations, picking types and a usable warehouse template require authorized provisioning before that create path is usable. Missing templates and failed warehouse creates reject the submit and retain its input. This is a pilot setup gate, not proof of self-serve WMS onboarding. Other admitted create forms now reject missing adapters/references instead of resolving as a successful no-op.

The cycle count wizard continues to use the existing plan/session/line/validation/posting owners. IDs pass as exact u64 values, blank/negative/nonfinite quantities reject, and the chosen count unit must be the product's stock unit because the native posting path does not convert units. Each action uses its native permission resource/action and current actor/company scope. The wizard clears on scope changes, and posting checks scope before and after its preflight read and immediately before dispatch. After plan creation the operator chooses the plan explicitly; the UI no longer selects the newest/highest ID. Posting retains the successfully submitted line as the existing observation target instead of reading later form edits. Native saved-effect, multi-line, ambiguous-response recovery and concurrency acceptance remain gates until executed. Broader Inventory reads still mount with the reused client even when their tabs are not projected, which is an implementation limitation rather than an admission of those surfaces.

## 8. Future IoT/GPS mileage

An installed tracker may later contribute observed positions and derived traveled distance through the IoT integration. That work is not implemented or admitted by this UI change. Keep the existing manually observed odometer separate from any GPS-derived distance; a tracker path must not silently replace the vehicle's recorded odometer.

Before automatic mileage is implemented, its contract must retain the value and unit, source/device, observation timestamp, receipt timestamp and stable event identity. GPS segments need an explicit derivation method and quality/gap handling. Reconciliation must explain how manual readings and derived distance relate, preserve corrections/provenance, reject stale or duplicate effects, and respect the vehicle's current tenant/company and actor/device authority. Show source and freshness in the eventual UI. The existing `odometer_km` fields are manual observations in kilometers; they are not proof that GPS-based mileage exists.

The telemetry/history architecture, device provisioning, offline delivery and any unit conversion policy need separate implementation and validation. Do not infer missing historical distance from a current position or label estimated distance as an observed odometer reading.

## 9. Release boundary

Ship the reviewable alpha candidate only with an exact source revision and recorded results. Keep unsupported capability and setup boundaries visible. Do not relabel a skipped, mocked or historical check as current live acceptance; do not promote wider module certification to satisfy a navigation assertion.
