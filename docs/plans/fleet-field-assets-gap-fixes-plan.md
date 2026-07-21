# Fleet & Field Assets — Gap Fixes Plan

Backlog derived from [FLEET_FIELD_ASSETS_INVESTIGATION.md](../FLEET_FIELD_ASSETS_INVESTIGATION.md) (2026-07-21).  
NetSuite is a **quality bar**, not a feature-copy spec.

## Wave A — Pilot integrity (company, contracts, map honesty)

- [x] Require `company_id` on create; company guards on all fleet mutators; isolation domain tests
- [x] Migrate `create_fleet_vehicle` / position upsert to `*Params` + flat scope ids (reducer conventions)
- [x] Fix map empty-state (no silent `DEMO_PINS` in production policy); register/query `warehouse_geo`
- [x] Fix `useWarehouseGeo` to read geo table (not `/api/query/warehouses`)
- [x] Remove or quarantine aspirational phantom reducer names in coverage scripts

## Wave B — Telemetry boundary (STDB ops state vs TS history)

- [ ] Define telematics worker + time-series tier contract (write history off-STDB)
- [ ] Watermarked last-known position reducer (idempotent; throttle; no per-sample audit)
- [ ] Gateway permission / identity separate from dispatcher UI role
- [ ] Bounded subscriptions: offline / maintenance queues

## Wave C — Finance link + thin cost spine

- [ ] `fleet_vehicle` ↔ `account_asset` link + dispose convergence
- [ ] Capitalize-from-purchase path (purchasing adjacency)
- [ ] Fuel/cost entry → JE + vehicle TCO drill-down
- [ ] UOM defaults (km, L) + country-pack overlays (FBT flags AU)

## Wave D — People & field ops

- [ ] Driver master / assignment windows (HR or contractor)
- [ ] Offline inspection capture (`client_request_id` + intent)
- [ ] Maintenance WO + inventory parts consumption

## Wave E — Dispatch, geofence, integrations (competitive → differentiating)

- [ ] Trip/dispatch headers + odometer start/end
- [ ] Geofence + incident workflow
- [ ] OEM / fuel-card / e-toll `fleet_integration_intent` workers
- [ ] Dedicated `/fleet` module UI beyond map sidebar

## Out of scope until waves A–C land

- Predictive maintenance ML
- Full multi-stop optimization
- Corridor packs for non-in-tree countries (BW/NA/MZ)
