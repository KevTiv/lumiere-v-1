import assert from 'node:assert/strict';
import test from 'node:test';

import type { Subscription, SubscriptionPlan } from '@lumiere/stdb/types';

import { mrrAndChurnByMonth, planMix, subscriptionMrr } from './subscription-dashboard-charts';

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

test('mrr prefers local, then contract, then monthly', () => {
  assert.equal(subscriptionMrr(sub({ recurringMrrLocal: 80 })), 80);
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
    { month: 'Aug', mrr: 200, newMrr: 200, churnRate: 0 },
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
