import assert from 'node:assert/strict';
import test from 'node:test';

import { posOrderDisplayRow } from './pos-order-rows';

test('an order row shows reference, state, total, partner and date', () => {
  const row = posOrderDisplayRow({
    id: 9,
    ticketNumber: ' T-1 ',
    state: { tag: 'Paid' },
    amountTotal: 12.5,
    partnerId: 4,
    dateOrder: { microsSinceUnixEpoch: 1_700_000_000_000_000 },
  });
  assert.deepEqual({ ...row, dateOrder: typeof row.dateOrder }, {
    id: 9,
    reference: 'T-1',
    state: 'Paid',
    amountTotal: 12.5,
    partner: '#4',
    dateOrder: 'string',
  });
});

test('reference falls back to pos reference, uid, then id; no partner is blank', () => {
  assert.equal(posOrderDisplayRow({ id: 1, pos_reference: 'R', uid: 'u' }).reference, 'R');
  assert.equal(posOrderDisplayRow({ id: 1, uid: 'u' }).reference, 'u');
  assert.equal(posOrderDisplayRow({ id: 1 }).reference, '#1');
  assert.equal(posOrderDisplayRow({ id: 1, partnerId: null }).partner, '');
});
