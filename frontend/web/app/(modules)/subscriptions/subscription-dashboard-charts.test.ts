import assert from 'node:assert/strict';
import test from 'node:test';

import type { Subscription, SubscriptionPlan } from '@lumiere/stdb/types';

import { mrrAndChurnByMonth, mrrAndChurnHistory, planMix, subscriptionMrr } from './subscription-dashboard-charts';
import { inSubscriptionScope } from './subscription-workflow';

const now = new Date(2026, 9, 18, 12);
type Ts = Subscription['dateStart'];
const at = (y: number, m: number, d: number) =>
  ({ microsSinceUnixEpoch: BigInt(new Date(y, m, d).getTime()) * 1000n }) as unknown as Ts;

let nextId = 1n;
function sub(fields: Partial<Subscription>): Subscription {
  return {
    id: nextId++,
    planId: 1n,
    state: 'active',
    isTrial: false,
    recurringMrrLocal: 0,
    recurringMrr: 100,
    recurringMonthly: 0,
    dateStart: at(2026, 6, 1),
    ...fields,
  } as Subscription;
}

test('mrr uses contract currency and never substitutes converted local amounts', () => {
  assert.equal(subscriptionMrr(sub({ recurringMrrLocal: 80 })), 100);
  assert.equal(subscriptionMrr(sub({ recurringMrr: 0, recurringMonthly: 30 })), 30);
});

test('mrr and churn follow start and close dates', () => {
  const rows = mrrAndChurnByMonth(
    [
      sub({ dateStart: at(2026, 7, 10) }),
      sub({ dateStart: at(2026, 7, 1), closeDate: at(2026, 8, 15), state: 'closed' }),
      sub({ dateStart: at(2026, 8, 3), recurringMrr: 50 }),
      sub({ dateStart: at(2026, 7, 1), isTrial: true }),
    ],
    now,
    3,
  );
  assert.deepEqual(rows, [
    { month: 'Aug', mrr: 200, newMrr: 200 },
    { month: 'Sep', mrr: 150, newMrr: 50, churnRate: 50 },
    { month: 'Oct', mrr: 150, newMrr: 0, churnRate: 0 },
  ]);
});

test('plan mix folds small plans into other', () => {
  const plans = [
    { id: 1n, name: 'Pro' },
    { id: 2n, name: 'Basic' },
    { id: 3n, name: 'Team' },
  ] as SubscriptionPlan[];
  const mix = planMix(
    [sub({ planId: 1n, recurringMrr: 300 }), sub({ planId: 2n, recurringMrr: 50 }), sub({ planId: 3n, recurringMrr: 20 })],
    plans,
    now,
    2,
  );
  assert.deepEqual(mix.segments.map((segment) => segment.label), ['Pro', 'Basic', 'Other plans']);
  assert.deepEqual(mix.rows[0]!.values, { 'plan-1': 300, 'plan-2': 50, other: 20 });
  assert.deepEqual(planMix([], plans, now).rows, []);
});

test('legacy monthly buckets retain events in the final microsecond of a month', () => {
  const lastMicro = { microsSinceUnixEpoch: BigInt(new Date(2026, 9, 1).getTime()) * 1000n - 1n } as Ts;
  const result = mrrAndChurnByMonth([
    sub({ dateStart: at(2026, 8, 1), closeDate: lastMicro, state: 'closed' }),
    sub({ dateStart: lastMicro, recurringMrr: 25 }),
  ], now, 2);
  assert.equal(result[0]!.newMrr, 125);
  assert.equal(result[0]!.mrr, 25);
});


test('draft subscriptions do not produce historical or active MRR', () => {
  const draft = sub({ state: 'draft' });
  assert.equal(mrrAndChurnByMonth([draft], now, 1)[0]!.mrr, 0);
  assert.deepEqual(planMix([draft], [], now).rows, []);
});


test('MRR preserves fractional contract amounts and does not invent a churn percentage without opening MRR', () => {
  const started = sub({ recurringMrr: 12.75, dateStart: at(2026, 9, 5) });
  assert.deepEqual(mrrAndChurnByMonth([started], now, 1), [{ month: 'Oct', mrr: 12.75, newMrr: 12.75 }]);
  assert.deepEqual(planMix([started], [], now).rows[0]?.values, { 'plan-1': 12.75 });
});

const utcNow = new Date('2026-10-18T12:00:00Z');
const stamp = (value: string) => ({ microsSinceUnixEpoch: BigInt(Date.parse(value)) * 1000n }) as Ts;
const custom = (from: string, through: string) => ({ kind: 'custom' as const, from, through });

test('all history covers years-old contracts with adaptive labelled buckets and no invented opening prior', () => {
  const rows = mrrAndChurnHistory([sub({ dateStart: stamp('1990-01-01T00:00:00Z') })], utcNow);
  assert.ok(rows.length <= 36);
  assert.match(String(rows[0]!.month), /1990/);
  assert.match(String(rows.at(-1)!.month), /2026/);
  assert.equal(rows[0]!.newMrr, 100);
  assert.equal(rows[0]!.churnRate, undefined);
  assert.equal(rows.at(-1)!.mrr, 100);
});

test('custom dates are finite half-open intervals: churn on the boundary belongs only to the next bucket', () => {
  const closed = sub({ dateStart: stamp('2020-01-01T00:00:00Z'), closeDate: stamp('2026-10-11T00:00:00Z'), state: 'closed' });
  const rows = mrrAndChurnHistory([closed], utcNow, custom('2026-10-10', '2026-10-11'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.mrr, row.newMrr, row.churnRate]), [[100, 0, 0], [0, 0, 100]]);
  const starting = sub({ dateStart: stamp('2026-10-11T00:00:00Z') });
  assert.deepEqual(mrrAndChurnHistory([starting], utcNow, custom('2026-10-10', '2026-10-11')).map(row => row.newMrr), [0, 100]);
});

test('future range is empty and future events are clamped as of now', () => {
  const future = sub({ dateStart: stamp('2026-10-18T18:00:00Z') });
  assert.deepEqual(mrrAndChurnHistory([future], utcNow, custom('2026-10-19', '2026-10-20')), []);
  assert.equal(mrrAndChurnHistory([future], utcNow, custom('2026-10-18', '2026-10-20'))[0]!.newMrr, 0);
});

test('unknown contract dates do not become created or updated dates', () => {
  const unknownStart = sub({ dateStart: undefined, createdAt: stamp('1990-01-01T00:00:00Z') });
  const unknownClose = sub({ state: 'closed', closeDate: undefined, updatedAt: stamp('2026-10-01T00:00:00Z') });
  assert.deepEqual(mrrAndChurnHistory([unknownStart, unknownClose], utcNow), []);
});

test('scoped chart inputs exclude foreign organizations and companies; history selection does not filter current plan mix', () => {
  const rows = [
    sub({ organizationId: 1n, companyId: 2n, dateStart: stamp('1990-01-01T00:00:00Z') }),
    sub({ organizationId: 9n, companyId: 2n, recurringMrr: 999 }),
    sub({ organizationId: 1n, companyId: 9n, recurringMrr: 999 }),
  ];
  const scoped = rows.filter(row => inSubscriptionScope(row, { organizationId: 1n, companyId: 2n }));
  const before = planMix(scoped, [], utcNow);
  assert.equal(mrrAndChurnHistory(scoped, utcNow)[0]!.newMrr, 100);
  assert.equal(mrrAndChurnHistory(scoped, utcNow, custom('1980-01-01', '1980-01-01'))[0]!.mrr, 0);
  assert.deepEqual(planMix(scoped, [], utcNow), before);
  assert.deepEqual(before.rows[0]!.values, { 'plan-1': 100 });
});
