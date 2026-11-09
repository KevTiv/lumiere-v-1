import assert from 'node:assert/strict';
import test from 'node:test';

import { saleOrderKpis } from './sale-order-kpis';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const now = new Date(2026, 9, 15, 12);
const past = { microsSinceUnixEpoch: BigInt(new Date(2026, 9, 1).getTime()) * 1000n };
const future = { microsSinceUnixEpoch: BigInt(new Date(2026, 10, 20).getTime()) * 1000n };
const ctx = { t, now, currencyCodeById: new Map([['1', 'USD'], ['2', 'EUR']]) };
const tile = (tiles: ReturnType<typeof saleOrderKpis>, key: string) => tiles.find((k) => k.key === key)!;

const rows = [
  { id: 1, state: { tag: 'Draft' } },
  { id: 2, state: 'Sent' },
  { id: 3, state: { tag: 'Sale' }, invoiceStatus: { tag: 'ToInvoice' }, dateOrder: past, amountTotal: 100, currencyId: 1 },
  { id: 4, state: { tag: 'Done' }, invoiceStatus: { tag: 'Invoiced' }, dateOrder: past, amountTotal: 50, currencyId: 2 },
  { id: 5, state: { tag: 'Sale' }, invoiceStatus: { tag: 'ToInvoice' }, dateOrder: { microsSinceUnixEpoch: 1_000_000_000_000n }, amountTotal: 999, currencyId: 1 },
  { id: 6, state: { tag: 'Cancelled' } },
];
const ids = (key: string) => rows.filter(tile(saleOrderKpis(rows, ctx), key).matches!).map((r) => r.id);

test('quotations are draft and sent orders', () => {
  assert.equal(tile(saleOrderKpis(rows, ctx), 'quotations').value, 2);
  assert.deepEqual(ids('quotations'), [1, 2]);
});

test('orders to invoice are confirmed orders not yet fully invoiced', () => {
  assert.deepEqual(ids('toInvoice'), [3, 5]);
});

test('confirmed order value names its fixed month and keeps currencies separate', () => {
  const revenue = tile(saleOrderKpis(rows, ctx), 'revenue');
  assert.equal(revenue.value, '€50.00 · $100.00');
  assert.equal(revenue.label, 'Confirmed order value this month');
  assert.equal(revenue.hint, 'Confirmed orders: {{count}} · Current calendar month');
  assert.deepEqual(ids('revenue'), [3, 4]);
});

test('order value without a known currency is excluded with an explanation', () => {
  const tiles = saleOrderKpis([{ state: 'Sale', dateOrder: past, amountTotal: 7 }], ctx);
  assert.equal(tile(tiles, 'revenue').value, '—');
  assert.match(tile(tiles, 'revenue').hint!, /currency is unavailable/);
});


test('missing amounts are disclosed instead of becoming a confirmed zero', () => {
  const result = tile(saleOrderKpis([
    { state: 'Sale', dateOrder: past, amountTotal: null, currencyId: 1 },
    { state: 'Sale', dateOrder: past, amountTotal: '', currencyId: 1 },
  ], ctx), 'revenue');
  assert.equal(result.value, '—');
  assert.match(result.hint!, /no valid amount/);
  const zero = tile(saleOrderKpis([{ state: 'Sale', dateOrder: past, amountTotal: 0, currencyId: 1 }], ctx), 'revenue');
  assert.equal(zero.value, '$0.00');
  assert.doesNotMatch(zero.hint!, /no valid amount/);
});


test('unresolved currency identities never merge into one unlabeled amount', () => {
  const unknown = [
    { state: 'Sale', dateOrder: past, amountTotal: 100, currencyId: 3 },
    { state: 'Sale', dateOrder: past, amountTotal: 200, currencyId: 4 },
  ];
  assert.equal(tile(saleOrderKpis(unknown, ctx), 'revenue').value, '—');
  const mixed = tile(saleOrderKpis([...unknown, { state: 'Sale', dateOrder: past, amountTotal: 50, currencyId: 1 }], ctx), 'revenue');
  assert.equal(mixed.value, '$50.00');
  assert.match(mixed.hint!, /currency is unavailable/);
});
