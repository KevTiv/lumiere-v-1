import assert from 'node:assert/strict';
import test from 'node:test';

import { saleOrderStatusBar } from './sale-order-status';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const stateOf = (state: string, extra: Record<string, unknown> = {}) => ({ state: { tag: state }, ...extra });

test('a draft quotation is on the first stage of quotation → sent → sales order → locked', () => {
  const bar = saleOrderStatusBar(stateOf('Draft'), t);

  assert.deepEqual(
    bar.steps.map((step) => step.id),
    ['Draft', 'Sent', 'Sale', 'Locked'],
  );
  assert.equal(bar.current, 'Draft');
  assert.equal(bar.terminal, undefined);
});

test('a sent quotation and a confirmed order are on their own stages', () => {
  assert.equal(saleOrderStatusBar(stateOf('Sent'), t).current, 'Sent');
  assert.equal(saleOrderStatusBar(stateOf('Sale'), t).current, 'Sale');
});

test('an order waiting for approval shows that stage between sent and sales order', () => {
  const bar = saleOrderStatusBar(stateOf('ToApprove'), t);

  assert.deepEqual(
    bar.steps.map((step) => step.id),
    ['Draft', 'Sent', 'ToApprove', 'Sale', 'Locked'],
  );
  assert.equal(bar.current, 'ToApprove');
});

test('a done order, and a confirmed order that is locked, are on the locked stage', () => {
  assert.equal(saleOrderStatusBar(stateOf('Done'), t).current, 'Locked');
  assert.equal(saleOrderStatusBar(stateOf('Sale', { isLocked: true }), t).current, 'Locked');
  assert.equal(saleOrderStatusBar(stateOf('Sale', { is_locked: true }), t).current, 'Locked');
});

test('a cancelled order is shown outside the flow', () => {
  for (const state of ['Cancel', 'Cancelled']) {
    const bar = saleOrderStatusBar(stateOf(state), t);
    assert.equal(bar.current, '');
    assert.equal(bar.terminal?.label, 'Cancelled');
  }
});
