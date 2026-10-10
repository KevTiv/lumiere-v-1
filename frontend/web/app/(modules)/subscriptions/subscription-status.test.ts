import assert from 'node:assert/strict';
import test from 'node:test';

import { subscriptionStateOf, subscriptionStatusBar } from './subscription-status';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);

test('the state is read from a tagged, keyed or plain value', () => {
  assert.equal(subscriptionStateOf({ state: { tag: 'Active' } }), 'active');
  assert.equal(subscriptionStateOf({ state: { Paused: [] } }), 'paused');
  assert.equal(subscriptionStateOf({ state: 'Draft' }), 'draft');
  assert.equal(subscriptionStateOf({}), '');
});

test('a subscription moves from draft through active to closed', () => {
  const bar = subscriptionStatusBar({ state: { tag: 'Draft' } }, t);

  assert.deepEqual(bar.steps.map((s) => s.id), ['draft', 'active', 'closed']);
  assert.equal(bar.current, 'draft');
  assert.equal(subscriptionStatusBar({ state: { tag: 'Closed' } }, t).current, 'closed');
});

test('a paused subscription shows the paused stage between active and closed', () => {
  const bar = subscriptionStatusBar({ state: { tag: 'Paused' } }, t);

  assert.deepEqual(bar.steps.map((s) => s.id), ['draft', 'active', 'paused', 'closed']);
  assert.equal(bar.current, 'paused');
});
