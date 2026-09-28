# COV-06i Serial reserve exact lifecycle convergence

**Package:** `COV-06i`
**Disposition:** `IMPLEMENTED` — runtime acceptance pending
**Stacked base:** PR #71 / `codex/cov06h-replenishment-demand`
**Operator proof:** [`../../frontend/web/tests/e2e/cov06i-serial-reserve.spec.ts`](../../frontend/web/tests/e2e/cov06i-serial-reserve.spec.ts)

## Bounded path

```text
warehouse-manufacturing operator
→ Inventory / Serial numbers: create serial (name, product)
→ create_stock_production_serial with state = "free"
→ Inventory / Serial numbers: reserve (new action)
→ reserve_serial
→ exact same StockProductionSerial.id converges free → reserved
→ navigate to the exact serial
```

## Changes found and fixed

- **Real bug**: the "Create serial" UI action hardcoded `state: 'available'`. The entire serial lifecycle (`reserve_serial`, `use_serial`, `block_serial`, `reserve_free_serials`, `consume_reserved_serials`, `place_free_serials_at_location`) checks for the literal string `"free"` — `"available"` is not a recognized state anywhere in the reducer surface. Every serial created through this UI action was therefore permanently stuck: `reserve_serial` would always fail with "Serial is not free (current state: available)", and nothing in the UI could change that state either, since there was no way to edit a serial's raw state field. Fixed to `state: 'free'`.
- **Real gap**: `reserve_serial` (free → reserved) had no UI action at all — only `use_serial` (reserved → in_use) and `block_serial` were wired, even though a `useReserveSerial` hook already existed unused in `traceability.ts`. Combined with the state bug above, a UI-created serial could never legitimately enter the reservation flow. Added a "Reserve" row action.
- **Real gap**: the warehouse persona fixture had no `stock_production_serial` permission at all. `reserve_serial`/`create_stock_production_serial` both call `check_permission(ctx, organization_id, "stock_production_serial", ...)`, so the warehouse persona could not have created or reserved a serial directly before this change (it could only cause serial state changes indirectly, through picking assign/validate, which check `stock_picking`/`stock_move` permissions instead). Added `stock_production_serial:*`.
- Added a typed `inventory.serial.reserve` workflow (`frontend/packages/erp-workflows/src/inventory/serial-reserve.ts`) replacing the previously-unused raw `useReserveSerial` hook. Since a serial is looked up by its own primary key (no discovery ambiguity, unlike quant/PO/picking identity resolution elsewhere in COV-06), the workflow's job is exact state-transition verification rather than identity discovery: it confirms the serial exists before dispatch and that its state is exactly `"reserved"` after — not just that the HTTP call returned success.
- Added `stock_production_serial` to the canonical resource→module-tab map (`ai-source-links.ts`) so this and future serial workflows can navigate to the exact record.
- Browser proof: create a serial through the UI and verify it starts `"free"` (the bug this slice fixes); reserve it through the new UI action; verify the exact same id converges to `"reserved"`; verify canonical navigation to the exact serial; verify exact replay (already-reserved) is rejected (422); verify the limited reader is denied (403) without changing the serial.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06i_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06i-e2e
PG_DATABASE=lumiere_cov06i_e2e make e2e-single \
  E2E_SPEC=cov06i-serial-reserve.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06i-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies only `reserve_serial`. `use_serial` and `block_serial` remain wired to their original raw mutation hooks (not certified in this slice, though they carry no discovery-ambiguity risk either, being simple by-id state transitions). It does not touch `enforce_tracking_on_quant_reserve`/`enforce_tracking_on_move_validate`'s own serial selection (already certified end-to-end for the picking path in COV-06f).

## Next bounded work

`use_serial`/`block_serial` could receive the same typed-workflow treatment for consistency, but neither carries the same "found bug" urgency this slice did. Otherwise, the remaining named gaps from prior COV-06 slices (internal-transfer replenishment path, `wh_qc_stock_loc_id` update reducer, replenishment scheduler) are still open.
