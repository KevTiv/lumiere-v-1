# COV-06f Serial-tracked picking lifecycle convergence

**Package:** `COV-06f`
**Disposition:** `IMPLEMENTED` — runtime acceptance pending
**Stacked base:** PR #68 / `codex/cov06e-lot-serial-movement`
**Operator proof:** [`../../frontend/web/tests/e2e/cov06f-serial-tracked-picking.spec.ts`](../../frontend/web/tests/e2e/cov06f-serial-tracked-picking.spec.ts)

## Bounded path

```text
one free StockProductionSerial for a serial-tracked product
→ Sales order line (setup only, mirrors COV-06a's boundary) → confirm → one delivery picking, draft
→ warehouse-manufacturing operator
→ Inventory / Transfers: confirm → assign → validate (the exact COV-06a UI surface, unmodified)
→ assign: the one free serial converges to reserved (ATP reservation)
→ validate: the same serial converges to reserved → in_use; source quant depletes to 0
→ canonical navigation to the exact picking
```

## Changes

- No backend changes. `validate_stock_picking`'s `enforce_tracking_on_move_validate` and `assign_stock_picking`'s `reserve_quantity_at_location` already handled serial-tracked products correctly end-to-end: `reserve_free_serials`/`consume_reserved_serials` select deterministically by expiry order (not iteration/newest-row), and the picking lifecycle does not require a move to carry an explicit `serial_id` — the generic outbound path consumes whichever reserved serial is eligible. COV-06a certified this exact confirm → assign → validate UI surface for an untracked product; this slice is the first proof it also converges correctly for a serial-tracked one.
- Generalized `addLaptopLine` → added `addSaleOrderLine(page, orderId, productName, quantity, priceUnit)` in `sales-order-fixtures.ts` (kept `addLaptopLine` itself untouched) so a fixture product other than the seeded laptop can be added to an order line.
- Added product/serial fixture helpers to `inventory-quant-fixtures.ts`: `createSerialTrackedProductFixture` (refactored alongside the existing `createLotTrackedProductFixture` from a shared internal helper), `createStockProductionSerialFixture`, `fetchSerialById`.
- Browser proof: create a serial-tracked product, one on-hand quant, and one free serial; add it to a sale order line and confirm (creating the delivery picking, mirroring COV-06a's setup boundary); drive confirm → assign → validate through the existing Inventory → Transfers UI; verify the serial converges free → reserved → in_use at each stage; verify the source quant depletes to exactly 0; verify canonical navigation to the exact picking; verify stale replay (validate on an already-done picking) is rejected (422); verify the limited reader is denied (403) without changing the picking or serial.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06f_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06f-e2e
PG_DATABASE=lumiere_cov06f_e2e make e2e-single \
  E2E_SPEC=cov06f-serial-tracked-picking.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06f-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies one delivery of one unit of one serial-tracked product with exactly one eligible free serial — no ambiguity in which serial converges. It does not certify: a move carrying an explicit `serial_id` chosen by the operator (the UI has no such control; the reducer path consumes generically); multi-serial/multi-line deliveries; inbound serial receipt (the `place_free_serials_at_location` branch); serial FEFO selection among multiple eligible serials; or the `reserve_serial`/`use_serial`/`block_serial` standalone lifecycle reducers (`reserve_serial` is not wired into the UI at all — a separate, smaller gap, not a movement path).

## Next bounded Inventory slice

Wiring `reserve_serial` into the UI (currently only `use_serial`/`block_serial` are) is a small, separate gap — a lifecycle action, not a movement one. Otherwise, prefer quality or replenishment as the next distinct Inventory slice; COV-06's stock-movement lineage (picking lifecycle, backorder, quant transfer, cycle-count, lot move, serial-tracked picking) is now closed for its originally scoped set.
