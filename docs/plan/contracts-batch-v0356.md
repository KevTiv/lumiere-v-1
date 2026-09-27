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

## Release steps (maintainer)

1. `make codegen` — regenerates the generated contract files (for example
   `crates/stdb-client/src/generated_reducer_contract.rs`) and the frontend bindings for the
   new reducer. Commit the result on this branch.
2. Add the `erp.create_company_stock_location` entry to
   `lumiere-codegen/contract-operation-history.json` from the regenerated IR (its
   `shape_fingerprint` is computed from the IR; `make check-operation-history` confirms it).
3. `make publish-contracts VERSION=x.y.z` and bump the pin. After this, `Contracts drift` is
   green here and on #61, #62 and #78.

## After the release

- **COV-06:** switch `createInternalLocation` in `frontend/web/tests/e2e/inventory-quant-fixtures.ts`
  to `create_company_stock_location` with the default company (first introduced on
  `codex/cov06c-internal-quant-transfer`), then merge down the stack.
- **COV-07:** the manufacturing specs and resolvers read the fields above; re-run the stack.
- **COV-10:** add the exact readback to `useValidateTimesheets` / `useRejectTimesheets` through
  `timesheets.validation_status`.
