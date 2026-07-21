# Fleet & Field Assets — Investigation

Current-state assessment of Lumiere fleet / field assets against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-21  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this investigation unless noted under Validation.

**Verdict:** Lumiere has a **map-oriented geo demo shell**, not a fleet / field-asset product. The only operational fleet surface is `fleet_vehicle` plus two reducers (`create_fleet_vehicle`, `update_vehicle_position`) rendered on `/map` with hard-coded Northern-Hemisphere demo pins when live rows are empty. Live GPS/status/fuel/odometer are **mutated onto the vehicle row** (no history table), which is **unsuitable** for high-volume telematics and will thrash subscriptions/audit if gateways call position updates at telemetry cadence. Adjacent accounting fixed assets (`account_asset`) cover depreciation lifecycle but have **no FK** to vehicles; expense mileage is employee reimbursement (not fleet fuel TCO); IoT `iot_telemetry` stores high-write readings **inside** SpacetimeDB (manufacturing/device path) and is not fleet-wired. Against the quality bar this is **unsuitable for Southern-Hemisphere fleet ops or asset financial close**: no drivers/assignments, inspections, maintenance, fuel costs, dispatch/routes, incidents, geofencing, CAPEX↔ops link, offline field capture, or purpose-built time-series tier.

**Quality benchmark (not a spec):** Oracle NetSuite Fixed Assets Management emphasizes acquisition→depreciation→disposal with procurement/GL integration and multi-subsidiary asset registers ([NetSuite Fixed Assets Management](https://www.netsuite.com/portal/products/erp/financial-management/finance-accounting/fixed-assets-management.shtml)). Native NetSuite does **not** provide GPS/telematics; fleet depth in NetSuite ecosystems comes from SuiteApps / integrations that connect live location, dispatch, and cost back into ERP ([SuiteFleet](https://www.suitefleet.com/netsuite-fleet-management-suiteapp); [Locate2u × NetSuite](https://www.locate2u.com/products/fleet-management/oracle-netsuite/)). Lumiere is judged on whether it can meet that *depth of operational control + financial drill-down + safe telemetry boundaries*, not on SuiteApp parity.

**V1 roadmap reconciliation:** `docs/V1_ROADMAP.md` does **not** currently call out a Fleet / Field Assets wedge. Treat this investigation as the source of truth for fleet depth until a roadmap claim is added.

**Compile check:** `cargo check` in `spacetimedb/` — **passed** (2026-07-21; unrelated warnings in workflow packs).

**Trackers:** [Gap-fixes plan](./plans/fleet-field-assets-gap-fixes-plan.md) (scaffold)

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/fleet` + adjacent)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Vehicle registry + live GPS | `fleet_vehicle` | `fleet/fleet.rs` | Name, plate, free-text `driver_name` / optional `driver_id` Identity, `VehicleStatus`, lat/lng/speed/heading, `last_position_at`, `fuel_level` (0–1), `odometer_km`, free-string `vehicle_type`, optional `company_id` |
| Position / telemetry history | — | — | **No** history table; position overwrites row |
| Drivers / licenses / assignments | — | — | `driver_name` string only; no HR employee FK, no license class, no assignment window |
| Inspections / DVIR | — | — | **Absent** |
| Maintenance / work orders | — | — | Status enum value `Maintenance` only |
| Fuel / energy logs | — | — | `fuel_level` snapshot only |
| Cost / TCO ledger | — | — | **Absent** |
| Dispatch / trips / stops | — | — | **Absent** (inventory `stock_route` is warehouse routing, not vehicle dispatch) |
| Routes / ETAs / POD | — | — | **Absent** |
| Incidents / claims | — | — | **Absent** |
| Geofences | — | — | **Absent** |
| Telematics device link | — | — | **No** `iot_device` ↔ vehicle FK |
| POS geo (co-module) | `pos_terminal` | `fleet/fleet.rs` | Retail POS lat/lng + daily_revenue — **not** fleet |
| Warehouse geo | `warehouse_geo` | `fleet/fleet.rs` | Lat/lng enrichment for `warehouse_id` |
| Fixed assets (adjacent) | `account_asset`, `account_asset_depreciation_line` | `accounting/fixed_assets.rs` | Financial FA; **no** `fleet_vehicle_id` / VIN / plate |
| Expense mileage (adjacent) | `hr_expense` + `hr_expense_mileage_rate` | `expenses/` | Employee cents/km reimbursement — **not** vehicle fuel cost |
| IoT telemetry (adjacent) | `iot_telemetry`, `iot_threshold` | `iot/telemetry.rs` | High-write readings **in** SpacetimeDB; device/org scoped; quality/mfg sensors — **not** fleet GPS history |
| Purchasing / inventory CAPEX | PO / product / stock | purchasing / inventory | **No** verified “receive vehicle → create FA + fleet row” path |
| Projects (adjacent) | `project_project` | projects | **No** vehicle / equipment assignment |

**Enums (`fleet/fleet.rs` + `types.rs`):**

| Concept | Values | Notes |
|---------|--------|-------|
| `VehicleStatus` | Active, Idle, Maintenance, Offline | Parsed from snake strings on position update |
| `PosStatus` | Open, Closed, Error, Maintenance | POS only |
| `AssetState` | Draft, Running, Close, Removed | Fixed assets |
| `AssetType` | Purchase, Sale | **Not** vehicle class taxonomy |
| `vehicle_type` | free string (`truck`, `van`, `bike`, …) | No UOM / axle / GVM / license-class validation |

### 1.2 Backend reducers (callable SpacetimeDB surface)

**Fleet (`fleet/fleet.rs`):**  
`create_fleet_vehicle`, `update_vehicle_position`, `create_pos_terminal`, `update_pos_terminal`, `upsert_warehouse_geo`

**Fixed assets (`accounting/fixed_assets.rs`) — adjacent:**  
`create_account_asset`, `update_account_asset`, `delete_account_asset`, `confirm_account_asset`, `close_account_asset`, `create_depreciation_line` (via params), depreciation posting helpers, `dispose_account_asset`, `set_asset_active`

**IoT (`iot/telemetry.rs`) — adjacent, not fleet-wired:**  
`record_telemetry`, `record_telemetry_batch`, `set_iot_threshold`, …

| Reducer | Behavior | Gap |
|---------|----------|-----|
| `create_fleet_vehicle` | Org permission; inserts Idle vehicle; `company_id: None`; flat args (no `*Params`); hardcodes status/fuel/odometer | Violates reducer conventions; no company scope; no VIN/registration/FA link; no unit system |
| `update_vehicle_position` | Overwrites lat/lng/speed/heading/status/`last_position_at`; writes audit every call | **No history**; fuel/odometer untouched; high-frequency calls = subscription + audit storm; no geofence/incident side effects |
| POS / warehouse geo | Geo CRUD + audit | Useful for map layers; not fleet lifecycle |
| Account asset CRUD/lifecycle | Confirm → depreciate → dispose with GL accounts | No link to `fleet_vehicle`; AssetType not vehicle-aware |
| IoT telemetry ingest | Inserts immutable reading rows in SpacetimeDB | Wrong tier for continuous GPS; no vehicle subject |

**Absent (no reducers/tables):** update/delete vehicle metadata, assign/unassign driver, odometer/fuel log, inspection checklists, maintenance WO, trip/dispatch start/complete, route optimize, incident report, geofence CRUD/breach, telematics gateway intent, FA↔fleet link, capitalization from PO, fleet cost JE, offline outbox for field forms.  
**Aspirational phantoms** (listed in `frontend/web/scripts/track-reducer-coverage.ts`, **not** implemented): `update_fleet_vehicle`, `delete_fleet_vehicle`, `update_vehicle_odometer`, `create_fleet_driver` / assign, `create_fleet_trip` / start/complete, `create_fleet_fuel_log`, `create_fleet_service`, …

### 1.3 Frontend contracts (BFF / hooks)

[`FLEET_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/fleet-http.ts): **2** keys (`create_fleet_vehicle`, `update_vehicle_position`). **0 phantoms** vs SpacetimeDB. POS/warehouse geo live under POS / inventory BFF, not fleet BFF.

| Surface | Status |
|---------|--------|
| Query hooks | `useFleetVehicles` (fleet + map packages); map also loads POS + “warehouse geo” |
| Mutations | Create vehicle + update position only |
| Warehouse geo read bug | `useWarehouseGeo` calls `/api/query/warehouses` — **not** `warehouse_geo` table; map pins expect geo fields → live warehouse layer often empty → **demo pins** |
| Workspace keys | `FLEET_WORKSPACE_RESOURCE_KEYS` = `fleet-vehicles`; map subscription adds POS + `warehouses` (still no `warehouse_geo` resource in query registry) |
| Contract test | `fleet.contract.ts` — compile-only BFF enumeration |
| Dedicated `/fleet` module | **Absent** — ops UI is `/map` sidebar only |
| Fixed assets UI | Accounting tab `fixed-assets` — independent of map/fleet |

### 1.4 Subscriptions & queries

| Key | In `ERP_ORG_SQL` | Filter / notes |
|-----|------------------|----------------|
| `fleet-vehicles` | Yes | Org-scoped → `fleet_vehicle` ORDER BY name |
| `pos-terminals` | Yes | POS workspace |
| `warehouses` | Yes | Used by map subscription — **not** geo table |
| `warehouse_geo` / `warehouse-geo` | **No** query resource | Table exists; not registered for HTTP/SQL list |
| Live “vehicles in maintenance” / “offline > N min” queues | **No** | Client must filter full list |
| Telematics history subscription | **N/A** | Must not live in SpacetimeDB at scale |

### 1.5 UI operations (`/map` + accounting fixed assets)

| Tab / surface | End-to-end operations | Gaps |
|---------------|----------------------|------|
| Map | Layer legend; pins from live vehicles/POS or **DEMO_PINS** (NYC/LA/London/Paris/Tokyo); create vehicle; manual position form | Demo fallback masks empty/broken geo; manual lat/lng ≠ gateway telematics; no dispatch board |
| Map fleet forms | Name, type, plate, driver **name** (string); position fields including free-text status | No driver select; no company; no VIN; status not constrained to enum in UI |
| Accounting Fixed Assets | Create/update/confirm/close/dispose/depreciate | No “link to fleet vehicle”; no utilization from odometer |
| Inventory warehouse geo | `upsert_warehouse_geo` from inventory client | Map does not read that table via correct query |
| Offline / poor connectivity field UI | **Absent** | No outbox for inspections/fuel |

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain (Rust) | **None** under `spacetimedb/tests` for fleet | Company isolation, position overwrite, FA link |
| Contract | `fleet.contract.ts` | Runtime reducer presence |
| Playwright | `phase-9-edge-smoke.spec.ts` — `/map` loads, legend visible | Create vehicle; position update; no demo contamination assert |
| Adjacent FA | Accounting UI wired; **no** fleet domain tests found | CAPEX↔ops |

### 1.7 Seed

`seed.rs`: one `FleetVehicle` “Truck #101” with SF Bay coords, Active, fuel 0.72, odometer 12543 km, `company_id` set; POS + warehouse_geo demo; separate laptop `account_asset` named for coverage — **not** linked to the truck.

---

## 2. Gap matrix (quality bar vs inventory)

Definitions:

- **Present** — usable end to end with operational and/or financial consequences.
- **Partial** — implemented at limited depth, or missing an essential UI, policy, reporting, or integration layer.
- **Absent** — no meaningful implementation.
- **Unsuitable** — surface exists but cannot safely meet the workflow / accounting / scale requirement.

| Capability | State | Evidence | Priority |
|------------|-------|----------|----------|
| Vehicle registry | **Partial** | Create + list + seed; no update/delete/metadata Params; company often unset | Pilot-critical |
| Multi-entity company scope | **Unsuitable** | `company_id: None` on create; optional field unused by UI | Pilot-critical |
| Driver master + assignment windows | **Absent** | Free-text `driver_name` only | Pilot-critical |
| Live operational status / last known position | **Partial** / **Unsuitable** at telematics cadence | Row fields + `update_vehicle_position`; no history; audit-per-ping | Pilot-critical |
| Historical GPS / telematics store | **Unsuitable** (if forced into STDB) / **Absent** (correct tier) | IoT table is wrong subject + wrong scale; no TS tier | Pilot-critical |
| Geofencing | **Absent** | No tables | Competitive |
| Inspections (pre/post trip) | **Absent** | — | Competitive |
| Maintenance / service WO | **Absent** | Status enum only | Competitive |
| Fuel / energy logging + cost | **Absent** | Snapshot `fuel_level` only | Pilot-critical |
| Odometer integrity / UOM | **Partial** | `odometer_km` never updated by reducer; km-only naming | Pilot-critical |
| Dispatch / trips / stops | **Absent** | Coverage script phantoms only | Competitive |
| Routes / long-haul planning | **Absent** | Inventory routes ≠ fleet | Differentiating |
| Incidents / claims | **Absent** | — | Competitive |
| Fleet ↔ purchasing (buy / lease) | **Absent** | No PO→vehicle/FA automation | Competitive |
| Fleet ↔ inventory (spares / tyres) | **Absent** | — | Competitive |
| Fleet ↔ expenses (fuel cards, tolls) | **Partial** adjacent | Mileage expense ≠ vehicle cost center | Competitive |
| Fleet ↔ projects (equipment on job) | **Absent** | — | Differentiating |
| Fleet ↔ fixed assets / depreciation | **Absent** link / **Partial** FA alone | Separate modules; no FK | Pilot-critical |
| Cost / TCO / utilisation reporting | **Absent** | No cost ledger; map stats cosmetic | Competitive |
| Drill-down vehicle → cost → GL | **Absent** | — | Pilot-critical |
| Workflow controls (maint approve, disposal) | **Absent** (fleet) / **Partial** (FA confirm/dispose) | FA has state machine; fleet does not | Competitive |
| Offline / delayed-sync field ops | **Absent** | Contrast expenses capture outbox | Competitive |
| Regional UOM (km/L, left-hand traffic packs) | **Absent** | Hardcoded km; SF/US demo bias | Pilot-critical |
| Diverse vehicle classes (truck/ute/moto/boat) | **Partial** | Free-string type; no class rules | Competitive |
| Extensibility / CSV / import | **Absent** (fleet) | No fleet CSV | Differentiating |
| Integrations (OEM telematics, fuel cards) | **Absent** | Need intent/worker boundary | Differentiating |
| Map fidelity | **Unsuitable** | Demo pins when live empty; warehouse geo query mismatch | Competitive |
| Audit on fleet mutators | **Present** (MVP) | `write_audit_log_v2` — but over-fires on GPS | — |
| Phantom coverage names | **Unsuitable** (docs/scripts) | track-reducer-coverage invents reducers | Competitive |

---

## 3. Required invariants

### Accounting

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Operational vehicle linked to FA when capitalized | **No** | No FK | `fleet_vehicle.account_asset_id` (or reverse) required for owned assets; lease flag for non-owned |
| Acquisition cost from purchasing → FA → fleet | **No** | Modules disconnected | Capitalize from bill/receipt; create FA + vehicle in one txn or explicit follow-on with audit |
| Fuel/maintenance/toll costs post to correct expense/analytic | **No** | No fleet cost rows | Cost documents with `vehicle_id` + optional `account_move_id`; period lock |
| Disposal of FA retires operational assignment | **No** | FA dispose independent | Block Active dispatch when FA Removed/Close; clear assignment |
| Depreciation unaffected by GPS noise | **Yes** (by isolation) | FA separate | Keep telemetry out of FA tables |
| Multicurrency fuel in regional ops | **No** | — | FX snapshot on fuel/expense docs (reuse expenses pattern) |
| Period locks on cost postings | **No** (fleet) | — | Shared `ensure_accounting_period_open` |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Reducer permissions | Yes (pattern) | `check_permission` on fleet_* | Keep deny-by-default; separate `fleet_telematics` write role for gateways |
| Company ownership | **No** on create | `company_id: None` | Require `company_id`; guard all mutators; isolation tests |
| Driver PII / location sensitivity | **No** | Full org subscription to lat/lng | Field-level / role-gated live location; audit access |
| SoD on disposal / write-off | Partial (FA) | FA dispose permission | Workflow gate for write-off + ops decommission |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Mutation audit | Yes | CREATE/UPDATE on vehicle/position | Do **not** audit every GPS sample — audit status/assignment/cost events; sample refs in metadata |
| Assignment / inspection history | **No** | — | Append-only assignment + inspection event tables |
| Source links cost → JE | **No** | — | Store `account_move_id` on cost docs |

### Concurrency / integrity / scale

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Last-known position atomic | **Yes** (single reducer) | One txn updates row | Retain only **current** operational state in SpacetimeDB |
| Historical telemetry not in STDB hot path | **Violated** if GPS → `update_vehicle_position` or `iot_telemetry` at Hz | Row overwrite / IoT inserts | Gateway writes history to **time-series tier**; reducer upserts last-known + optional downsample alerts |
| Idempotent telematics | **No** | — | `device_event_id` / timestamp watermark; reject stale positions |
| Subscription fan-out bounded | **At risk** | Org-wide `fleet-vehicles` | Narrow “active / offline” queries; throttle position publish |
| Offline field forms | **No** | — | `client_request_id` + integration intent (expenses pattern) |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). External HTTP (telematics providers, fuel-card feeds, map tiles, e-toll) belongs in procedures/workers, not reducers.

---

## 4. Reference workflows

1. **Register vehicle** (class, plate/VIN, company, UOM, ownership) — Partial create; company/UOM Absent.
2. **Link / create fixed asset** (capitalize from PO or opening balance) — FA Present; link Absent.
3. **Assign driver** (license class, validity window) — Absent.
4. **Ingest telematics** (gateway → TS history + last-known in STDB) — Unsuitable (row mutate only).
5. **Geofence / exception alerts** — Absent.
6. **Pre-trip inspection** (offline-capable) — Absent.
7. **Dispatch trip / long-haul route** — Absent.
8. **Fuel / energy purchase** → cost + optional inventory — Absent (expense mileage adjacent only).
9. **Maintenance WO** → parts from inventory → cost — Absent.
10. **Incident / claim** — Absent.
11. **Utilisation / TCO report** with drill-down to GL — Absent.
12. **Transfer multi-entity** (company A → B) with FA history — Absent.
13. **Dispose / sell** (FA dispose + retire fleet) — FA Partial; fleet Absent.
14. **Map ops board** (live without demo contamination) — Unsuitable until geo query + empty-state honesty fixed.

### Acceptance scenarios (≥10)

1. Dispatcher creates vehicle with required `company_id`, class, plate/VIN, distance UOM (km), volume UOM (L); audit CREATE; second org cannot see it.
2. Capital purchase: receive PO / bill → create `account_asset` + linked `fleet_vehicle` in controlled reducers; book value visible from vehicle drill-down.
3. Assign HR employee (or contractor) as driver with license class + expiry; overlap assignment rejected; unassign audited.
4. Telematics gateway posts high-frequency GPS to **time-series** store; SpacetimeDB `fleet_vehicle` updates last-known ≤ configured cadence; stale timestamps rejected; org subscription does not receive per-second history rows.
5. Vehicle goes Offline when `last_position_at` older than policy; live “offline vehicles” subscription updates without full-table client scan.
6. Driver completes offline pre-trip inspection with `client_request_id`; sync once; defects can force status Maintenance and block dispatch.
7. Fuel purchase logged against vehicle (litres, amount, currency, FX snapshot); posts expense JE / analytic; appears on vehicle TCO; not conflated with employee mileage reimbursement unless explicitly linked.
8. Maintenance WO consumes inventory spare; cost + labour link to vehicle; FA useful life / maintenance flag optional update with audit.
9. Geofence breach or harsh event creates incident + optional workflow approval; does not insert raw telemetry into ERP tables.
10. Long-distance AU→regional trip: dispatch with stops; odometer start/end enforced; utilisation hours/km reported in pack UOM.
11. Multi-entity: company B cannot update position or assign drivers for company A’s vehicles (domain + e2e).
12. Dispose FA → vehicle cannot be dispatched; map status Removed/Retired; gain/loss JE drill-down from asset and vehicle.
13. Map empty-state shows **no** Northern-Hemisphere demo pins when live query returns empty; warehouse layer uses `warehouse_geo` (or joined) data.
14. Poor connectivity: fuel/inspection outbox retries idempotently; no double JE.
15. FBT/pack overlay (AU): entertainment/private-use flags on vehicle cost categories hold or warn per country pack metadata (not silent).

---

## 5. Localization matrix (units / compliance / connectivity / long distance)

Country packs today are **tax-seed + company-ID metadata + expense evidence/FBT flags** (`spacetimedb/src/core/country_pack.rs`). Fleet needs **measurement UOM, vehicle registration schemas, fuel-tax/FBT overlays, and offline field packs** — not only sale-tax seeds. Pack metadata must not be mistaken for live statutory adapters.

**i18n:** UI ships **English only** (`SupportedLanguage = "en"`). Map strings under i18n `map.*`. Country packs are not language packs.

Rates and rules below are **dated requirements as of 2026-07-21**, cited from official sources where linked — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA only in-tree) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|-----------------------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` only | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| Distance / speed UOM | km, km/h (seed uses km ✓ naming; demo coords US) | km | km | km (SG/MY/…) |
| Fuel UOM | Litres; diesel/petrol grades | Litres | Litres | Litres |
| Traffic side / ops norms | Left-hand | Left-hand | Right-hand (BR/AR/CL) | Left (SG/MY/ID/TH); right (PH) |
| Vehicle classes | Ute, road train, light commercial common | Bakkie, mining/haul trucks | Light truck, agri, long-haul | Motorcycle delivery, van, barge adjacency (ID/PH) |
| Registration / plate schemas | State/territory (AU); NZ plates | RSA licence discs | Mercosur / local plates | Country-specific; SG COE adjacency **procedure** |
| Fringe / private use | AU FBT on cars — pack has entertainment/FBT expense flags; **not** fleet-wired | Company car policies | Local benefits tax | Pack-dependent |
| Fuel tax / rebates | Excise / fuel tax credit adjacency — outside reducers | Fuel levies | ICMS on fuel complexity — **procedure** | Duties / SST adjacency |
| Long-distance ops | Interstate AU; sparse NZ | Cross-border SADC corridors (BW/NA/MZ **no packs**) | BR interstate; Andean corridors | Archipelago logistics (ID/PH); MY–SG |
| Connectivity | Outback / regional offline common | Mining/rural offline | Amazon / Patagonia gaps | Island / rural offline |
| Telematics privacy | Location as sensitive personal data — role gate | Same | LGPD (BR) adjacency | PDPA (SG/MY) adjacency |
| Map / geodesy | WGS-84 fine; avoid US-demo default centers for regional tenants | Same | Same | Same |
| Fleet pack gap | km/L defaults; FBT vehicle categories; state rego fields | ZA rego + fuel cost VAT reclaim evidence | Fuel NF-e / fiscal docs as **workers**; UOM | Multi-class incl. 2-wheel; e-toll integrations as **workers** |

### Official sources (dated; verify)

| Region | Authority / reference |
|--------|----------------------|
| Australia FBT / vehicles | [ATO — FBT](https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/fringe-benefits-tax); fuel tax credit pages on ATO |
| New Zealand | [IRD](https://www.ird.govt.nz); [NZTA](https://www.nzta.govt.nz) vehicle rules |
| South Africa | [SARS](https://www.sars.gov.za); [RTMC / DoT](https://www.transport.gov.za) |
| Singapore | [IRAS](https://www.iras.gov.sg); [LTA](https://www.lta.gov.sg) |
| Malaysia | [LHDN](https://www.hasil.gov.my); JPJ vehicle rules |
| Indonesia | [DJP](https://www.pajak.go.id); transportation ministry regs |
| Brazil | [Receita Federal](https://www.gov.br/receitafederal); CONTRAN / DENATRAN vehicle regs |
| Chile / Argentina | [SII](https://www.sii.cl); [AFIP / ARCA](https://www.afip.gob.ar) |
| Thailand / Philippines | [RD](https://www.rd.go.th); [BIR](https://www.bir.gov.ph) |

Neighboring Southern African markets (e.g. Botswana, Namibia, Mozambique) have **no** in-tree packs — relevant for corridor fleets based in ZA.

---

## 6. SpacetimeDB architecture decision (Fleet & Field Assets)

Quality benchmark: NetSuite-class **financial** asset control plus ecosystem **fleet ops** depth (live status, cost, maintenance) without copying SuiteApp feature lists ([NetSuite Fixed Assets Management](https://www.netsuite.com/portal/products/erp/financial-management/finance-accounting/fixed-assets-management.shtml); fleet via integrations such as [SuiteFleet](https://www.suitefleet.com/netsuite-fleet-management-suiteapp)). Architecture constraints: reducers are transactional and deterministic; subscriptions push row changes to clients; procedures/workers are the HTTP boundary ([SpacetimeDB Functions](https://spacetimedb.com/docs/functions/); [Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Subscription semantics](https://spacetimedb.com/docs/subscriptions/semantics)).

| Topic | Decision |
|-------|----------|
| **Operational state in SpacetimeDB** | Keep `fleet_vehicle` (and future assignment/inspection/trip **headers**) as the system of record for *current* status, last-known position, active driver, open WO counters. Index org, company, status, `last_position_at`. |
| **Historical telemetry out of SpacetimeDB** | Continuous GPS/CAN bus/fuel-sample history → **purpose-built time-series tier** (e.g. Timescale/ClickHouse/cloud TS) owned by a telematics worker. Do **not** use `update_vehicle_position` at 1 Hz, and do **not** dump fleet GPS into `iot_telemetry` as the long-term store. |
| **Position update reducer** | Gateway/worker calls a low-frequency upsert: last lat/lng/speed/heading/status + watermark. Idempotent on `(vehicle_id, event_ts)` / device sequence. Optional: write downsample exception events (speeding, geofence) as discrete ERP rows — not raw tracks. |
| **Audit policy** | Audit registry, assignment, inspection, cost, dispose. Suppress per-sample GPS audits (metadata pointer to TS event id instead). |
| **FA boundary** | Keep depreciation in `account_asset`. Add explicit link field + reducers `link_fleet_vehicle_asset` / capitalize-from-purchase. Disposal must converge ops + books. |
| **Cost documents** | New `fleet_cost_entry` (or reuse expense with required `vehicle_id`) posting via shared accounting helpers; never invent TCO in the client from map sidebar stats. |
| **Subscriptions** | Keep org-scoped vehicle list for registry. Add bounded live queries: `fleet-vehicles-offline`, `fleet-vehicles-maintenance`, `fleet-trips-active`. Do not subscribe clients to TS history. |
| **Isolation / scale** | Mandatory `company_id`; domain tests A↛B. Separate telematics gateway identity/permission. Index names unique module-wide. |
| **External I/O** | OEM telematics, fuel cards, e-toll, map providers, LGPD/PDPA export → **API workers / procedures** with `fleet_integration_intent` (mirror expenses). Reducers must not block on HTTP. |
| **Offline field** | Inspections/fuel capture: client outbox + `client_request_id` + delayed_sync intent (copy expenses pattern). |
| **IoT module boundary** | Manufacturing/device IoT remains for plant sensors. Fleet devices may register as `iot_device` **only** if subject metadata points at `fleet_vehicle_id` and history still lands in TS tier. |
| **UI honesty** | Remove or gate DEMO_PINS behind explicit demo mode; fix warehouse geo query resource; add dedicated Fleet module when lifecycle depth exceeds map sidebar. |
| **Reducer conventions** | Migrate create/update to `CreateFleetVehicleParams` / flat scope ids; no hardcoded company/status beyond derived defaults documented as exceptions. |

---

## 7. Priority classification

### Pilot-critical

| Gap | Why |
|-----|-----|
| Mandatory `company_id` + ownership guards + isolation tests | Multi-entity safety |
| Stop treating GPS as row history; introduce TS tier + watermarked last-known upsert | Scale + subscription integrity |
| Link `fleet_vehicle` ↔ `account_asset` (and dispose convergence) | Ops/finance quality bar |
| Driver assignment (HR/contractor) with audit | Field accountability |
| Fuel/cost entry with GL drill-down (even thin) | TCO / close |
| UOM defaults (km, L) + kill US demo as default truth | Southern Hemisphere pilot honesty |
| Fix map warehouse geo query / empty-state (no silent DEMO_PINS in prod) | Trustworthy ops UI |
| Telematics gateway permission + idempotency | Reliable integrations |

### Competitive

| Gap | Why |
|-----|-----|
| Inspections (offline) + maintenance WO + inventory parts | Lifecycle |
| Geofence + incident workflow | Control |
| Dispatch / trip headers with odometer start/end | Utilisation |
| Expense/fuel-card → vehicle cost center | Integrated spend |
| Purchasing capitalize → FA + fleet | Acquire-to-retire |
| Live offline/maintenance queues | Dispatcher inbox |
| Vehicle class taxonomy + license rules | Diverse fleets |
| Dedicated `/fleet` module beyond map | Product surface |
| Remove aspirational phantom reducer names from coverage scripts or implement | Hygiene |

### Differentiating

| Gap | Why |
|-----|-----|
| Long-haul / multi-stop optimization + corridor packs (SADC, archipelago) | SH market fit |
| Predictive maintenance from TS features → WO suggestions | Telematics value |
| Project/job equipment assignment + job costing | Field services |
| OEM/fuel-card/e-toll workers with rich intents | Ecosystem |
| Privacy-preserving live location (role-gated precision) | Regulated markets |
| CSV/import + mobile rugged device packs | Rollout speed |

**Recommended first wave (pilot):** company scope + Params cleanup → FA link → last-known position contract (no Hz audits) + TS worker stub → driver assign → thin fuel/cost JE → map empty-state/geo fix → isolation tests. Then inspections/maintenance/dispatch; then geofence/OEM integrations/long-haul.

---

## Validation

| Check | Result |
|-------|--------|
| Tables/reducers vs `spacetimedb/src/fleet/fleet.rs` | Verified 2026-07-21 |
| FA adjacency vs `accounting/fixed_assets.rs` | Verified — no fleet FK |
| IoT telemetry vs `iot/telemetry.rs` | Verified — in-STDB high-write; not fleet-linked |
| Expense mileage adjacency | Verified — reimbursement path only |
| BFF keys vs reducers | 2 fleet keys, 0 phantoms |
| Workspace / map subscription | `fleet-vehicles` + POS + `warehouses`; **no** `warehouse_geo` resource |
| `useWarehouseGeo` URL | `/api/query/warehouses` — verified mismatch |
| Coverage script phantoms | Drivers/trips/fuel/service names **not** in module — verified |
| `cargo check` (`spacetimedb/`) | **Passed** 2026-07-21 |
| Domain/E2E suites executed in this investigation | **No** — existence only (`fleet.contract.ts`, phase-9 map smoke) |
| Acceptance scenarios | 15 listed (≥10 required) |
| Every gap has state + priority | Yes (§2 / §7) |

---

## Bottom line

Lumiere Fleet today is a **live-map pin registry with a dangerous temptation to store telematics in the ERP row**. Fixed assets and expense mileage are real adjacent spines, but they do not form an integrated acquire→assign→operate→maintain→cost→dispose loop. The highest-severity gaps against the quality bar are **(1)** missing company/FA integrity, **(2)** position/telemetry architecture that will not survive real gateways, and **(3)** absence of cost, driver, and field workflows needed for Southern Hemisphere long-distance, multi-class, low-connectivity operations.

### Related docs

- [Gap-fixes tracker](./plans/fleet-field-assets-gap-fixes-plan.md) — checkbox backlog scaffold
- [Expenses investigation](./EXPENSES_INVESTIGATION.md) — mileage / offline outbox patterns to reuse
- [Inventory / warehouse investigation](./INVENTORY_WAREHOUSE_MANAGEMENT_INVESTIGATION.md) — spares / warehouse geo adjacency
- [Purchasing investigation](./PURCHASING_PROCUREMENT_INVESTIGATION.md) — capitalize-from-PO adjacency
- [Projects / PSA investigation](./PROJECTS_PSA_INVESTIGATION.md) — job equipment adjacency
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — no Fleet wedge claim at investigation time
- Fleet module: `spacetimedb/src/fleet/`
- Map UI: `frontend/web/app/(modules)/map/map-client.tsx`
- Fleet workspace: `frontend/packages/stdb/src/subscriptions/fleet-workspace.ts`
- E2E smoke: `frontend/web/tests/e2e/phase-9-edge-smoke.spec.ts`
