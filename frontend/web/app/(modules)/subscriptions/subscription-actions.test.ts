import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSubscriptionActionApplicable,
  isSubscriptionActionApplicableOnPage,
  subscriptionPageActions,
} from './subscription-actions';

const ids = (state: string) => subscriptionPageActions(state).map((a) => a.id);

test('draft subscriptions can be activated but not invoiced', () => {
  assert.ok(ids('draft').includes('activate'));
  assert.ok(!ids('draft').includes('generate-invoice'));
  assert.ok(!ids('draft').includes('rate-usage'));
});

test('active subscriptions get billing and lifecycle actions', () => {
  for (const id of ['generate-invoice', 'pay-invoice', 'pause', 'amend', 'renew', 'close', 'cancel']) {
    assert.ok(ids('active').includes(id as never), id);
  }
  assert.ok(!ids('active').includes('resume'));
});

test('paused subscriptions resume, amend and renew but are not invoiced', () => {
  assert.ok(ids('paused').includes('resume'));
  assert.ok(ids('paused').includes('amend'));
  assert.ok(!ids('paused').includes('pause'));
  assert.ok(!ids('paused').includes('generate-invoice'));
});

test('closed subscriptions only keep the ungated dunning actions', () => {
  assert.deepEqual(ids('closed'), ['advance-dunning', 'refresh-flags']);
});

test('the list gate does not hide rating, the page gate does for draft', () => {
  assert.equal(isSubscriptionActionApplicable('rate-usage', 'draft'), true);
  assert.equal(isSubscriptionActionApplicableOnPage('rate-usage', 'draft'), false);
});
