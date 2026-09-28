# COV-06k Warehouse QC location UI

**Package:** `COV-06k`
**Disposition:** `IMPLEMENTED` — runtime acceptance pending
**Stacked base:** PR #73 / `codex/cov06j-warehouse-qc-location`
**Operator proof:** [`../../frontend/web/tests/e2e/cov06k-warehouse-qc-location-ui.spec.ts`](../../frontend/web/tests/e2e/cov06k-warehouse-qc-location-ui.spec.ts)

## Bounded path

```text
existing warehouse, no QC location configured
→ admin operator
→ Inventory / Warehouses: edit → Quality control location select
→ update_warehouse with wh_qc_stock_loc_id
→ exact same Warehouse.id now carries that QC location
→ clear it back to unconfigured through the same field
```

## Correction to COV-06j's blocker note

COV-06j's status doc said UI wiring was blocked pending an `@lumiere/contracts` regeneration, because `UpdateWarehouseParams`'s generated TypeScript shape doesn't yet include `wh_qc_stock_loc_id`. That conclusion was wrong: `stdbParamsToJson` checks for an **already-encoded** SATS option value (`{ some: … }` / `{ none: [] }`) before consulting the generated option-fields registry, and the codebase already has an established convention of hand-encoding option wrappers for exactly this situation (`frontend/packages/query-hooks/src/hooks/{purchasing,workflows,fleet,auth}.ts` all do this for other fields). This slice uses that same convention rather than waiting on the contracts release.

## Changes

- Added a `whQcStockLocId` select field to the "Edit warehouse" form (`editWarehouseForm` in `inventory-form-configs.ts`), populated from the same location list used elsewhere, with its own "Not configured" blank option (a dedicated `qcLocationOptions` list rather than reusing the location-hierarchy picker's "Root (no parent)" label, which doesn't fit this field).
- The edit-warehouse submit handler pre-encodes `whQcStockLocId` as `{ some: <id> }` / `{ none: [] }` by hand and spreads it into the `UpdateWarehouseParams` payload via a `Record<string, unknown>` cast (the generated TS type doesn't know the field yet, but the wire encoding is correct regardless).
- No change was needed to COV-06g's "fail" action — it already preferred a configured warehouse QC location over the manual prompt (`warehouses.find(w => whQcStockLocId != null)`), it just never had anything to find before this slice. It will now use a configured location automatically once an admin sets one; the prompt remains the fallback for organizations that don't configure one.
- Browser proof: configure a warehouse's QC location through the new form field, verify it persists on the exact warehouse id; clear it back to unconfigured through the same field; verify the limited reader is denied (403) without changing the warehouse.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06k_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06k-e2e
PG_DATABASE=lumiere_cov06k_e2e make e2e-single \
  E2E_SPEC=cov06k-warehouse-qc-location-ui.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06k-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies only setting/clearing `wh_qc_stock_loc_id` through the edit form. It does not re-certify COV-06g's fail-quality-check flow end-to-end with a configured location (the prompt-fallback path COV-06g certified remains covered by its own proof; the configured-location path is now reachable but not separately proven here).

## Next bounded work

Once `@lumiere/contracts` is eventually regenerated to include `wh_qc_stock_loc_id` natively, the hand-encoding cast in the edit-warehouse submit handler can be removed in favor of the generated type — not urgent, since the hand-encoded path is already correct. Otherwise, the remaining named gaps (the internal-transfer replenishment path, the "no demand needed" outcome, `use_serial`/`block_serial` typed workflows, and a replenishment scheduler) are still open.
