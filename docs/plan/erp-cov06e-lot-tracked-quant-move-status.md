# COV-06e Lot-tracked quant move convergence

**Package:** `COV-06e`
**Disposition:** `IMPLEMENTED` — runtime acceptance pending
**Stacked base:** PR #67 / `codex/cov06d-cycle-count-adjustment`
**Operator proof:** [`../../frontend/web/tests/e2e/cov06e-lot-tracked-quant-move.spec.ts`](../../frontend/web/tests/e2e/cov06e-lot-tracked-quant-move.spec.ts)

## Bounded path

```text
lot-tracked StockQuant.id @ source location, qty 4, lot_id = L
→ warehouse-manufacturing operator
→ Inventory / Stock / Move (the existing move_stock_quant path — no new UI)
→ move_stock_quant qty 4 (full relocation)
→ exact same StockQuant.id now @ target location, qty 4, lot_id unchanged
→ StockProductionLot(L).location_id converges to the target location
→ navigate to exact quant
```

## Changes

- `move_stock_quant` (`spacetimedb/src/inventory/stock.rs`) is generic over stock identity (product, variant, lot, package, owner) and already matched/preserved `lot_id` correctly — COV-06c explicitly scoped lots out of its own evidence, not because the mechanism was broken. This slice closes two real gaps found while extending that evidence to a lot-tracked quant:
  1. **No lot integrity check on relocation.** Every other lot-touching path (`reserve_quantity_at_location`, `enforce_tracking_on_move_validate`) calls `ensure_lot_for_product`, which fails closed on a locked or expired lot. `move_stock_quant` called none of this — a quarantined or expired lot's quant could be freely relocated by a raw location move. Fixed by calling `ensure_lot_for_product` up front when the source quant carries a `lot_id`.
  2. **Stale `StockProductionLot.location_id`.** The lot record carries its own denormalized `location_id` (used for lot browsing/reporting), but `move_stock_quant` never touched it — serial tracking already keeps this field in sync during move-validate 1-unit relocations, lots did not. Fixed by syncing the lot's `location_id` to the destination, but only when the move empties the quant's entire presence at the source (`is_emptying_src`): a partial move leaves the lot legitimately present at both locations, so the field is left untouched rather than overwritten with a guess.
- Both changes are exercised by a new native domain test, `test_lot_tracked_quant_move` (`spacetimedb/tests/inventory/tests/gap_fixes_test.rs`, wired as `run_inventory_lot_move_test` in `run_all_inventory_tests`): a locked lot blocks the move with the quant unchanged; unlocking and relocating the full quant converges both the quant and the lot's location.
- No frontend or UI changes: the existing "Move stock quant" form/workflow (COV-06c) already carries `lot_id` as part of stock identity end-to-end, so a lot-tracked quant moves through the identical typed path.
- Browser proof: create a lot-tracked product, a lot, and a quant carrying that lot; verify a locked lot blocks the move (422, quant unchanged); unlock and move through the UI; verify the exact quant id relocates with quantity/lot preserved, the lot's own location converges to the destination, and canonical navigation lands on the exact quant; verify the limited reader is denied (403) without changing the relocated quant.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06e_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06e-e2e
PG_DATABASE=lumiere_cov06e_e2e make e2e-single \
  E2E_SPEC=cov06e-lot-tracked-quant-move.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06e-e2e
spacetime call <db> run_all_inventory_tests
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies one full relocation of one lot-tracked quant with no pre-existing destination quant. It does not certify partial lot-tracked moves (where the lot legitimately spans two locations — the lot's own `location_id` is deliberately left stale/ambiguous in that case), merges into an existing same-lot destination quant, serial-tracked movement (a materially different mechanism — one unit per serial, transitioned during picking validate rather than through `move_stock_quant`), or FEFO-among-multiple-lots selection during this kind of raw relocation.

## Next bounded Inventory slice

Serial-tracked movement through the picking lifecycle (confirm → assign → validate consuming a specific `serial_id`) remains open and is materially different work from this slice — it extends COV-06a's picking certification to a serial-tracked product rather than extending COV-06c's quant-move certification. Keep quality/replenishment as separate slices.
