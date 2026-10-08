import assert from 'node:assert/strict';
import test from 'node:test';

import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

import {
  normalizeBillingPeriod,
  normalizePaymentMode,
  planEditDefaults,
  toBundleCreateParams,
  toPlanUpdateParams,
} from './subscription-plan-edit';

const plan = {
  id: 5,
  name: 'Pro',
  code: 'PRO',
  description: 'Pro plan',
  billingPeriod: 'monthly',
  billingPeriodUnit: 1,
  recurringInvoiceDay: 1,
  paymentMode: 'draft_invoice',
  trialPeriod: false,
  trialDuration: 0,
  isPublished: true,
  isDefault: false,
};
const same = {
  name: 'Pro',
  code: 'PRO',
  description: 'Pro plan',
  billingPeriod: 'month',
  billingPeriodUnit: '1',
  recurringInvoiceDay: '1',
  paymentMode: 'draft_invoice',
  trialPeriod: false,
  trialDuration: 0,
  isPublished: true,
  isDefault: false,
};
const wire = (values: Record<string, unknown>) => {
  const r = toPlanUpdateParams(values, plan);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.ok ? stdbParamsToJson(r.params, 'UpdateSubscriptionPlanParams') : {};
};

test('billing period and payment mode accept the reducer aliases', () => {
  assert.equal(normalizeBillingPeriod('Monthly'), 'month');
  assert.equal(normalizeBillingPeriod('annual'), 'year');
  assert.equal(normalizeBillingPeriod('quarterly'), null);
  assert.equal(normalizePaymentMode('manual'), 'draft_invoice');
  assert.equal(normalizePaymentMode('automatic'), 'automated_payment');
  assert.equal(normalizePaymentMode('cash'), null);
});

test('the form is prefilled with normalised current values', () => {
  assert.equal(planEditDefaults(plan).billingPeriod, 'month');
  assert.equal(planEditDefaults({}).paymentMode, 'draft_invoice');
});

test('an untouched form sends nothing', () => {
  assert.deepEqual(toPlanUpdateParams(same, plan), { ok: false, reason: 'unchanged' });
});

test('invalid values are rejected by field', () => {
  const reason = (patch: Record<string, unknown>) => {
    const r = toPlanUpdateParams({ ...same, ...patch }, plan);
    return r.ok ? 'ok' : r.reason;
  };
  assert.equal(reason({ name: ' ' }), 'name');
  assert.equal(reason({ code: '' }), 'code');
  assert.equal(reason({ billingPeriod: 'quarterly' }), 'billingPeriod');
  assert.equal(reason({ paymentMode: 'cash' }), 'paymentMode');
  assert.equal(reason({ billingPeriodUnit: '0' }), 'billingPeriodUnit');
  assert.equal(reason({ trialDuration: -1 }), 'trialDuration');
  for (const day of ['0', '29', '1.5', '', 'x']) assert.equal(reason({ recurringInvoiceDay: day }), 'recurringInvoiceDay', day);
  for (const day of ['1', '15', '28']) assert.equal(reason({ recurringInvoiceDay: day, name: 'Pro 2' }), 'ok', day);
});

test('only changed fields are some and every other option is spelled none', () => {
  const body = wire({ ...same, recurringInvoiceDay: '15', paymentMode: 'automated_payment', billingPeriod: 'year', description: '' });
  assert.deepEqual(body.recurring_invoice_day, { some: 15 });
  assert.deepEqual(body.payment_mode, { some: 'automated_payment' });
  assert.deepEqual(body.billing_period, { some: 'year' });
  assert.deepEqual(body.description, { some: '' });
  for (const key of ['name', 'code', 'currency_id', 'journal_id', 'product_id', 'billing_period_unit', 'trial_period', 'trial_duration', 'trial_unit', 'auto_close_limit', 'template_id', 'invoice_mail_template_id', 'website_url', 'is_published', 'is_default', 'color', 'image_1920_url', 'metadata']) {
    assert.deepEqual(body[key], { none: [] }, key);
  }
  assert.equal(Object.keys(body).length, 22);
});

test('booleans and counts that change are sent, including false and zero', () => {
  const body = wire({ ...same, isPublished: false, trialPeriod: true, trialDuration: 14, billingPeriodUnit: '3' });
  assert.deepEqual(body.is_published, { some: false });
  assert.deepEqual(body.trial_period, { some: true });
  assert.deepEqual(body.trial_duration, { some: 14 });
  assert.deepEqual(body.billing_period_unit, { some: 3 });
});

const plans = [{ id: 5 }, { id: 6 }];

test('a bundle needs an existing plan, a name and a code', () => {
  const ok = toBundleCreateParams({ planId: '6', name: ' Starter ', code: ' ST ' }, plans);
  assert.ok(ok);
  assert.deepEqual(stdbParamsToJson(ok, 'CreateSubscriptionBundleParams'), {
    plan_id: 6,
    name: 'Starter',
    code: 'ST',
    active: true,
    metadata: { none: [] },
  });
  assert.equal(toBundleCreateParams({ planId: '9', name: 'a', code: 'b' }, plans), null);
  assert.equal(toBundleCreateParams({ planId: '5', name: ' ', code: 'b' }, plans), null);
  assert.equal(toBundleCreateParams({ planId: '5', name: 'a', code: '' }, plans), null);
  assert.equal(toBundleCreateParams({ planId: '', name: 'a', code: 'b' }, plans), null);
  assert.equal(toBundleCreateParams({ planId: '5', name: 'a', code: 'b', active: false }, plans)?.active, false);
});
