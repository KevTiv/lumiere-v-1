import assert from 'node:assert/strict';
import test from 'node:test';

import {
  purchaseOrderLineCanBeRemoved,
  requisitionCanApprove,
  requisitionCanCreateRfq,
} from './purchasing-action-gates';

test('a requisition approval requires an independent actor', () => {
  const requisition = { state: { tag: 'InProgress' }, userId: { __identity__: '0xAABB' } };
  assert.equal(requisitionCanApprove(requisition, 'aabb'), false);
  assert.equal(requisitionCanApprove(requisition, '0xCCDD'), true);
  assert.equal(requisitionCanApprove({ ...requisition, state: 'Approved' }, 'ccdd'), false);
  assert.equal(requisitionCanApprove({ state: 'InProgress' }, 'ccdd'), false);
});

test('requisition gates accept the single-key enum shape returned by HTTP queries', () => {
  const requisition = {
    state: { inProgress: [] },
    user_id: { __identity__: '0xAABB' },
  };
  assert.equal(requisitionCanApprove(requisition, '0xCCDD'), true);
  assert.equal(requisitionCanApprove(requisition, 'aabb'), false);
  assert.equal(requisitionCanCreateRfq({ state: { approved: [] } }), true);
});

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
