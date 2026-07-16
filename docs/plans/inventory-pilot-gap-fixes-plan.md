# Inventory Pilot-Critical Gap Fixes

Checklist for tranche-1 fixes from [INVENTORY_WAREHOUSE_MANAGEMENT_INVESTIGATION.md](../INVENTORY_WAREHOUSE_MANAGEMENT_INVESTIGATION.md).

## Status (2026-07-16)

- [x] Remove 20 phantom BFF keys; rewire UI/hooks to real reducers; hide dead actions
- [x] Wire inventory workspace keys into `ERP_ORG_SQL` via `erp-subscriptions.ts` + `make codegen`
- [x] Shrink workspace: drop `warehouse-3d`, `inventory-valuations`; add `quality-alerts`
- [x] Hot-path picking validate: `picking_key` + `move_by_picking` index (Option columns not filterable in STDB 2.0.1)
- [x] Domain tests: company isolation on reserve + ATP fail-closed (`run_inventory_*` + `run_all_inventory_tests`)
- [x] Reconcile purchasing investigation receipt narrative
- [x] Update inventory investigation pilot-critical status
- [x] Option 2: lot/serial enforcement on reserve/validate when `product.tracking` is lot/serial (+ domain tests)
- [x] FEFO + expiry block on lot/serial reserve/validate
- [x] Move-level `StockMove.serial_id` (+ validate consume)
- [x] `execute_replenishment_rule` creates draft PO or internal transfer demand
- [x] Quality fail → quarantine location + remove from ATP (`fail_quality_check` / `quarantine_quantity`)
- [x] Wave release orchestration: `release_picking_wave` → confirm/assign + pick tasks; validate blocked by open tasks; complete requires tasks + pickings done
- [x] UoM conversion on move create / reserve / validate (`convert_uom_quantity` → stock UoM)
- [x] Inventory close: snapshot lines + lock stock mutations (`create/run/reopen_inventory_close`)
- [x] Inventory close GL valuation: optional posted `AccountMove` Entry + `account_move_id` on close
- [x] 3PL durable intents: `create_inventory_integration_intent` + `record_inventory_integration_result` (ASN inbound can post stock)

- [x] Cartonization: `create_packaging_material` + `run_cartonization` (FFD) stamps `result_package_id`
- [x] Consignment ownership: activate/receive with `owner_id`; consigned excluded from company ATP
- [x] Cross-dock: `execute_cross_dock` outbound from inbound dest when `warehouse.crossdock`
- [x] Directed putaway: `execute_directed_putaway` (rule / least-loaded / fixed)

## Verify after publish

- [ ] `spacetime call <db> run_all_inventory_tests`
- [ ] Inventory module smoke (tabs + transfer validate)
- [ ] `make check-codegen` clean in CI
