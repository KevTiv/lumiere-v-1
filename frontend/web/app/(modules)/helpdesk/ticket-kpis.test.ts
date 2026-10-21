import assert from 'node:assert/strict';
import test from 'node:test';

import { ticketKpis } from './ticket-kpis';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const now = new Date(2026, 9, 15, 12);
const past = { microsSinceUnixEpoch: BigInt(new Date(2026, 9, 1).getTime()) * 1000n };
const future = { microsSinceUnixEpoch: BigInt(new Date(2026, 10, 20).getTime()) * 1000n };
const ctx = { t, now, currencyCodeById: new Map([['1', 'USD'], ['2', 'EUR']]) };
const tile = (tiles: ReturnType<typeof ticketKpis>, key: string) => tiles.find((k) => k.key === key)!;

const rows = [
  { id: 1, state: { tag: 'New' }, slaDeadline: past, slaReached: false },
  { id: 2, state: { tag: 'InProgress' }, slaDeadline: future, slaReached: false },
  { id: 3, state: { tag: 'OnHold' }, slaDeadline: past, slaReached: true },
  { id: 4, state: { tag: 'Closed' }, slaDeadline: past, slaReached: false },
  { id: 5, state: { tag: 'Cancelled' } },
  { id: 6, state: { tag: 'New' } },
];
const ids = (key: string) => rows.filter(tile(ticketKpis(rows, ctx), key).matches!).map((r) => r.id);

test('open tickets exclude closed and cancelled ones', () => {
  assert.deepEqual(ids('open'), [1, 2, 3, 6]);
});

test('SLA breached is open tickets past their deadline without the SLA reached', () => {
  assert.deepEqual(ids('slaBreached'), [1]);
  assert.equal(tile(ticketKpis(rows, ctx), 'slaBreached').value, 1);
});
