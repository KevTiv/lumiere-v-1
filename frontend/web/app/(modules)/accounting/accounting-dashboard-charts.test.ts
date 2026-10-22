import assert from 'node:assert/strict';
import test from 'node:test';

import type { AccountMoveQueryRow } from '@lumiere/stdb/resource-reads';

import {
  type AccountPaymentQueryRow,
  agingShareRows,
  agingTotals,
  collectionRate,
  dominantCurrencyCode,
  invoiceTabs,
  recentInvoiceRows,
  revenueVsExpensesByMonth,
  topCustomers,
  weeklyCashMovements,
  singleCurrencyId,
  timestampMs,
} from './accounting-dashboard-charts';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const now = new Date(2026, 9, 18, 12);
type Ts = NonNullable<AccountMoveQueryRow['date']>;
const at = (y: number, m: number, d: number) =>
  ({ microsSinceUnixEpoch: BigInt(new Date(y, m, d).getTime()) * 1000n }) as unknown as Ts;

let nextId = 1n;
function move(fields: Partial<AccountMoveQueryRow>): AccountMoveQueryRow {
  return {
    id: nextId++,
    organizationId: 1n,
    state: { tag: 'Posted' },
    paymentState: { tag: 'NotPaid' },
    amountTotal: 100,
    amountResidual: 0,
    date: at(2026, 9, 5),
    ...fields,
  } as AccountMoveQueryRow;
}

function payment(fields: Partial<AccountPaymentQueryRow>): AccountPaymentQueryRow {
  return {
    id: nextId++,
    organizationId: 1n,
    state: { tag: 'Paid' },
    paymentType: { tag: 'InBound' },
    amount: 50,
    date: at(2026, 9, 15),
    ...fields,
  } as AccountPaymentQueryRow;
}

const october = { startMs: new Date(2026, 9, 1).getTime(), endMs: new Date(2026, 10, 1).getTime() - 1 };
const september = { startMs: new Date(2026, 8, 1).getTime(), endMs: new Date(2026, 9, 1).getTime() - 1 };

test('revenue vs expenses sums posted moves per month', () => {
  const invoices = [
    move({ amountTotal: 300, invoiceDate: at(2026, 9, 2) }),
    move({ amountTotal: 999, state: { tag: 'Draft' }, invoiceDate: at(2026, 9, 2) }),
    move({ amountTotal: 200, invoiceDate: at(2026, 8, 10) }),
  ];
  const bills = [move({ amountTotal: 120, invoiceDate: at(2026, 9, 3) })];
  const rows = revenueVsExpensesByMonth(invoices, bills, now, 3);
  assert.deepEqual(rows, [
    { month: 'Aug', revenue: 0, expenses: 0, net: 0 },
    { month: 'Sep', revenue: 200, expenses: 0, net: 200 },
    { month: 'Oct', revenue: 300, expenses: 120, net: 180 },
  ]);
});

test('aging buckets open residuals by days past due', () => {
  const invoices = [
    move({ amountResidual: 40, invoiceDateDue: at(2026, 9, 30) }),
    move({ amountResidual: 60, invoiceDateDue: at(2026, 8, 30) }),
    move({ amountResidual: 10, invoiceDateDue: at(2026, 4, 1) }),
  ];
  const bills = [move({ amountResidual: 25, invoiceDateDue: at(2026, 7, 1) })];
  const aging = agingTotals(invoices, bills, now.getTime());
  assert.deepEqual(aging, [
    { bucket: 'Current', AR: 40, AP: 0 },
    { bucket: '1-30', AR: 60, AP: 0 },
    { bucket: '31-60', AR: 0, AP: 0 },
    { bucket: '61-90', AR: 0, AP: 25 },
    { bucket: '90+', AR: 10, AP: 0 },
  ]);
  const [ar, ap] = agingShareRows(aging, { ar: 'AR', ap: 'AP' });
  assert.equal(ar!.values['1-30'], 60);
  assert.equal(ap!.values['61-90'], 25);
});

test('collection rate is the paid share of the period invoicing', () => {
  const invoices = [
    move({ amountTotal: 100, amountResidual: 0 }),
    move({ amountTotal: 100, amountResidual: 50 }),
    move({ amountTotal: 100, amountResidual: 100, date: at(2026, 7, 1) }),
  ];
  assert.deepEqual(collectionRate(invoices, october), { invoiced: 200, collected: 150, outstanding: 50, rate: 75 });
  assert.equal(collectionRate([], october).rate, 0);
});

test('top customers groups by partner with change vs previous period', () => {
  const labels = new Map([['7', 'Acme']]);
  const invoices = [
    move({ partnerId: 7n, amountTotal: 300 }),
    move({ partnerId: 7n, amountTotal: 100 }),
    move({ partnerId: 7n, amountTotal: 200, date: at(2026, 8, 5) }),
    move({ invoicePartnerDisplayName: 'Walk-in', amountTotal: 50 }),
  ];
  const items = topCustomers(invoices, labels, october, september);
  const acme = items.find((item) => item.label === 'Acme')!;
  assert.equal(acme.value, 400);
  assert.equal(acme.change, 100);
  assert.equal(acme.hint, '2 invoices');
  assert.equal(items.find((item) => item.label === 'Walk-in')!.change, undefined);
});

test('weekly cash nets inbound against outbound and flags spikes', () => {
  const payments = [
    payment({ amount: 100, date: at(2026, 9, 17) }),
    payment({ amount: 30, paymentType: { tag: 'OutBound' }, date: at(2026, 9, 17) }),
    payment({ amount: 500, state: { tag: 'Reversed' }, date: at(2026, 9, 17) }),
  ];
  const { values, anomalies } = weeklyCashMovements(payments, now, 4);
  assert.equal(values.length, 4);
  assert.equal(values[3]!.net, 70);
  assert.deepEqual(anomalies, [values[3]!.week]);
  assert.deepEqual(weeklyCashMovements([], now, 4).anomalies, []);
});

test('recent invoices carry tabs, status and currency', () => {
  const invoices = [
    move({ name: 'INV/1', amountResidual: 100, invoiceDateDue: at(2026, 9, 1), currencyId: 2n, invoiceDate: at(2026, 9, 1) }),
    move({ name: 'INV/2', state: { tag: 'Draft' }, invoiceDate: at(2026, 9, 10) }),
    move({ name: 'INV/3', paymentState: { tag: 'Paid' }, invoiceDate: at(2026, 9, 3) }),
    move({ name: 'INV/X', state: { tag: 'Cancelled' } }),
  ];
  const rows = recentInvoiceRows(invoices, new Map(), new Map([['2', 'EUR']]), t, now.getTime());
  assert.deepEqual(rows.map((row) => row.number), ['INV/2', 'INV/3', 'INV/1']);
  assert.deepEqual(rows[2]!.tabIds, ['all', 'overdue']);
  assert.equal(rows[2]!.status, 'Overdue');
  assert.equal(rows[2]!.currency, 'EUR');
  assert.deepEqual(invoiceTabs(invoices[1]!, now.getTime()), ['all', 'draft']);
  assert.deepEqual(invoiceTabs(invoices[2]!, now.getTime()), ['all', 'paid']);
});

test('dominant currency falls back when no code is known', () => {
  const codes = new Map([['1', 'CAD'], ['2', 'EUR']]);
  assert.equal(dominantCurrencyCode([move({ currencyId: 1n, companyCurrencyId: 2n }), move({ currencyId: 1n }), move({ currencyId: 2n })], codes), 'CAD');
  assert.equal(dominantCurrencyCode([], codes), 'USD');
});


test('draft and cancelled invoices do not create receivables or payables', () => {
  const invoices = [move({ state: { tag: 'Draft' }, amountResidual: 999 }), move({ state: { tag: 'Cancelled' }, amountResidual: 888 })];
  assert.deepEqual(agingTotals(invoices, invoices, now.getTime()).map(({ AR, AP }) => [AR, AP]), Array.from({ length: 5 }, () => [0, 0]));
});

test('cash movements require canonical Paid state and a known direction', () => {
  const rows = [payment({ amount: 10 }), payment({ state: { tag: 'NotPaid' }, amount: 999 }), payment({ state: { tag: 'Partial' }, amount: 888 }), payment({ paymentType: { tag: 'Unknown' } as never, amount: 777 })];
  assert.equal(weeklyCashMovements(rows, now, 1).values[0]!.net, 10);
});

test('currency aggregation rejects mixed and unknown denominations', () => {
  assert.equal(singleCurrencyId([{ currencyId: 1n }, { currencyId: 1n }]), '1');
  assert.equal(singleCurrencyId([{ currencyId: 1n }, { currencyId: 2n }]), null);
  assert.equal(singleCurrencyId([{ currencyId: 1n }, {}]), null);
  assert.equal(singleCurrencyId([]), null);
});

test('timestamp objects keep their declared microsecond unit near the epoch', () => {
  assert.equal(timestampMs({ microsSinceUnixEpoch: 86_400_000_000n }), 86_400_000);
  assert.equal(timestampMs({ microsSinceUnixEpoch: 0n }), 0);
});
