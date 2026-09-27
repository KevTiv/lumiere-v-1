# COV-06c Internal quant transfer convergence

**Package:** `COV-06c`  
**Disposition:** `IMPLEMENTED` — runtime acceptance pending  
**Stacked base:** PR #65 / `codex/cov06b-exact-backorder`  
**Operator proof:** [`../../frontend/web/tests/e2e/cov06c-internal-quant-transfer.spec.ts`](../../frontend/web/tests/e2e/cov06c-internal-quant-transfer.spec.ts)

## Bounded path

```text
source StockQuant.id @ source location, qty 3
→ snapshot exact source identity + optional destination quant
→ warehouse-manufacturing operator
→ Inventory / Stock / Move
→ move_stock_quant qty 2
→ exact source StockQuant.id remains @ source, qty 1
→ exactly one identity-matching destination StockQuant.id @ target, qty 2
→ navigate to exact destination quant
```

## Changes

- `move_stock_quant` no longer selects the first compatible destination quant by iteration order;
- multiple compatible destination quants now fail closed;
- when a partial move creates a destination quant, the reducer carries the exact inserted id through durable commit recording instead of rediscovering it via highest/latest id;
- a typed `inventory.stock-quant.move` workflow snapshots the source and optional destination immediately before dispatch;
- readback verifies exact source quantity/location and exact destination quantity/location/identity;
- a new destination is accepted only when exactly one matching quant appears;
- full moves with no prior destination are modeled as relocation of the same source quant id;
- the Stock table now exposes the move operation through the governed workflow surface;
- the existing 3D move surface now uses the same workflow instead of a raw mutation hook;
- `stock_quant` record refs resolve to Inventory → Stock for direct canonical navigation;
- the warehouse persona gains only `stock_quant:write` and `stock_location:read` for this path;
- browser proof moves 2 of 3 units, verifies exact 1/2 source/destination convergence, rejects exact replay with 422, and proves the limited reader is denied with 403.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06c_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06c-e2e
PG_DATABASE=lumiere_cov06c_e2e make e2e-single \
  E2E_SPEC=cov06c-internal-quant-transfer.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06c-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies one untracked internal quant move with no reservation. It does not certify reserved-stock transfer, full-quant relocation in browser, lots/serials/packages/owners, multi-company locations, cycle counts, quality holds, replenishment, or concurrent competing moves.

## Next bounded Inventory slice

Prefer **lot/serial tracked movement** or **cycle-count adjustment with exact quant delta**. Keep replenishment/quality as separate slices.
