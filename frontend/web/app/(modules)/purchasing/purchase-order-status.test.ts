import assert from 'node:assert/strict';
import test from 'node:test';

import { purchaseOrderStatusBar } from './purchase-order-status';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const stateOf = (state: string) => ({ state: { tag: state } });

test('a draft RFQ is on the first stage of RFQ → sent → purchase order → done', () => {
  const bar = purchaseOrderStatusBar(stateOf('Draft'), t);

  assert.deepEqual(
    bar.steps.map((step) => step.id),
    ['Draft', 'Sent', 'Purchase', 'Done'],
  );
  assert.equal(bar.current, 'Draft');
  assert.equal(bar.terminal, undefined);
});

test('sent, confirmed and done orders are on their own stages', () => {
  assert.equal(purchaseOrderStatusBar(stateOf('Sent'), t).current, 'Sent');
  assert.equal(purchaseOrderStatusBar(stateOf('Purchase'), t).current, 'Purchase');
  assert.equal(purchaseOrderStatusBar(stateOf('Done'), t).current, 'Done');
});

test('an order waiting for approval shows that stage between sent and purchase order', () => {
  const bar = purchaseOrderStatusBar(stateOf('ToApprove'), t);

  assert.deepEqual(
    bar.steps.map((step) => step.id),
    ['Draft', 'Sent', 'ToApprove', 'Purchase', 'Done'],
  );
  assert.equal(bar.current, 'ToApprove');
});

test('a cancelled order is outside the flow', () => {
  const bar = purchaseOrderStatusBar(stateOf('Cancelled'), t);

  assert.equal(bar.current, '');
  assert.equal(bar.terminal?.label, 'Cancelled');
});

test('the state may also be a plain string', () => {
  assert.equal(purchaseOrderStatusBar({ state: 'Sent' }, t).current, 'Sent');
});
