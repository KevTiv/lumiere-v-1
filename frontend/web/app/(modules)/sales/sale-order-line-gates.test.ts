import assert from 'node:assert/strict';
import test from 'node:test';

import { saleOrderLineCanBeDeleted } from './sale-order-line-gates';

const orders = [
  { id: 1n, state: { tag: 'Draft' } },
  { id: 2n, state: { tag: 'Sent' } },
  { id: 3n, state: { tag: 'Sale' } },
  { id: 4n, state: { tag: 'Draft' }, isLocked: true },
];

test('lines can be deleted from an unlocked draft or sent order only', () => {
  assert.equal(saleOrderLineCanBeDeleted({ orderId: 1 }, orders), true);
  assert.equal(saleOrderLineCanBeDeleted({ orderId: '2' }, orders), true);
  assert.equal(saleOrderLineCanBeDeleted({ order_id: 3 }, orders), false);
  assert.equal(saleOrderLineCanBeDeleted({ orderId: 4 }, orders), false);
});

test('a line whose order is not loaded is left to the server', () => {
  assert.equal(saleOrderLineCanBeDeleted({ orderId: 99 }, orders), true);
  assert.equal(saleOrderLineCanBeDeleted({}, orders), true);
});
