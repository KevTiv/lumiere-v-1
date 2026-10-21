import assert from 'node:assert/strict';
import test from 'node:test';

import { canActivatePlan, canDeactivatePlan } from './subscription-plan-actions';

test('activate is for inactive plans and deactivate for active ones', () => {
  assert.deepEqual([canActivatePlan({ active: true }), canDeactivatePlan({ active: true })], [false, true]);
  assert.deepEqual([canActivatePlan({ active: false }), canDeactivatePlan({ active: false })], [true, false]);
});

test('a plan with an unreadable flag cannot be deactivated', () => {
  assert.deepEqual([canActivatePlan({}), canDeactivatePlan({})], [true, false]);
});
