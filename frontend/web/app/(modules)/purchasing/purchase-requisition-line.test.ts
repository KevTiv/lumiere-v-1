import assert from 'node:assert/strict';
import test from 'node:test';

import { requisitionCanAddLine, toRequisitionLineInput } from './purchase-requisition-line';

test('lines can be added only to a draft requisition', () => {
  assert.equal(requisitionCanAddLine({ state: { tag: 'Draft' } }), true);
  assert.equal(requisitionCanAddLine({ state: 'Draft' }), true);
  assert.equal(requisitionCanAddLine({ state: { tag: 'InProgress' } }), false);
  assert.equal(requisitionCanAddLine({ state: { tag: 'Approved' } }), false);
});

test('line form values map to reducer args', () => {
  assert.deepEqual(toRequisitionLineInput({ productId: '4', uomId: 2, quantity: '3.5', name: ' Bolts ' }), {
    productId: 4n,
    productUom: 2n,
    productUomQty: 3.5,
    name: 'Bolts',
  });
  assert.equal(toRequisitionLineInput({ productId: '4', uomId: '2', quantity: 1 })?.name, null);
});

test('incomplete or non-positive lines are rejected', () => {
  assert.equal(toRequisitionLineInput(null), null);
  assert.equal(toRequisitionLineInput({ productId: '', uomId: '2', quantity: 1 }), null);
  assert.equal(toRequisitionLineInput({ productId: '4', uomId: '', quantity: 1 }), null);
  assert.equal(toRequisitionLineInput({ productId: '4', uomId: '2', quantity: 0 }), null);
  assert.equal(toRequisitionLineInput({ productId: '4', uomId: '2', quantity: 'x' }), null);
});
