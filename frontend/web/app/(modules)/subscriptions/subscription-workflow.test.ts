import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleSubscriptionOrders, eligibleSubscriptionPlans, inSubscriptionScope, subscriptionInvoices, invoiceOutstanding, nextSubscriptionAction } from './subscription-workflow';

const scope = { organizationId: 1n, companyId: 2n };
const base = { organizationId: 1n, companyId: 2n };
const subscription = { ...base, id: '9007199254740993', state: 'active', partnerId: 7, currencyId: 8, recurringNextDate: '2026-10-27' };
const invoice = { ...base, id: 10, partnerId: 7, currencyId: 8, state: { tag: 'Posted' }, moveType: { tag: 'OutInvoice' }, amountTotal: 200, amountResidual: 75 };
const run = { ...base, id: 20, subscriptionId: subscription.id, invoiceMoveId: 10 };
const next = (changes = {}) => nextSubscriptionAction(subscription, { linesReady: true, lines: [], billingReady: true, invoices: [], now: new Date('2026-10-28'), ...changes });

test('setup only offers confirmed orders and active plans in the current tenant and company', () => {
  const orders = ['draft', 'sent', 'sale', 'done', 'cancel'].map((state, id) => ({ ...base, id, state }));
  assert.deepEqual(eligibleSubscriptionOrders([...orders, { ...base, id: 8, companyId: 9, state: 'sale' }, { ...base, id: 9, organizationId: 9, state: 'sale' }], scope).map((row) => row.id), [2, 3]);
  assert.deepEqual(eligibleSubscriptionPlans([{ ...base, id: 1, active: true }, { ...base, id: 2, active: false }, { ...base, id: 3, active: true, companyId: 9 }], scope).map((row) => row.id), [1]);
  assert.equal(inSubscriptionScope(base, { ...scope, companyId: 0n }), false);
  assert.equal(inSubscriptionScope({ companyId: 2 }, scope), false);
});

test('invoice joins preserve large IDs and reject cross-subscription, tenant, company, customer and currency links', () => {
  assert.deepEqual(subscriptionInvoices(subscription, [run], [invoice], scope), [invoice]);
  for (const change of [{ companyId: 9 }, { organizationId: 9 }, { subscriptionId: '9007199254740992' }]) {
    assert.deepEqual(subscriptionInvoices(subscription, [{ ...run, ...change }], [invoice], scope), []);
  }
  for (const change of [{ companyId: 9 }, { organizationId: 9 }, { partnerId: 9 }, { currencyId: 9 }, { moveType: 'OutRefund' }, { state: 'Cancel' }]) {
    assert.deepEqual(subscriptionInvoices(subscription, [run], [{ ...invoice, ...change }], scope), []);
  }
});

test('payment recommendation uses residuals and precedes another invoice', () => {
  assert.equal(next({ invoices: [invoice] }), 'pay-invoice');
  assert.equal(next({ invoices: [{ ...invoice, amountResidual: 0 }] }), 'generate-invoice');
  assert.equal(invoiceOutstanding({ ...invoice, state: 'draft', amountResidual: 0 }), 200);
});

test('unverified or missing financial data never implies that an invoice was paid', () => {
  assert.equal(next({ billingReady: false, invoices: [invoice] }), null);
  assert.equal(next({ invoices: [{ ...invoice, amountResidual: undefined }] }), null);
  for (const amountResidual of ['bad', -1, Infinity]) assert.equal(invoiceOutstanding({ ...invoice, amountResidual }), null);
});

test('future or missing billing dates do not prompt an invoice', () => {
  assert.equal(nextSubscriptionAction({ ...subscription, recurringNextDate: '2026-11-01' }, { linesReady: true, lines: [], billingReady: true, invoices: [], now: new Date('2026-10-28') }), null);
  assert.equal(nextSubscriptionAction({ ...subscription, recurringNextDate: undefined }, { linesReady: true, lines: [], billingReady: true, invoices: [] }), null);
});

test('activation requires verified own lines, while pause and close never recommend invoices', () => {
  const draft = { ...subscription, state: 'draft' };
  const line = { subscriptionId: subscription.id };
  const input = { linesReady: true, lines: [line], billingReady: true, invoices: [] };
  assert.equal(nextSubscriptionAction(draft, input), 'activate');
  assert.equal(nextSubscriptionAction(draft, { ...input, linesReady: false }), null);
  assert.equal(nextSubscriptionAction(draft, { ...input, lines: [{ subscriptionId: 'other' }] }), null);
  assert.equal(nextSubscriptionAction({ ...subscription, state: 'paused' }, input), 'resume');
  assert.equal(nextSubscriptionAction({ ...subscription, state: 'closed' }, input), null);
});
