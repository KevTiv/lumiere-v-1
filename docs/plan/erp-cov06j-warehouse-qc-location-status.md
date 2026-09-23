# COV-06j Warehouse QC location becomes configurable

**Package:** `COV-06j`
**Disposition:** `IMPLEMENTED` (backend only) — frontend wiring blocked, runtime acceptance pending
**Stacked base:** PR #72 / `codex/cov06i-serial-reserve-lifecycle`
**Operator proof:** native domain test only — no browser proof in this slice (see blocker below)

## Bounded path

```text
existing warehouse, no wh_qc_stock_loc_id configured
→ update_warehouse with wh_qc_stock_loc_id = <a location in this org>
→ exact same Warehouse.id now carries that QC location
→ (a cross-org location is rejected; the warehouse is left unchanged)
```

## Changes

- `wh_qc_stock_loc_id` was settable only at `create_warehouse` time (`UpdateWarehouseParams` never carried it, confirmed in COV-06g). The dev seed's default warehouse leaves it `None` and no reducer anywhere could set it afterward — `fail_quality_check`'s own fallback to a configured warehouse QC location was permanently dead for any already-created warehouse, which is why COV-06g had the "fail" UI action prompt for a quarantine location explicitly instead.
- `update_warehouse` (`spacetimedb/src/inventory/warehouse.rs`) now accepts an optional `wh_qc_stock_loc_id`, validated with the same `require_location_in_org` check other location fields use elsewhere in this module (must belong to the organization and be active) before being applied.
- Added a native domain test (`test_update_warehouse_qc_location`, wired as `run_inventory_warehouse_qc_location_test`) proving: a cross-organization location is rejected without mutating the warehouse; a same-organization location is accepted and persists on the exact warehouse id.

## Blocker: no frontend wiring in this slice

`UpdateWarehouseParams`'s TypeScript shape is generated code from the separately-versioned `@lumiere/contracts` package (fetched via git dependency, pinned in the lockfile) — it is not part of this repository and cannot be hand-edited here. The frontend cannot pass `whQcStockLocId` through `update_warehouse` until that package is regenerated and re-released to include the new field (the same kind of contracts-pin dependency noted in prior sessions' AIH-13 work: `release-compatibility-manifest.json`'s pinned release is materially behind `main`). This slice is therefore backend-only:

- No UI action to set a warehouse's QC location — the COV-06g "fail" action's explicit quarantine-location prompt remains the only usable path until the contracts release lands and a follow-up slice adds the UI.
- No browser proof — there is no frontend surface to drive yet.

## Runtime validation required

```bash
spacetime publish <db> --clear-database -y --module-path spacetimedb
spacetime call <db> run_all_inventory_tests
```

Do not mark this slice `ACCEPTED` until that runtime proof passes, and do not attempt frontend wiring until `@lumiere/contracts` is regenerated/re-released to include `wh_qc_stock_loc_id` on `UpdateWarehouseParams`.

## Next bounded work

Once `@lumiere/contracts` is regenerated to include this field: add a UI action (or a warehouse settings form field) to set `wh_qc_stock_loc_id`, and simplify COV-06g's "fail" action to prefer it over the manual prompt again — the fallback prompt should stay for organizations that never configure one. Otherwise, the remaining named gaps (the internal-transfer replenishment path, the "no demand needed" outcome, `use_serial`/`block_serial` typed workflows, and a replenishment scheduler) are still open.
