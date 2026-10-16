# COV-05 Purchase order confirmation convergence

**Package:** `COV-05a`  
**Disposition:** `REVIEW` — implemented; fresh-stack runtime proof passed

**Stacked base:** PR #56 / `codex/erp-convergence-cov00a-cov02`  
**Operator proof:** [`../../frontend/web/tests/e2e/cov05-purchase-order-confirmation.spec.ts`](../../frontend/web/tests/e2e/cov05-purchase-order-confirmation.spec.ts)

## Bounded path

```text
purchasing operator
→ Purchasing orders table / Confirm action
→ usePurchasingWorkflow
→ erp.confirm_purchase_order
→ confirm_purchase_order reducer
→ same PurchaseOrder.id in Purchase state
→ exact inbound StockPicking.purchase_id effects
→ canonical filtered Purchase order navigation
```

The slice reuses the existing Purchasing UI, typed workflow runner, generated operation transport, reducer, and canonical purchase-order/receipt relations. It does not add a sibling mutation path or infer effects from newest ids.

## Changes

- the first-org `purchasing` persona gains only the derivative `stock_picking:create` and `stock_move:create` capabilities required by the canonical confirmation reducer;
- setup resolves the test PO by one exact unique `origin` relation rather than a latest/highest-id helper;
- the purchasing persona performs the principal confirmation through the visible UI;
- readback requires the same PO id to reach `Purchase`;
- receipt identity is derived from every non-return inbound `stock_picking.purchase_id == orderId` effect;
- the default `stock-pickings` query projection exposes `purchase_id`, so canonical receipt readback can actually resolve that relation;
- stale confirmation must return 422 and preserve the exact receipt set;
- the limited reader must return 403 and preserve the same PO state and receipt set;
- the workflow result must navigate to `/purchasing?tab=orders&filter=id:<orderId>`.

## Runtime validation

The integrated local gate passed: **1 browser test**, including exact PO/receipt
readback, stale 422, and reader 403. Final proof used fresh dedicated
`lumiere_cov05a_20261011212115_final` / `lumiere-cov05a-20261011212115-final`.
See [COV-05d runtime evidence](erp-cov05d-runtime-evidence.md) for actual commands,
source fingerprint, initial failures, and service/storage ledger.

Reference commands below require fresh names; never clear an existing user's database:

```bash
PG_DATABASE=lumiere_cov05_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05-e2e
PG_DATABASE=lumiere_cov05_e2e make e2e-single \
  E2E_SPEC=cov05-purchase-order-confirmation.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05-e2e
```

Runtime proof is now present. Formal review/CI and full Purchasing U4/U5 certification
are separate gates; this document does not promote the module.

## Evidence limit

This slice certifies PO confirmation only. It does not yet certify receiving, partial receiving, vendor-bill creation, three-way-match recovery, lost-response recovery, approval-gate delegation, or the complete procure-to-pay lifecycle.

## Next bounded Purchasing slice

COV-05b/c also have runtime proof, and COV-05d proves receipt response-loss recovery.
Next prefer partial receipt/backorder billing or three-way-match rejection/recovery;
retain the released exact PO/receipt/bill relations rather than rediscovering effects.
