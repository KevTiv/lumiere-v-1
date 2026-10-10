import assert from 'node:assert/strict';
import test from 'node:test';

import { transferKpis } from './transfer-kpis';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const now = new Date(2026, 9, 15, 12);
const past = { microsSinceUnixEpoch: BigInt(new Date(2026, 9, 1).getTime()) * 1000n };
const future = { microsSinceUnixEpoch: BigInt(new Date(2026, 10, 20).getTime()) * 1000n };
const ctx = { t, now, currencyCodeById: new Map([['1', 'USD'], ['2', 'EUR']]) };
const tile = (tiles: ReturnType<typeof transferKpis>, key: string) => tiles.find((k) => k.key === key)!;

const rows = [
  { id: 1, state: 'assigned', scheduledDate: future },
  { id: 2, state: 'assigned', scheduledDate: past },
  { id: 3, state: 'confirmed', scheduledDate: past },
  { id: 4, state: 'waiting', scheduledDate: future },
  { id: 5, state: 'done', scheduledDate: past },
  { id: 6, state: 'draft', scheduledDate: past },
  { id: 7, state: { tag: 'Assigned' } },
];
const ids = (key: string) => rows.filter(tile(transferKpis(rows, ctx), key).matches!).map((r) => r.id);

test('ready transfers are the reserved ones', () => {
  assert.deepEqual(ids('ready'), [1, 2, 7]);
});

test('waiting covers confirmed and waiting transfers', () => {
  assert.deepEqual(ids('waiting'), [3, 4]);
});

test('late is ready or waiting transfers past their scheduled date; done and draft never are', () => {
  assert.deepEqual(ids('late'), [2, 3]);
  assert.equal(tile(transferKpis(rows, ctx), 'late').value, 2);
});
