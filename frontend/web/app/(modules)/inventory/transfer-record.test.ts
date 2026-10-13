import assert from 'node:assert/strict';
import test from 'node:test';

import { transferBackorders, transferRecordHref } from './transfer-record';

test('href points at the transfer page', () => {
  assert.equal(transferRecordHref({ id: 7n }), '/inventory/transfers/7');
  assert.equal(transferRecordHref({}), undefined);
});

test('backorders are the pickings that point back at the transfer', () => {
  const rows = [{ id: 1n }, { id: 2n, backorderId: 1n }, { id: 3n, backorder_id: 9n }, { id: 4n, backorderId: 1n }];
  assert.deepEqual(transferBackorders({ id: 1n }, rows).map((r) => String(r.id)), ['2', '4']);
});

test('ids listed on the transfer count too, and the transfer is never its own backorder', () => {
  const rows = [{ id: 1n, backorderId: 1n }, { id: 5n }];
  assert.deepEqual(transferBackorders({ id: 1n, backorderIds: [5n] }, rows).map((r) => String(r.id)), ['5']);
});
