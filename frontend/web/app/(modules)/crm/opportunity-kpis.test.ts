import assert from 'node:assert/strict';
import test from 'node:test';

import { opportunityKpis } from './opportunity-kpis';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const now = new Date(2026, 9, 15, 12);
const past = { microsSinceUnixEpoch: BigInt(new Date(2026, 9, 1).getTime()) * 1000n };
const future = { microsSinceUnixEpoch: BigInt(new Date(2026, 10, 20).getTime()) * 1000n };
const ctx = { t, now, currencyCodeById: new Map([['1', 'USD'], ['2', 'EUR']]) };
const tile = (tiles: ReturnType<typeof opportunityKpis>, key: string) => tiles.find((k) => k.key === key)!;

const rows = [
  { id: 1, expectedRevenue: 1000, companyCurrencyId: 1, dateDeadline: past },
  { id: 2, expectedRevenue: 500, companyCurrencyId: { some: 2 }, dateDeadline: future },
  { id: 3, expectedRevenue: 250, companyCurrencyId: 1 },
  { id: 4, expectedRevenue: 9999, companyCurrencyId: 1, isWon: true, dateDeadline: past },
  { id: 5, expectedRevenue: 9999, companyCurrencyId: 1, isLost: true },
  { id: 6, expectedRevenue: 9999, companyCurrencyId: 1, deletedAt: past },
];
const ids = (key: string) => rows.filter(opportunityKpis(rows, ctx).find((k) => k.key === key)!.matches!).map((r) => r.id);

test('open opportunities are neither won, lost nor deleted', () => {
  assert.deepEqual(ids('open'), [1, 2, 3]);
  assert.equal(opportunityKpis(rows, ctx)[0]!.value, 3);
});

test('expected revenue is summed per currency, never across them', () => {
  assert.equal(opportunityKpis(rows, ctx)[1]!.value, '€500.00 · $1,250.00');
});

test('past deadline counts open opportunities only', () => {
  assert.deepEqual(ids('overdue'), [1]);
});
