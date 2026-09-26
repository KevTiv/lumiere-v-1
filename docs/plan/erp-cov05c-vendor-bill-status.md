# COV-05c Vendor bill convergence

**Package:** `COV-05c`  
**Disposition:** `IMPLEMENTED` — runtime acceptance pending  
**Stacked base:** PR #62 / `codex/cov05b-purchase-receipt`  
**Operator proof:** [`../../frontend/web/tests/e2e/cov05c-vendor-bill.spec.ts`](../../frontend/web/tests/e2e/cov05c-vendor-bill.spec.ts)

## Bounded path

```text
received PurchaseOrder
→ snapshot exact PurchaseOrder.invoice_ids
→ Purchasing order / Create bill form
→ create_bill_from_purchase_order
→ canonical PurchaseOrder.invoice_ids post-read
→ exactly one new AccountMove.id
→ Draft InInvoice with invoice_origin = PO<orderId>
→ canonical Accounting record navigation
```

## Changes

- the workflow no longer treats `invoice_ids.at(-1)` as the bill created by the invocation;
- `purchase_order.invoice_ids` is used as the durable PO-owned relation;
- the relation is snapshotted immediately before dispatch;
- post-read accepts exactly one new bill id and rejects zero, multiple, or regressed relation states as unresolved;
- the Purchasing persona gains only the accounting create/read and journal/account reads required by the existing bill form and reducer;
- browser proof creates the bill through the real Purchasing form and validates the exact PO relation plus `InInvoice` / `PO<orderId>` source semantics;
- replay of the exact accepted request must return 422 and preserve the one-bill relation;
- the limited reader must return 403 and preserve the same bill identity.

## Runtime validation required

```bash
PG_DATABASE=lumiere_cov05c_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov05c-e2e
PG_DATABASE=lumiere_cov05c_e2e make e2e-single \
  E2E_SPEC=cov05c-vendor-bill.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05c-e2e
```

Do not mark this slice `ACCEPTED` until fresh-stack runtime proof passes.

## Evidence limit

This certifies bill creation from one fully received PO. It does not certify bill posting, payment, partial-receipt/backorder billing, price/quantity variance recovery, approval delegation, or the complete procure-to-pay lifecycle.

## First-adoption Purchasing chain

With COV-05a/b/c implemented, the bounded first-adoption chain is now:

```text
PO confirmation
→ exact inbound receipt
→ exact vendor bill
```

All three slices still require their fresh-stack acceptance gates. Full COV-05 remains open for broader Purchasing U4/U5 evidence.

## Next bounded Purchasing work

Prefer **three-way-match rejection/recovery** or **partial receipt/backorder billing**. Bill posting/payment should converge with the COV-08 Accounting lane rather than creating a second Purchasing-owned accounting path.
