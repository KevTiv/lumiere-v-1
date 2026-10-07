import assert from 'node:assert/strict';
import test from 'node:test';

import { purchaseOrderLineCanBeRemoved, requisitionCanCreateRfq } from './purchasing-action-gates';

test('an RFQ can only be created from an approved requisition', () => {
  assert.equal(requisitionCanCreateRfq({ state: { tag: 'Approved' } }), true);
  assert.equal(requisitionCanCreateRfq({ state: { tag: 'Draft' } }), false);
  assert.equal(requisitionCanCreateRfq({ state: 'Closed' }), false);
});

test('a line can be removed only while its order is a draft', () => {
  const orders = [
    { id: 1n, state: { tag: 'Draft' } },
    { id: 2n, state: { tag: 'Purchase' } },
  ];
  assert.equal(purchaseOrderLineCanBeRemoved({ orderId: 1 }, orders), true);
  assert.equal(purchaseOrderLineCanBeRemoved({ order_id: '2' }, orders), false);
  assert.equal(purchaseOrderLineCanBeRemoved({ orderId: 9 }, orders), true);
  assert.equal(purchaseOrderLineCanBeRemoved({}, orders), true);
});
