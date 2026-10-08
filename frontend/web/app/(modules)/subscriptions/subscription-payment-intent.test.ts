import assert from 'node:assert/strict';
import test from 'node:test';

import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

import { PAYMENT_INTENT_TYPES, newIdempotencyKey, toPaymentIntentParams } from './subscription-payment-intent';

const valid = { intentType: 'pix', amount: '25.5', currencyId: '3', invoiceMoveId: '' };

test('a valid form becomes the reducer body with an explicit none for the options', () => {
  const params = toPaymentIntentParams(valid, ' key-1 ');
  assert.ok(params);
  assert.deepEqual(stdbParamsToJson(params, 'CreateSubscriptionPaymentIntentParams'), {
    intent_type: 'pix',
    idempotency_key: 'key-1',
    invoice_move_id: { none: [] },
    payment_token_id: { none: [] },
    amount: 25.5,
    currency_id: 3,
    fallback_draft_invoice: false,
    metadata: { none: [] },
  });
});

test('an optional invoice move is wrapped in some', () => {
  const params = toPaymentIntentParams({ ...valid, invoiceMoveId: '42' }, 'k');
  assert.deepEqual(stdbParamsToJson(params!, 'CreateSubscriptionPaymentIntentParams').invoice_move_id, { some: 42 });
});

test('every reducer intent type is allowed and others are not', () => {
  for (const intentType of PAYMENT_INTENT_TYPES) assert.ok(toPaymentIntentParams({ ...valid, intentType }, 'k'), intentType);
  assert.equal(toPaymentIntentParams({ ...valid, intentType: 'wire' }, 'k'), null);
  assert.equal(toPaymentIntentParams({ ...valid, intentType: '' }, 'k'), null);
});

test('amount must be above zero, currency chosen, key and invoice move usable', () => {
  for (const amount of ['', '0', '-3', 'abc']) assert.equal(toPaymentIntentParams({ ...valid, amount }, 'k'), null, amount);
  assert.equal(toPaymentIntentParams({ ...valid, currencyId: '' }, 'k'), null);
  assert.equal(toPaymentIntentParams({ ...valid, currencyId: '0' }, 'k'), null);
  assert.equal(toPaymentIntentParams(valid, '  '), null);
  for (const invoiceMoveId of ['abc', '0', '1.5']) {
    assert.equal(toPaymentIntentParams({ ...valid, invoiceMoveId }, 'k'), null, invoiceMoveId);
  }
  assert.equal(toPaymentIntentParams(null, 'k'), null);
});

test('idempotency keys are unique per call', () => {
  const a = newIdempotencyKey();
  assert.notEqual(a, newIdempotencyKey());
  assert.match(a, /^subscription-payment-intent:[0-9a-f-]{36}$/);
});
