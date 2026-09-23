# COV-06l Serial use/block exact lifecycle convergence

**Package:** `COV-06l`
**Disposition:** `IMPLEMENTED` — runtime acceptance pending
**Stacked base:** PR #74 / `codex/cov06k-warehouse-qc-location-ui`
**Operator proof:** [`../../frontend/web/tests/e2e/cov06l-serial-use-block.spec.ts`](../../frontend/web/tests/e2e/cov06l-serial-use-block.spec.ts)

## Bounded path

```text
reserved StockProductionSerial.id
→ warehouse-manufacturing operator
→ Inventory / Serial numbers: mark in use
→ use_serial
→ exact same serial id converges reserved → in_use

free StockProductionSerial.id (a different one)
→ warehouse-manufacturing operator
→ Inventory / Serial numbers: row → Block → reason
→ block_serial
→ exact same serial id converges free → blocked (any starting state is valid)
```

## Changes

- Completes the serial-lifecycle typed-workflow migration COV-06i started for `reserve_serial`: `use_serial` and `block_serial` now go through typed `inventory.serial.use` / `inventory.serial.block` workflows (`frontend/packages/erp-workflows/src/inventory/{serial-use,serial-block}.ts`) instead of the previous raw mutation hooks (`useUseSerial`/`useBlockSerial`, removed in favor of `useSerialCommand`/`blockSerialCommand` + `useSerialUseWorkflow`/`useSerialBlockWorkflow`). Same shape as `reserve_serial`'s workflow: exact state-transition verification by primary key, no discovery ambiguity.
- No backend changes and no found bugs this time — both reducers were already correct by-id state transitions.
- Added a `data-testid` to the serial detail modal's "Block" button (previously untestable) so the e2e proof can drive it.
- Browser proof: reserve a serial and mark it in use, verifying exact state convergence at each step; verify exact replay (use on an already-in-use serial) is rejected (422); verify the limited reader is denied (403) without changing the serial; separately, block a still-free serial directly (proving `block_serial` has no starting-state precondition) and verify it converges to `"blocked"`.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06l_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06l-e2e
PG_DATABASE=lumiere_cov06l_e2e make e2e-single \
  E2E_SPEC=cov06l-serial-use-block.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06l-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies `use_serial` and `block_serial` only. It does not touch the serial-selection logic inside reservation/move-validate (already certified for the picking path in COV-06f), nor `update_stock_production_serial`'s general note/field edits.

## Next bounded work

With this slice, the entire serial lifecycle (create, reserve, use, block) is now typed-workflow-certified. COV-06's Inventory lineage's remaining named gaps are the internal-transfer replenishment path, the "no demand needed" outcome, and a scheduler consuming `ReplenishmentRule.next_run` — the last one is a materially larger task than anything in this lineage.
