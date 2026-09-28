# COV-05b Purchase receipt convergence

**Package:** `COV-05b`  
**Disposition:** `IMPLEMENTED` — runtime acceptance pending  
**Stacked base:** PR #61 / `codex/cov05-purchase-order-confirmation`  
**Operator proof:** [`../../frontend/web/tests/e2e/cov05b-purchase-receipt.spec.ts`](../../frontend/web/tests/e2e/cov05b-purchase-receipt.spec.ts)

## Bounded path

```text
confirmed PurchaseOrder
→ exact PurchaseOrderLine.id
→ exact pre-dispatch open StockMove.purchase_line_id
→ Purchasing Lines / Receive full open quantity
→ receive_po_line
→ same StockMove.id becomes done
→ same StockPicking.id becomes the receipt result
→ PurchaseOrderLine.qty_received converges
```

## Changes

- `receive_po_line` now fails closed when more than one open stock move exists for the same purchase line;
- the workflow captures the one exact open move/picking before dispatch and carries that identity into post-read;
- post-read never sorts or chooses a latest/highest picking;
- the first-org purchasing persona receives only the additional line/read/write and stock read/write capabilities exercised by this slice;
- browser proof receives through the real line action, navigates to the exact receipt, and verifies the same move id completed;
- stale replay must return 422 without changing quantity or receipt identity;
- the limited reader must return 403 without changing quantity or receipt identity.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov05b_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05b-e2e
PG_DATABASE=lumiere_cov05b_e2e make e2e-single \
  E2E_SPEC=cov05b-purchase-receipt.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05b-e2e
```

Do not mark this slice `ACCEPTED` until the fresh-stack runtime proof passes.

## Evidence limit

This certifies one full-quantity stock receipt. It does not certify partial receipt/backorder identity, lot/serial receipt, vendor-bill creation, three-way-match recovery, or payment.

## Next bounded Purchasing slice

COV-05c now owns vendor-bill creation and replaces `invoice_ids.at(-1)` with an exact pre/post PO relation delta. After COV-05c, prefer three-way-match rejection/recovery or partial receipt/backorder billing; bill posting/payment converges with COV-08 Accounting.
