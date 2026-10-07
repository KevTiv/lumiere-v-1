import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canCancelOrder,
  canConfirmOrder,
  canConsumeMaterials,
  canFinishOrder,
  canFinishWorkorder,
  canProduceOrder,
  canStartOrder,
  canStartWorkorder,
  parseProduceQty,
  remainingQty,
} from './manufacturing-order-actions';

const mo = (state: string, productQty = 10, qtyProduced = 0) => ({ state: { tag: state }, productQty, qtyProduced });
const wo = (state: string, extra: Record<string, unknown> = {}) => ({ id: 1, state: { tag: state }, ...extra });

test('each order action shows only in the states its reducer accepts', () => {
  assert.deepEqual(
    ['Draft', 'Confirmed', 'Planned', 'Progress', 'ToClose', 'Done', 'Cancelled'].map((s) => [
      canConfirmOrder(mo(s)),
      canStartOrder(mo(s)),
      canConsumeMaterials(mo(s)),
      canCancelOrder(mo(s)),
    ]),
    [
      [true, false, false, true],
      [false, true, false, true],
      [false, true, false, true],
      [false, false, true, true],
      [false, false, true, true],
      [false, false, false, false],
      [false, false, false, false],
    ],
  );
});

test('produce needs progress and quantity left; finish needs to-close and full output', () => {
  assert.equal(canProduceOrder(mo('Progress', 10, 4)), true);
  assert.equal(canProduceOrder(mo('Progress', 10, 10)), false);
  assert.equal(canProduceOrder(mo('ToClose', 10, 4)), false);
  assert.equal(canFinishOrder(mo('ToClose', 10, 10)), true);
  assert.equal(canFinishOrder(mo('ToClose', 10, 6)), false);
  assert.equal(canFinishOrder(mo('Progress', 10, 10)), false);
  assert.equal(remainingQty(mo('Progress', 10, 15)), 0);
});

test('the produce quantity must be positive and within what remains', () => {
  const order = mo('Progress', 10, 4);
  assert.equal(parseProduceQty('6', order), 6);
  assert.equal(parseProduceQty(2.5, order), 2.5);
  assert.equal(parseProduceQty('7', order), null);
  assert.equal(parseProduceQty('0', order), null);
  assert.equal(parseProduceQty('', order), null);
});

test('a work order starts when pending or ready, its order runs and its blocker is done', () => {
  const running = mo('Progress');
  assert.equal(canStartWorkorder(wo('Ready'), running, []), true);
  assert.equal(canStartWorkorder(wo('Pending'), mo('Confirmed'), []), false);
  assert.equal(canStartWorkorder(wo('Progress'), running, []), false);
  const blocked = wo('Pending', { id: 2, blockedByWorkorderId: 1 });
  assert.equal(canStartWorkorder(blocked, running, [wo('Progress'), blocked]), false);
  assert.equal(canStartWorkorder(blocked, running, [wo('Done'), blocked]), true);
});

test('a work order finishes only while in progress under a running order', () => {
  assert.equal(canFinishWorkorder(wo('Progress'), mo('Progress')), true);
  assert.equal(canFinishWorkorder(wo('Progress'), mo('Cancelled')), false);
  assert.equal(canFinishWorkorder(wo('Ready'), mo('Progress')), false);
});
