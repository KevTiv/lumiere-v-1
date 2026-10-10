import assert from 'node:assert/strict';
import test from 'node:test';

import { manufacturingOrderHref, manufacturingOrderStatusBar, producedPercent, workordersOfOrder } from './manufacturing-order';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const stateOf = (state: string) => ({ state: { tag: state } });

test('an order links to its own page', () => {
  assert.equal(manufacturingOrderHref({ id: 9 }), '/manufacturing/orders/9');
  assert.equal(manufacturingOrderHref({}), undefined);
});

test('the status bar runs draft to done, with planned only while planned', () => {
  assert.deepEqual(manufacturingOrderStatusBar(stateOf('Draft'), t).steps.map((s) => s.id), [
    'Draft',
    'Confirmed',
    'Progress',
    'ToClose',
    'Done',
  ]);
  const planned = manufacturingOrderStatusBar(stateOf('Planned'), t);
  assert.deepEqual(planned.steps.map((s) => s.id).slice(1, 4), ['Confirmed', 'Planned', 'Progress']);
  assert.equal(planned.current, 'Planned');
  assert.equal(manufacturingOrderStatusBar(stateOf('ToClose'), t).current, 'ToClose');
});

test('a cancelled order is outside the flow', () => {
  const bar = manufacturingOrderStatusBar(stateOf('Cancelled'), t);

  assert.equal(bar.current, '');
  assert.equal(bar.terminal?.label, 'Cancelled');
});

test('the produced share is capped and empty when nothing is planned', () => {
  assert.equal(producedPercent({ productQty: 10, qtyProduced: 4 }), 40);
  assert.equal(producedPercent({ productQty: 10, qtyProduced: 15 }), 100);
  assert.equal(producedPercent({ product_qty: 0 }), null);
});

test('work orders are matched to their production whichever way the id is spelled', () => {
  const rows = [{ id: 1, productionId: 5 }, { id: 2, production_id: '5' }, { id: 3, productionId: 6 }];

  assert.deepEqual(workordersOfOrder(rows, '5').map((r) => r.id), [1, 2]);
});
