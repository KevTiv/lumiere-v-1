import assert from 'node:assert/strict';
import test from 'node:test';

import { transferKpis } from './transfer-kpis';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const now = new Date(2026, 9, 15, 12);
const past = { microsSinceUnixEpoch: BigInt(new Date(2026, 9, 1).getTime()) * 1000n };
const future = { microsSinceUnixEpoch: BigInt(new Date(2026, 10, 20).getTime()) * 1000n };
const ctx = { t, now, sourceState: { status: 'ready' as const }, currencyCodeById: new Map([['1', 'USD'], ['2', 'EUR']]) };
const tile = (tiles: ReturnType<typeof transferKpis>, key: string) => tiles.find((k) => k.key === key)!;

const rows = [
  { id: 1, state: 'assigned', scheduledDate: future },
  { id: 2, state: 'assigned', scheduledDate: past },
  { id: 3, state: 'confirmed', scheduledDate: past },
  { id: 4, state: 'waiting', scheduledDate: future },
  { id: 5, state: 'done', scheduledDate: past },
  { id: 6, state: 'draft', scheduledDate: past },
  { id: 7, state: { tag: 'Assigned' }, scheduledDate: future },
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


test('loading, denied, failed and stale reads cannot expose zero or cached KPI values', () => {
  for (const status of ['loading', 'denied', 'error', 'partial'] as const) {
    for (const data of [[], rows]) {
      const tiles = transferKpis(data, { ...ctx, sourceState: { status } });
      for (const tile of tiles) {
        assert.equal(tile.value, '—');
        assert.equal(tile.matches, undefined);
        assert.ok(tile.hint);
      }
    }
  }
});


test('native timestamp microseconds preserve early years, epoch and pre-epoch dates', () => {
  const nativeDates = [
    { microsSinceUnixEpoch: BigInt(Date.parse('1972-01-01T00:00:00Z')) * 1000n },
    { micros_since_unix_epoch: 0n },
    { __timestamp_micros_since_unix_epoch__: -1000n },
    BigInt(Date.parse('1972-01-01T00:00:00Z')) * 1000n,
    new Date('1972-01-01T00:00:00Z'),
    '1972-01-01T00:00:00Z',
  ];
  for (const scheduledDate of nativeDates) {
    const tiles = transferKpis([{ id: 1, state: 'assigned', scheduledDate }], ctx);
    assert.equal(tile(tiles, 'late').value, 1, String(scheduledDate));
    assert.ok(tile(tiles, 'late').matches?.({ state: 'assigned', scheduledDate }));
  }
});

test('invalid ISO calendar dates and missing native timestamps withhold the late figure', () => {
  for (const scheduledDate of ['2026-02-30T00:00:00Z', '2026-02-30', undefined, null]) {
    const tiles = transferKpis([{ id: 1, state: 'assigned', scheduledDate }], ctx);
    assert.equal(tile(tiles, 'ready').value, 1);
    assert.equal(tile(tiles, 'late').value, '—');
    assert.equal(tile(tiles, 'late').matches, undefined);
  }
});
