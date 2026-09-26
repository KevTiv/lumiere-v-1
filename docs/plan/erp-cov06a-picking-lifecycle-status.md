# COV-06a Stock picking lifecycle convergence

**Package:** `COV-06a`  
**Disposition:** `IMPLEMENTED` — runtime acceptance pending  
**Stacked base:** PR #63 / `codex/cov05c-vendor-bill`  
**Operator proof:** [`../../frontend/web/tests/e2e/cov06-picking-lifecycle.spec.ts`](../../frontend/web/tests/e2e/cov06-picking-lifecycle.spec.ts)

## Bounded path

```text
seeded outgoing StockPicking.id
→ warehouse-manufacturing operator
→ Inventory / Transfers
→ confirm_stock_picking
→ exact same picking id = confirmed
→ assign_stock_picking
→ exact same picking id = assigned
→ validate_stock_picking
→ exact same picking id = done
→ exact same StockMove ids = done
→ delivered quantity converges
```

Sales is used only to create one realistic draft delivery picking. The COV-06 claim starts at the warehouse operator's first Inventory action; no Sales transition is counted as Inventory operator proof.

## Changes

- confirm now performs canonical post-read and only reports `applied` when the same picking id is `confirmed`;
- assign does the same for `assigned`;
- validate now requires the source picking itself to be `done` before reporting success;
- successful confirm/assign/validate returns the exact same `stock_picking` record reference;
- Inventory single-selection actions navigate to that canonical result; multi-selection remains non-navigating;
- validation preserves explicit backorder references when present but keeps the source picking as `next`;
- browser proof drives all three principal transitions through Inventory → Transfers as the existing `warehouse-manufacturing` persona;
- move identity is snapshotted before the operator transitions and the same move ids must become `done`;
- stale confirm/assign/validate requests must return 422 without changing the current state/effect set;
- the limited reader must return 403 without changing the completed picking.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06-e2e
PG_DATABASE=lumiere_cov06_e2e make e2e-single \
  E2E_SPEC=cov06-picking-lifecycle.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies one full-quantity outgoing picking through confirm → assign → validate. It does not certify partial validation/backorders, incoming receipts, internal transfers, lots/serials, cycle counts, quality holds, replenishment, or concurrency against changing stock.

## Next bounded Inventory slice

COV-06b now owns partial validation and exact backorder identity. After it, certify **one internal transfer with exact source/destination quant convergence**. Keep cycle counts/lots/serials/quality/replenishment separate.
