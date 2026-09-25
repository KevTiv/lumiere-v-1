# COV-06d Cycle-count exact quant adjustment convergence

**Package:** `COV-06d`
**Disposition:** `IMPLEMENTED` — runtime acceptance pending
**Stacked base:** PR #66 / `codex/cov06c-internal-quant-transfer`
**Operator proof:** [`../../frontend/web/tests/e2e/cov06d-cycle-count-adjustment.spec.ts`](../../frontend/web/tests/e2e/cov06d-cycle-count-adjustment.spec.ts)

## Bounded path

```text
warehouse-manufacturing operator
→ Inventory / Cycle counts wizard
→ create plan @ location → start session → record exactly one line (product, location, counted qty)
→ validate → post adjustments
→ post_cycle_count_adjustments
→ no prior quant at (product, location, lot, company): exactly one new StockQuant id created, quantity = counted qty
   OR prior quant exists: the exact same StockQuant id remains, quantity updated to counted qty
→ navigate to exact resulting quant
```

## Changes

- `post_cycle_count_adjustments` (`spacetimedb/src/inventory/cycle_count.rs`) already resolved the target quant by identity match (`find_quant_for_sheet`: organization + company + product + location + lot), never by newest/highest id — that defect class does not exist in this reducer. This slice adds the missing piece: a durable organization-commit record (`record_organization_commit`) carrying the exact set of adjusted quant ids (each updated-in-place id, or each freshly inserted id) as canonical SATS-serialized row upserts, matching the pattern already used by `move_stock_quant`.
- A new typed `inventory.cycle-count.post` workflow (`frontend/packages/erp-workflows/src/inventory/cycle-count-adjustment.ts`) snapshots the exact optional pre-existing quant at the counted line's identity immediately before dispatch. More than one compatible quant fails preflight instead of picking one by iteration order.
- Readback verifies exact convergence: an existing quant keeps its id with quantity equal to the counted value; no prior quant requires exactly one new identity-matching quant with quantity equal to the counted value. Anything else (stale quantity, zero or multiple matches) reports no outcome rather than a false success.
- The cycle-count wizard's "post adjustments" step (`frontend/web/app/(modules)/inventory/cycle-count-wizard.tsx`) now calls the typed workflow (`useCycleCountAdjustmentWorkflow`) instead of the previous raw mutation hook (`usePostCycleCountAdjustments`, removed), reusing the exact product/location/quantity the operator entered when recording the line — no new query resource or stock-count-sheet subscription needed for the bounded proof.
- The warehouse persona fixture gains `stock_cycle_count:*` and `stock_count_sheet:*`. These were absent from the fixture manifest entirely: every cycle-count reducer calls `check_permission(ctx, org_id, "stock_cycle_count" | "stock_count_sheet", ...)`, so the warehouse persona could not have completed any step of the existing wizard before this change.
- Browser proof: create a cycle count, start it, record one line, validate, post through the UI; verify exactly one adjusted quant at the expected quantity; verify canonical navigation to that quant; verify exact replay is rejected (cycle count already posted) with 422 and the quant set unchanged; verify the limited reader is denied with 403 and the quant set unchanged.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov06d_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov06d-e2e
PG_DATABASE=lumiere_cov06d_e2e make e2e-single \
  E2E_SPEC=cov06d-cycle-count-adjustment.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov06d-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies one cycle count with exactly one counted line, no lot/serial tracking, against a company-scoped location. It does not certify multi-line cycle counts, lot/serial-tracked cycle counts, tolerance-based auto-approval, reason-mandatory variance capture, or lot/serial tracked movement (still open).

## Next bounded Inventory slice

Lot/serial tracked movement remains open. Keep replenishment/quality as separate slices.
