import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AccountAccountQueryRow,
  AccountMoveLineQueryRow,
} from '@lumiere/stdb/resource-reads';

import { expenseBreakdown, profitAndLossByMonth } from './finance-dashboard-charts';

const now = new Date(2026, 9, 18, 12);
type Ts = NonNullable<AccountMoveLineQueryRow['date']>;
const at = (y: number, m: number, d: number) =>
  ({ microsSinceUnixEpoch: BigInt(new Date(y, m, d).getTime()) * 1000n }) as unknown as Ts;

const accounts = new Map<string, AccountAccountQueryRow>([
  ['1', { id: 1n, organizationId: 1n, code: '400', name: 'Sales', internalGroup: { tag: 'Income' } } as AccountAccountQueryRow],
  ['2', { id: 2n, organizationId: 1n, code: '610', name: 'Rent', internalGroup: { tag: 'Expense' } } as AccountAccountQueryRow],
  ['3', { id: 3n, organizationId: 1n, code: '620', name: 'Software', internalGroup: { tag: 'Expense' } } as AccountAccountQueryRow],
]);

let nextId = 1n;
function line(accountId: bigint, balance: number, date: ReturnType<typeof at>, posted = true): AccountMoveLineQueryRow {
  return {
    id: nextId++,
    organizationId: 1n,
    accountId,
    balance,
    date,
    parentState: { tag: posted ? 'Posted' : 'Draft' },
  } as AccountMoveLineQueryRow;
}

test('P&L trend reads income credits and expense debits per month', () => {
  const lines = [
    line(1n, -1000, at(2026, 9, 3)),
    line(2n, 400, at(2026, 9, 4)),
    line(2n, 999, at(2026, 9, 4), false),
    line(1n, -500, at(2026, 8, 4)),
  ];
  const rows = profitAndLossByMonth(lines, accounts, now, 2);
  assert.deepEqual(rows, [
    { month: 'Sep', revenue: 500, expenses: 0, margin: 100 },
    { month: 'Oct', revenue: 1000, expenses: 400, margin: 60 },
  ]);
});

test('expense breakdown groups by account with period change', () => {
  const current = { startMs: new Date(2026, 9, 1).getTime(), endMs: now.getTime() };
  const previous = { startMs: new Date(2026, 8, 1).getTime(), endMs: new Date(2026, 9, 1).getTime() - 1 };
  const lines = [
    line(2n, 300, at(2026, 9, 2)),
    line(3n, 50, at(2026, 9, 2)),
    line(2n, 200, at(2026, 8, 2)),
    line(1n, -900, at(2026, 9, 2)),
  ];
  const items = expenseBreakdown(lines, accounts, current, previous);
  assert.deepEqual(items, [
    { label: '610 Rent', value: 300, change: 50 },
    { label: '620 Software', value: 50, change: undefined },
  ]);
});
