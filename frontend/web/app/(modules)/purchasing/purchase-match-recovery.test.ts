import assert from 'node:assert/strict';
import test from 'node:test';
import { purchaseMatchRecovery } from './purchase-match-recovery';
const order = { id: 7, state: { tag: 'Purchase' } };
const line = { id: 9, orderId: 7, state: 'Confirmed', productQty: 10, qtyReceived: 5, qtyInvoiced: 8 };
test('a quantity exception suggests only the missing receipt for the exact confirmed line', () => {
  assert.deepEqual(purchaseMatchRecovery(line, order), { status: 'over_billed', guidance: 'receiveOrReviewBill', receiptQty: 3, variance: 3 });
  assert.equal(purchaseMatchRecovery({ ...line, qtyReceived: 8 }, order).status, 'matched');
});
test('over-order bills and over-receipts require review rather than invented receipts', () => {
  assert.equal(purchaseMatchRecovery({ ...line, qtyInvoiced: 11 }, order).receiptQty, null);
  assert.equal(purchaseMatchRecovery({ ...line, qtyReceived: 11 }, order).guidance, 'reviewReceipt');
});
test('missing, cancelled, draft, done or unrelated orders cannot offer recovery receipt', () => {
  for (const parent of [undefined, { ...order, id: 8 }, { ...order, state: 'Cancelled' }, { ...order, state: 'Draft' }, { ...order, state: 'Done' }]) {
    assert.equal(purchaseMatchRecovery(line, parent).receiptQty, null);
  }
  assert.equal(purchaseMatchRecovery({ ...line, state: 'Cancelled' }, order).receiptQty, null);
});
test('invalid or unavailable economic values fail closed instead of displaying matched', () => {
  for (const value of [undefined, null, '', ' ', NaN, Infinity, -1, 'invalid', true]) {
    assert.equal(purchaseMatchRecovery({ ...line, qtyReceived: value }, order).status, 'unavailable');
  }
  assert.equal(purchaseMatchRecovery(line, { ...order, matchQtyTolerance: Infinity }).status, 'unavailable');
});
test('current quantities and PO tolerance override stale metadata labels', () => {
  assert.equal(purchaseMatchRecovery({ ...line, metadata: '{"match_state":"matched"}', matchState: 'matched' }, order).status, 'over_billed');
  assert.equal(purchaseMatchRecovery({ ...line, qtyInvoiced: 5.1 }, { ...order, matchQtyTolerance: 0.2 }).status, 'matched');
  assert.equal(purchaseMatchRecovery({ ...line, qtyInvoiced: 5.1 }, order).status, 'over_billed');
});
test('snake-case fields and numeric strings retain the same exact recovery', () => {
  assert.equal(purchaseMatchRecovery({ order_id: '7', state: 'Confirmed', product_qty: '10', qty_received: '5', qty_invoiced: '8' }, order).receiptQty, 3);
});
