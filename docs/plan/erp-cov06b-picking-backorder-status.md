# COV-06b Partial validation and backorder convergence

**Package:** `COV-06b`  
**Disposition:** `IMPLEMENTED` — runtime acceptance pending  
**Stacked base:** PR #64 / `codex/cov06-picking-lifecycle`  
**Operator proof:** [`../../frontend/web/tests/e2e/cov06b-picking-backorder.spec.ts`](../../frontend/web/tests/e2e/cov06b-picking-backorder.spec.ts)

## Bounded path

```text
assigned StockPicking.id
→ snapshot source StockPicking.backorder_ids
→ warehouse-manufacturing operator
→ Inventory / Transfers / Partial validate
→ done_stock_move for short quantity
→ validate_stock_picking_backorder
→ source picking = done
→ source backorder_ids gains exactly one id
→ child StockPicking.backorder_id = source id
→ residual StockMove carries remaining demand
→ navigate to exact child backorder
```

## Changes

- partial validation now snapshots the source picking's durable `backorder_ids` relation before dispatch;
- post-read accepts exactly one new child id and rejects zero, multiple, or regressed relation deltas as unresolved;
- the child must exist and point back with `backorder_id = source.id`;
- ordinary validation now surfaces existing backorders from the source-owned relation instead of scanning for newest rows;
- Inventory → Transfers now exposes the existing shared partial-delivery form/workflow rather than duplicating quantity rules;
- single partial validation navigates to the exact newly created residual picking;
- browser proof ships 1 of 2 units, preserves the source move identity, verifies one residual move with demand 1, and confirms delivered quantity 1;
- stale replay must return 422 and preserve the one-child relation;
- the limited reader must return 403 and preserve the same source/backorder relation.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06b_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06b-e2e
PG_DATABASE=lumiere_cov06b_e2e make e2e-single \
  E2E_SPEC=cov06b-picking-backorder.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06b-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies one outgoing partial validation with one backorder. It does not certify multi-line residuals, chained backorders, incoming partial receipts, internal transfers, lots/serials, quality holds, cycle counts, replenishment, or concurrent stock changes.

## Next bounded Inventory slice

Certify **one internal transfer with exact source/destination quant convergence**. Keep lot/serial tracking and cycle-count/replenishment behavior separate.
