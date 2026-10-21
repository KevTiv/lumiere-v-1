import assert from 'node:assert/strict';
import test from 'node:test';

import type { HrExpense, HrExpenseSheet } from '@lumiere/stdb/types';

import { approvalBacklog, monthlySpend, spendByCategory } from './expenses-dashboard-charts';

const now = new Date(2026, 9, 18, 12);
type Ts = HrExpense['date'];
const at = (y: number, m: number, d: number) =>
  ({ microsSinceUnixEpoch: BigInt(new Date(y, m, d).getTime()) * 1000n }) as unknown as Ts;

let nextId = 1n;
function expense(fields: Partial<HrExpense>): HrExpense {
  return {
    id: nextId++,
    state: { tag: 'Approved' },
    lineKind: { tag: 'Standard' },
    paymentMode: { tag: 'OutOfPocket' },
    totalAmount: 100,
    date: at(2026, 9, 5),
    ...fields,
  } as HrExpense;
}

const october = { startMs: new Date(2026, 9, 1).getTime(), endMs: now.getTime() };
const september = { startMs: new Date(2026, 8, 1).getTime(), endMs: new Date(2026, 9, 1).getTime() - 1 };

test('spend by category uses the product name, else the line kind', () => {
  const products = new Map([['5', 'Travel']]);
  const items = spendByCategory(
    [
      expense({ productId: 5n, totalAmount: 300 }),
      expense({ productId: 5n, totalAmount: 100, date: at(2026, 8, 3) }),
      expense({ lineKind: { tag: 'Mileage' }, totalAmount: 40 }),
      expense({ state: { tag: 'Draft' }, totalAmount: 999 }),
    ],
    products,
    october,
    september,
  );
  assert.deepEqual(items, [
    { label: 'Travel', value: 300, change: 200, hint: '1 expense' },
    { label: 'Mileage', value: 40, change: undefined, hint: '1 expense' },
  ]);
});

test('monthly spend splits out-of-pocket and card spend', () => {
  const rows = monthlySpend(
    [
      expense({ totalAmount: 100 }),
      expense({ totalAmount: 60, paymentMode: { tag: 'CorporateCard' } }),
      expense({ totalAmount: 5, state: { tag: 'Refused' } }),
    ],
    now,
    2,
  );
  assert.deepEqual(rows, [
    { month: 'Sep', outOfPocket: 0, corporateCard: 0, count: 0 },
    { month: 'Oct', outOfPocket: 100, corporateCard: 60, count: 2 },
  ]);
});

test('approval backlog lists in-flight reports oldest first', () => {
  const sheets = [
    { id: 1n, name: 'Trip', employeeId: 7n, state: { tag: 'Approved' }, totalAmount: 50, currencyId: 1n, createdAt: at(2026, 9, 10) },
    { id: 2n, name: 'Dinner', employeeId: 8n, state: { tag: 'Submitted' }, totalAmount: 20, currencyId: 1n, createdAt: at(2026, 9, 1) },
    { id: 3n, name: 'Done', employeeId: 8n, state: { tag: 'Posted' }, totalAmount: 20, currencyId: 1n, createdAt: at(2026, 9, 1) },
  ] as unknown as HrExpenseSheet[];
  const rows = approvalBacklog(sheets, new Map([['7', 'Ada']]), new Map([['1', 'USD']]), now.getTime());
  assert.deepEqual(rows.map((row) => row.report), ['Dinner', 'Trip']);
  assert.deepEqual(rows[0]!.tabIds, ['all', 'awaiting-approval']);
  assert.equal(rows[0]!.ageDays, 17);
  assert.equal(rows[1]!.employee, 'Ada');
  assert.equal(rows[0]!.employee, 'Employee #8');
});
