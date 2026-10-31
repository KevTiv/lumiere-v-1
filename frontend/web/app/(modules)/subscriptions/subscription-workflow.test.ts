import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleSubscriptionOrders, eligibleSubscriptionPlans, inSubscriptionScope, subscriptionInvoices, invoiceOutstanding, nextSubscriptionAction } from './subscription-workflow';
import { subscriptionLifecycle } from './subscription-lifecycle';
import { completeRenewalAttempt, readRenewalAttempt, retainRenewalAttempt, renewalScope } from './subscription-renewal-attempt';

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

test('lifecycle distinguishes actual closure from billing dates and ignores untrusted metadata', () => {
  const result = subscriptionLifecycle({ ...subscription, state: 'closed', closeDate: { some: '2026-10-28T18:30:00Z' }, metadata: '{"end_date":"2035-01-01"}' } as typeof subscription & { closeDate: unknown; metadata: string }, [], scope, true);
  assert.equal(result.closedAt?.toISOString(), '2026-10-28T18:30:00.000Z');
  assert.equal(result.nextInvoiceDate?.toISOString(), '2026-10-27T00:00:00.000Z');
  assert.equal(result.closure, 'recorded');
  assert.equal(result.renewal, 'not-active');
  assert.equal(subscriptionLifecycle({ ...subscription, state: 'closed' }, [], scope, true).closure, 'unavailable');
  assert.equal(subscriptionLifecycle(subscription, [], scope, true).closure, 'not-closed');
});

test('renewal history uses the latest immutable version of the exact subscription and scope', () => {
  const renew = { ...base, id: '9007199254740995', subscriptionId: subscription.id, amendmentType: 'renew', version: 3, effectiveDate: '2026-10-20' };
  const rows = [
    { ...renew, id: '9007199254740994', version: 1, effectiveDate: '2026-08-20' }, renew,
    { ...renew, id: '44', version: 4, amendmentType: 'pause' },
    { ...renew, id: '55', version: 9, companyId: 9n },
    { ...renew, id: '56', version: 10, organizationId: 9n },
    { ...renew, id: '57', version: 11, subscriptionId: '9007199254740992' },
  ];
  const result = subscriptionLifecycle(subscription, rows, scope, true);
  assert.equal(result.renewalHistory, 'recorded');
  assert.equal(result.lastRenewal?.id, '9007199254740995');
  assert.equal(result.lastRenewal?.version, 3);
  assert.equal(result.lastRenewal?.effectiveDate.toISOString(), '2026-10-20T00:00:00.000Z');
  assert.equal(result.renewal, 'available');
});

test('unavailable, masked or inconsistent amendment reads never claim no renewal or show old evidence', () => {
  const renew = { ...base, id: '1', subscriptionId: subscription.id, amendmentType: 'renew', version: 3, effectiveDate: '2026-10-20' };
  assert.equal(subscriptionLifecycle(subscription, [renew], scope, false).renewalHistory, 'unavailable');
  for (const change of [{ effectiveDate: undefined }, { effectiveDate: 'bad' }, { version: null }, { amendmentType: undefined }, { id: '' }]) {
    const result = subscriptionLifecycle(subscription, [{ ...renew, ...change }], scope, true);
    assert.equal(result.renewalHistory, 'unavailable');
    assert.equal(result.lastRenewal, null);
  }
  assert.equal(subscriptionLifecycle(subscription, [renew, { ...renew, id: '2' }], scope, true).renewalHistory, 'unavailable');
  const switched = subscriptionLifecycle(subscription, [renew], { ...scope, companyId: 9n }, true);
  assert.equal(switched.lastRenewal, null);
  assert.equal(switched.nextInvoiceDate, null);
  assert.equal(switched.renewal, 'unavailable');
  assert.equal(subscriptionLifecycle(subscription, [], scope, true).renewalHistory, 'none-recorded');
});

test('renewal checkpoints retain the same payload and key across reload and isolate actor/company scope', () => {
  const rows = new Map<string, string>();
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
  const scope = renewalScope('ab'.repeat(32), 7n, 8n, 41n);
  const request = { idempotencyKey: 'once-only', intervals: 2, notes: 'Extend' };
  retainRenewalAttempt(scope, request, 'submitting', storage);
  assert.deepEqual(readRenewalAttempt(scope, storage), { ...request, scope, phase: 'submitting' });
  retainRenewalAttempt(scope, request, 'unknown', storage);
  assert.equal(readRenewalAttempt(scope, storage)?.idempotencyKey, 'once-only');
  assert.equal(readRenewalAttempt({ ...scope, actor: 'cd'.repeat(32) }, storage), null);
  assert.equal(readRenewalAttempt({ ...scope, companyId: '9' }, storage), null);
  assert.throws(() => retainRenewalAttempt(scope, { ...request, intervals: 3 }, 'submitting', storage), /retained renewal/);
  assert.throws(() => retainRenewalAttempt(scope, { ...request, intervals: 3 }, 'submitting', storage, true), /retained renewal/);
  completeRenewalAttempt(scope, 'different-key', storage);
  assert.ok(readRenewalAttempt(scope, storage));
  completeRenewalAttempt(scope, request.idempotencyKey, storage);
  assert.equal(readRenewalAttempt(scope, storage), null);
  retainRenewalAttempt(scope, request, 'rejected', storage);
  retainRenewalAttempt(scope, { ...request, idempotencyKey: 'new-key', intervals: 3 }, 'submitting', storage, true);
  assert.equal(readRenewalAttempt(scope, storage)?.intervals, 3);
});

test('corrupt or unavailable renewal checkpoints fail closed before a new attempt is stored', () => {
  const scope = renewalScope('ab'.repeat(32), 7n, 8n, 41n);
  let writes = 0;
  const storage = { getItem: () => '{"scope":{},"phase":"unknown"}', setItem: () => { writes++; }, removeItem: () => {} };
  assert.throws(() => retainRenewalAttempt(scope, { idempotencyKey: 'another', intervals: 2, notes: '' }, 'submitting', storage));
  assert.equal(writes, 0);
  assert.throws(() => readRenewalAttempt(scope, { ...storage, getItem: () => { throw new Error('Storage blocked'); } }), /Storage blocked/);
});
