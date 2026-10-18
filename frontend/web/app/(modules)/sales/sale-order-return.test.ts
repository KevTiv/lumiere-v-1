import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReturnParams, canCreateReturn, returnQtyFieldId, returnableLines } from './sale-order-return';

const order = (state: string) => ({ id: 7, partnerId: 3, state: { tag: state } });
const line = (id: number, delivered: number) => ({
  id,
  productId: 10 + id,
  productUom: 1,
  priceUnit: 5,
  qtyDelivered: delivered,
});

test('a return is offered only on a confirmed order that delivered something', () => {
  const lines = [line(1, 2)];
  assert.deepEqual(
    ['Draft', 'Sent', 'Sale', 'Done', 'Cancel'].map((s) => canCreateReturn(order(s), lines)),
    [false, false, true, true, false],
  );
  assert.equal(canCreateReturn(order('Sale'), [line(1, 0)]), false);
  assert.equal(canCreateReturn(order('Sale'), []), false);
  assert.deepEqual(returnableLines([line(1, 0), line(2, 3)]).map((l) => l.id), [2]);
});

test('return params carry only lines with a quantity, capped at the delivered quantity', () => {
  const lines = [line(1, 4), line(2, 3), line(3, 0)];
  const params = buildReturnParams(order('Sale'), lines, {
    [returnQtyFieldId(lines[0]!)]: '2',
    [returnQtyFieldId(lines[1]!)]: '',
    reason: ' damaged ',
  });
  assert.equal(params?.partnerId, 3n);
  assert.equal(params?.saleOrderId, 7n);
  assert.equal(params?.returnReason, 'damaged');
  assert.equal(params?.lines.length, 1);
  assert.equal(params?.lines[0]?.saleOrderLineId, 1n);
  assert.equal(params?.lines[0]?.productUomQty, 2);
});

test('return params are rejected when empty, negative or above what was delivered', () => {
  const lines = [line(1, 4)];
  const key = returnQtyFieldId(lines[0]!);
  assert.equal(buildReturnParams(order('Sale'), lines, {}), null);
  assert.equal(buildReturnParams(order('Sale'), lines, { [key]: '0' }), null);
  assert.equal(buildReturnParams(order('Sale'), lines, { [key]: '-1' }), null);
  assert.equal(buildReturnParams(order('Sale'), lines, { [key]: '5' }), null);
  assert.equal(buildReturnParams(order('Sale'), lines, { [key]: '4' })?.lines[0]?.productUomQty, 4);
});
