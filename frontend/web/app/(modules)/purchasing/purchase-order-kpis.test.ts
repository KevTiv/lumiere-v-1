import assert from 'node:assert/strict';
import test from 'node:test';

import { purchaseOrderKpis } from './purchase-order-kpis';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const now = new Date(2026, 9, 15, 12);
const past = { microsSinceUnixEpoch: BigInt(new Date(2026, 9, 1).getTime()) * 1000n };
const future = { microsSinceUnixEpoch: BigInt(new Date(2026, 10, 20).getTime()) * 1000n };
const ctx = { t, now, currencyCodeById: new Map([['1', 'USD'], ['2', 'EUR']]) };
const tile = (tiles: ReturnType<typeof purchaseOrderKpis>, key: string) => tiles.find((k) => k.key === key)!;

const rows = [
  { id: 1, state: { tag: 'Draft' } },
  { id: 2, state: { tag: 'Sent' } },
  { id: 3, state: { tag: 'Purchase' }, receiptStatus: 'nothing', datePlanned: past },
  { id: 4, state: { tag: 'Purchase' }, receiptStatus: 'partial', datePlanned: future },
  { id: 5, state: { tag: 'Purchase' }, receiptStatus: 'full', datePlanned: past },
  { id: 6, state: { tag: 'Done' }, receiptStatus: 'nothing', datePlanned: past },
  { id: 7, state: { tag: 'Purchase' }, receipt_status: 'nothing' },
];
const ids = (key: string) => rows.filter(tile(purchaseOrderKpis(rows, ctx), key).matches!).map((r) => r.id);

test('RFQs are draft and sent orders', () => {
  assert.deepEqual(ids('rfqs'), [1, 2]);
  assert.equal(tile(purchaseOrderKpis(rows, ctx), 'rfqs').value, 2);
});

test('to receive is confirmed orders whose goods have not fully arrived', () => {
  assert.deepEqual(ids('toReceive'), [3, 4, 7]);
});

test('late is to-receive orders past their planned date', () => {
  assert.deepEqual(ids('late'), [3]);
  assert.equal(tile(purchaseOrderKpis(rows, ctx), 'late').value, 1);
});
