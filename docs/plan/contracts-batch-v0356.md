# Contracts batch for the next `lumiere-contracts` release

This branch collects **every contract change currently waiting on a release**, so one
`make publish-contracts VERSION=x.y.z` covers them all. Releases cannot be cut from CI or from
the authoring session; a maintainer with `lumiere-contracts` access publishes and pins it (see
`dec51e09` for the v0.3.54 pin).

## What the release carries

### Projection fields (`crates/stdb-auth/assets/resource_registry.json`)

| Resource | Added to the default projection | Needed by |
| --- | --- | --- |
| `stock-pickings` | `purchase_id` | COV-05 (#61) — same hunk as #61 |
| `stock-moves` | `purchase_line_id`, `is_done` | COV-05b (#62) — same hunk as #62 |
| `stock-moves` | `production_id`, `location_id`, `location_dest_id`, `product_uom`, `quantity_done` | COV-07b/c material and finished-move readback |
| `payment-reconciliations` | `write_off_amount`, `write_off_move_id` | PAY-06 (#78) — same hunk as #78 |
| `mrp-boms` | `product_id`, `product_uom_id` | COV-07a ("setup BOM is missing canonical product/UOM identity") |
| `mrp-bom-lines` | `product_qty`, `product_uom_id` | COV-07b expected raw moves |
| `mrp-productions` | `bom_id`, `origin`, `product_qty`, `product_uom_id`, `qty_producing`, `qty_produced`, `location_src_id`, `location_dest_id`, `move_raw_ids`, `move_raw_count`, `move_finished_ids`, `move_finished_count`, `workorder_ids` | COV-07a–d order readback |
| `mrp-workorders` | `workcenter_id`, `duration_expected`, `duration`, `progress`, `is_produced`, `time_ids` | COV-07d workorder execution |
| `mrp-workcenters` | `workorder_count`, `workorder_progress_count`, `productive_time`, `order_ids`, `productivity_ids` | COV-07d workcenter convergence |
| `stock-quants` | `lot_id`, `package_id`, `owner_id` | COV-07c finished-goods quant identity |
| `products` | `tracking` | COV-07b/c tracked-product setup |
| `timesheets` | `validation_status` | COV-10 exact validate/reject readback (validated non-billable and rejected entries are otherwise invisible) |

Every field was checked against the table struct it projects. The hunks for #61, #62 and
#78 are byte-identical to those PRs, so merging them later does not conflict.

### New reducer `create_company_stock_location`

`create_stock_location` always stored `company_id = None`, and company-bound users (the
warehouse persona) only see rows of their own company, so a location they created was
invisible to them — the COV-06 fixture failure. The new reducer takes
`(organization_id, company_id, params)`, validates the company is in the organization and that
a parent location is in the same organization and shared or owned by the same company, and
stores the company. `create_stock_location` is unchanged (organization-shared locations), so
nothing breaks before the release.

Authored manifests are updated (`reducer-exposure.json`, `contract-operation-ids.json`,
`operation-contracts/operations.json`). Native proof: `test_company_stock_location_scope`
in `spacetimedb/tests/inventory/tests/gap_fixes_test.rs`.

### Stacked-PR contract surfaces (#73, #77, #96, #98)

These stack PRs changed the module schema without registering it in the authored manifests, so
each would have needed its own contracts release. Their contract surface is ported here; hunks
are byte-identical to the stack PR unless noted, so merging the stacks later stays clean.

| PR | Ported | Manifests |
| --- | --- | --- |
| #73 COV-06j | `UpdateWarehouseParams.wh_qc_stock_loc_id` + the `update_warehouse` org-scope check and write; native test `test_update_warehouse_qc_location` and its runner `run_inventory_warehouse_qc_location_test` (whole `spacetimedb/` diff of #73) | runner: `contract-operation-ids.json`, `operation-contracts/people-platform.json` (denied `test`, like the other inventory runners) |
| #77 COV-06n | table `replenishment_run_job` (scheduled, private), `schedule_replenishment_run`, `cancel_replenishment_run`, `run_scheduled_replenishment`, the `execute_replenishment_rule_impl` split; native test `test_replenishment_scheduled_run_reschedules` (chained into `run_inventory_replenishment_demand_test`) — whole `spacetimedb/` diff of #77 | `schedule_*`/`cancel_*`: session, `command`; `run_scheduled_replenishment`: denied (absent from `reducer-exposure.json`), `internal`, like the other scheduled job reducers |
| #96 COV-07e | `inventory/quality.rs` hunks byte-identical: index `quality_check_by_workorder`, `create_workorder_quality_check`, `fail_workorder_quality_check`, workorder sync in `pass_quality_check`/`fail_quality_check`. Supporting code: `require_workorder_parent` and `require_workorder_execution_scope`, copied verbatim from COV-07d at the same position in `manufacturing_orders.rs` | both reducers: session, `command`, `state_guarded` |
| #98 COV-07g | `manufacturing/bill_of_materials.rs` hunks byte-identical: table `mrp_bom_byproduct` (public), `CreateBomByproductParams`, `create_bom_byproduct`, `delete_bom` cascade | session, `command`, `state_guarded` |

Every new reducer is in `contract-operation-ids.json`, has an `operation-contracts/*.json`
classification, and (session reducers only) a `reducer-exposure.json` entry.

What stays with the stack PRs (behavior, not contract shape):

- **#96:** the quality gates in `finish_workorder` and `finish_manufacturing_order`. Both functions
  are rewritten by COV-07d, so the hunks cannot land without COV-07d. Until #96 merges, a
  workorder quality check is recorded and projected but does not block finishing. The native
  test `test_workorder_quality_gate` exercises that gate, so it stays with #96 too.
- **#98:** producing byproduct moves in `finish_manufacturing_order` (`complete_output_move`)
  depends on the COV-07c/07f finish rewrite and `create_stock_move_internal` (COV-07b). Until #98
  merges, byproduct definitions are stored but not produced. `test_bom_byproduct_output_exact_effect`
  drives a full MO finish, so it stays with #98.
- **#77:** the `replenishment_rule:*` permission for the warehouse persona in
  `frontend/web/fixtures/first-org-fixture.v1.json` is fixture data, not contract; it stays with #77.
- When COV-07d merges on top of this branch, git sees the two copied helpers added on both
  sides next to COV-07d's extra `sync_workcenter_workorder_projection`; if it conflicts, keep
  COV-07d's version of that block.

### Deferred: #97 `scrap_finished_manufacturing_output`

Not ported. The reducer only works on top of the COV-07b/07c manufacturing rewrite: it calls
`create_stock_move_internal` (COV-07b, absent on `main`), builds on `finished_move_params`
extracted from the COV-07c `finish_manufacturing_order` rewrite, and requires the finished move
to be `is_done` with `quantity_done == qty_produced`, which `main`'s finish path never sets.
Porting it means re-landing the COV-07b/c behavior changes. It needs a follow-up release.

### Also still missing a release (found while porting)

The COV-06/07 stacks add denied **test runner reducers** that are also module schema, and their
tests depend on stack behavior, so they are not ported: `run_inventory_lot_move_test`
(COV-06e), `run_manufacturing_consume_materials_exact_effect_test` (07b),
`run_manufacturing_production_close_exact_effect_test` (07c),
`run_manufacturing_workorder_execution_exact_effect_test` (07d),
`run_manufacturing_workorder_quality_gate_test` (07e),
`run_manufacturing_finished_output_scrap_exact_effect_test` (07f),
`run_manufacturing_bom_byproduct_output_exact_effect_test` (07g). Together with #97 they need
one more contracts release once COV-07a–g are ready to merge.

## Release steps (maintainer)

1. `make codegen` — regenerates the generated contract files (for example
   `crates/stdb-client/src/generated_reducer_contract.rs`) and the frontend bindings for the
   new reducer. Commit the result on this branch.
2. Add `lumiere-codegen/contract-operation-history.json` entries from the regenerated IR for
   `erp.create_company_stock_location`, `erp.schedule_replenishment_run`,
   `erp.cancel_replenishment_run`, `erp.run_scheduled_replenishment`,
   `erp.create_workorder_quality_check`, `erp.fail_workorder_quality_check`,
   `erp.create_bom_byproduct` and `erp.run_inventory_warehouse_qc_location_test`. Also update
   any existing entry whose fingerprint `make check-operation-history` reports as changed (for
   example `erp.update_warehouse`, if the new `UpdateWarehouseParams.wh_qc_stock_loc_id` field
   reaches its shape). The `shape_fingerprint` values are computed from the IR.
3. Run `node scripts/bootstrap-storage-policies.mjs` after codegen so the two new tables
   (`replenishment_run_job`, `mrp_bom_byproduct`) get storage-policy entries in
   `lumiere-codegen/storage-policy-manifest.json`, then review them. `--check` must pass.
4. `make publish-contracts VERSION=x.y.z` and bump the pin. After this, `Contracts drift` is
   green here and on #61, #62 and #78, and #73, #77, #96 and #98 no longer change the contract
   (#97 and the COV-07 test runners still do; see above).

## After the release

- **COV-06:** switch `createInternalLocation` in `frontend/web/tests/e2e/inventory-quant-fixtures.ts`
  to `create_company_stock_location` with the default company (first introduced on
  `codex/cov06c-internal-quant-transfer`), then merge down the stack.
- **COV-06j/06n (#73, #77):** merge `main` into the stack; the ported hunks are byte-identical,
  so only the stack's remaining behavior and fixture changes are left in the PR diff.
- **COV-07:** the manufacturing specs and resolvers read the fields above; re-run the stack.
  #96 and #98 then add only their finish-path behavior and tests on top of the already-released
  reducers. #97 and the COV-07 test runners go in the next contracts release.
- **COV-10:** add the exact readback to `useValidateTimesheets` / `useRejectTimesheets` through
  `timesheets.validation_status`.
