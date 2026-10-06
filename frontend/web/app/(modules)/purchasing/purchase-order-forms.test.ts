import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canAddPurchaseOrderLine,
  canEditPurchaseOrder,
  canLockPurchaseOrder,
  linesOfOrder,
  purchaseOrderHeaderDefaults,
  purchaseOrderLineEditDefaults,
  toReceiveLineInput,
  toUpdatePurchaseOrderHeaderArgs,
} from './purchase-order-forms';

const order = (state: string, extra: Record<string, unknown> = {}) => ({ id: 7n, state: { tag: state }, ...extra });

test('only an unlocked draft can have its header and lines edited', () => {
  assert.equal(canEditPurchaseOrder(order('Draft')), true);
  assert.equal(canEditPurchaseOrder(order('Draft', { isLocked: true })), false);
  assert.equal(canEditPurchaseOrder(order('Purchase')), false);
  assert.equal(canAddPurchaseOrderLine(order('Draft', { isLocked: true })), true);
  assert.equal(canAddPurchaseOrderLine(order('Sent')), false);
});

test('finished or already locked orders cannot be locked', () => {
  assert.equal(canLockPurchaseOrder(order('Purchase')), true);
  assert.equal(canLockPurchaseOrder(order('Done')), false);
  assert.equal(canLockPurchaseOrder(order('Cancelled')), false);
  assert.equal(canLockPurchaseOrder(order('Purchase', { isLocked: true })), false);
});

test('header defaults carry the order values as strings', () => {
  assert.deepEqual(purchaseOrderHeaderDefaults(order('Draft', { partnerId: 3n, origin: 'SO1', notes: null })), {
    orderId: '7',
    partnerId: '3',
    origin: 'SO1',
    partnerRef: '',
    notes: '',
    paymentTermId: '',
  });
});

test('header args leave blank fields unchanged and convert ids', () => {
  assert.equal(toUpdatePurchaseOrderHeaderArgs({ orderId: '' }), null);
  const args = toUpdatePurchaseOrderHeaderArgs({
    orderId: '7',
    origin: ' ',
    partnerRef: ' REF ',
    partnerId: '3',
    paymentTermId: '',
  });
  assert.deepEqual(args, { orderId: '7', params: { partnerRef: 'REF', partnerId: 3n } });
});

test('line edit defaults read the stored line columns', () => {
  assert.deepEqual(
    purchaseOrderLineEditDefaults({ id: 5n, productId: 2n, productUom: 1n, productQty: 4, priceUnit: 9.5 }),
    { lineId: '5', productId: '2', uomId: '1', quantity: '4', priceUnit: '9.5' },
  );
});

test('receive input stringifies ids and passes the lot only when given', () => {
  assert.equal(toReceiveLineInput(null), null);
  assert.deepEqual(toReceiveLineInput({ lineId: 5, qty: 2 }), { lineId: '5', qty: 2, lotId: undefined });
  assert.deepEqual(toReceiveLineInput({ lineId: 5, qty: 2, lotId: 8 }), { lineId: '5', qty: 2, lotId: '8' });
});

test('lines are matched to their order by either column spelling', () => {
  const lines = [{ id: 1, orderId: 7 }, { id: 2, order_id: 7 }, { id: 3, orderId: 8 }];
  assert.deepEqual(
    linesOfOrder(lines, '7').map((line) => line.id),
    [1, 2],
  );
});
