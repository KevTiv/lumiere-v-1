import assert from 'node:assert/strict';
import test from 'node:test';

import { opportunityKpis } from './opportunity-kpis';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const now = new Date(2026, 9, 15, 12);
const past = { microsSinceUnixEpoch: BigInt(new Date(2026, 9, 1).getTime()) * 1000n };
const future = { microsSinceUnixEpoch: BigInt(new Date(2026, 10, 20).getTime()) * 1000n };
const ctx = { t, now, currencyRows: [{ id: 1, code: 'USD', decimalPlaces: 2 }, { id: 2, code: 'EUR', decimalPlaces: 2 }], sourceState: { status: 'ready' as const }, currencyState: { status: 'ready' as const } };
const tile = (tiles: ReturnType<typeof opportunityKpis>, key: string) => tiles.find((k) => k.key === key)!;

const rows = [
  { isWon: false, isLost: false, id: 1, expectedRevenue: 1000, companyCurrencyId: 1, dateDeadline: past },
  { isWon: false, isLost: false, id: 2, expectedRevenue: 500, companyCurrencyId: { some: 2 }, dateDeadline: future },
  { isWon: false, isLost: false, id: 3, expectedRevenue: 250, companyCurrencyId: 1, dateDeadline: null },
  { isWon: true, isLost: false, id: 4, expectedRevenue: 9999, companyCurrencyId: 1, dateDeadline: past },
  { isWon: false, isLost: true, id: 5, expectedRevenue: 9999, companyCurrencyId: 1 },
  { isWon: false, isLost: false, id: 6, expectedRevenue: 9999, companyCurrencyId: 1, deletedAt: past },
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


test('missing expected revenue never becomes a known zero', () => {
  const result = opportunityKpis([{ id: 1, companyCurrencyId: 1, isWon: false, isLost: false }], ctx);
  assert.equal(tile(result, 'expectedRevenue').value, '—');
  assert.ok(tile(result, 'expectedRevenue').hint);
  assert.equal(tile(result, 'open').value, 1);
});

test('unresolved currency IDs do not combine into an unlabelled total', () => {
  const result = opportunityKpis(rows, { ...ctx, currencyRows: [] });
  assert.equal(tile(result, 'expectedRevenue').value, '—');
});

test('currency loading and failed reads suppress money while preserving ready counts', () => {
  for (const status of ['loading', 'error', 'denied', 'partial'] as const) {
    const result = opportunityKpis(rows, { ...ctx, currencyState: { status } });
    assert.equal(tile(result, 'expectedRevenue').value, '—');
    assert.equal(tile(result, 'open').value, 3);
    const source = opportunityKpis(rows, { ...ctx, sourceState: { status } });
    assert.equal(tile(source, 'expectedRevenue').value, '—');
    assert.equal(tile(source, 'open').value, '—');
    assert.equal(tile(source, 'overdue').value, '—');
    assert.equal(tile(source, 'open').matches, undefined);
    assert.equal(tile(source, 'expectedRevenue').matches, undefined);
    assert.equal(tile(source, 'overdue').matches, undefined);
  }
});


test('missing opportunity outcomes cannot invent an open pipeline or a zero count', () => {
  const tiles = opportunityKpis([{ id: 1, expectedRevenue: 100, companyCurrencyId: 1 }], ctx);
  assert.ok(tiles.every((tile) => tile.value === '—' && tile.matches === undefined));
});


test('redacted or invalid open deadlines suppress overdue, while explicit no-deadline is known', () => {
  const row = { id: 1, isWon: false, isLost: false, expectedRevenue: 100, companyCurrencyId: 1 };
  for (const extra of [{}, { dateDeadline: undefined }, { dateDeadline: '' }, { dateDeadline: 'invalid' }]) {
    const tiles = opportunityKpis([{ ...row, ...extra }], ctx);
    assert.equal(tile(tiles, 'open').value, 1);
    assert.equal(tile(tiles, 'expectedRevenue').value, '$100.00');
    assert.equal(tile(tiles, 'overdue').value, '—');
    assert.equal(tile(tiles, 'overdue').matches, undefined);
  }
  assert.equal(tile(opportunityKpis([{ ...row, dateDeadline: null }], ctx), 'overdue').value, 0);
  assert.equal(tile(opportunityKpis([{ ...row, date_deadline: null }], ctx), 'overdue').value, 0);
});

test('counts, money and drill predicates all use the same exact company/org population', () => {
  const scope = { organizationId: 1n, companyId: 7n };
  const row = { id: 1, organizationId: 1, companyId: 7, isWon: false, isLost: false, expectedRevenue: 100, companyCurrencyId: 1, dateDeadline: past };
  const foreign = [{ ...row, id: 2, companyId: 8 }, { ...row, id: 3, organizationId: 2 }, { ...row, id: 4, companyId: null }];
  const tiles = opportunityKpis([row, ...foreign], { ...ctx, scope });
  assert.equal(tile(tiles, 'open').value, 1);
  assert.equal(tile(tiles, 'expectedRevenue').value, '$100.00');
  assert.equal(tile(tiles, 'overdue').value, 1);
  for (const tile of tiles) {
    assert.ok(tile.matches?.(row));
    assert.ok(foreign.every((foreignRow) => !tile.matches?.(foreignRow)));
    assert.equal(tile.matches?.({ ...row, companyId: undefined }), false);
  }
  assert.ok(opportunityKpis([{ ...row, companyId: undefined }], { ...ctx, scope }).every((tile) => tile.value === '—'));
});


test('native timestamp microseconds preserve early years, epoch and pre-epoch deadlines', () => {
  const nativeDates = [
    { microsSinceUnixEpoch: BigInt(Date.parse('1972-01-01T00:00:00Z')) * 1000n },
    { micros_since_unix_epoch: 0n },
    { __timestamp_micros_since_unix_epoch__: -1000n },
    BigInt(Date.parse('1972-01-01T00:00:00Z')) * 1000n,
    new Date('1972-01-01T00:00:00Z'),
    '1972-01-01T00:00:00Z',
  ];
  for (const dateDeadline of nativeDates) {
    const row = { id: 1, isWon: false, isLost: false, expectedRevenue: 100, companyCurrencyId: 1, dateDeadline };
    const overdue = tile(opportunityKpis([row], ctx), 'overdue');
    assert.equal(overdue.value, 1, String(dateDeadline));
    assert.ok(overdue.matches?.(row));
  }
});

test('invalid ISO calendar dates never roll over into known overdue counts', () => {
  for (const dateDeadline of ['2026-02-30T00:00:00Z', '2026-02-30']) {
    const row = { id: 1, isWon: false, isLost: false, expectedRevenue: 100, companyCurrencyId: 1, dateDeadline };
    const tiles = opportunityKpis([row], ctx);
    assert.equal(tile(tiles, 'open').value, 1);
    assert.equal(tile(tiles, 'overdue').value, '—');
    assert.equal(tile(tiles, 'overdue').matches, undefined);
  }
});
