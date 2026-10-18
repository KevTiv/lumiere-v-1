import assert from 'node:assert/strict';
import test from 'node:test';

import { invoiceKind, invoiceStatus } from './invoice-status';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const tag = (value: string) => ({ tag: value });
const NOW = Date.UTC(2026, 9, 6);
const micros = (ms: number) => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });

test('a draft is on the first stage with a draft badge', () => {
  const status = invoiceStatus({ state: tag('Draft') }, t, NOW);

  assert.deepEqual(status.steps.map((s) => s.id), ['Draft', 'Posted', 'Paid']);
  assert.equal(status.current, 'Draft');
  assert.equal(status.badge.label, 'Draft');
});

test('a posted, unpaid invoice shows not paid until it is due, then overdue', () => {
  const open = { state: tag('Posted'), paymentState: tag('NotPaid'), amountResidual: 100 };

  assert.equal(invoiceStatus({ ...open, invoiceDateDue: micros(NOW + 86_400_000) }, t, NOW).badge.label, 'Not paid');
  const overdue = invoiceStatus({ ...open, invoiceDateDue: micros(NOW - 86_400_000) }, t, NOW);
  assert.equal(overdue.badge.label, 'Overdue');
  assert.equal(overdue.badge.variant, 'destructive');
  assert.equal(overdue.current, 'Posted');
});

test('a part-paid invoice shows partially paid', () => {
  const status = invoiceStatus({ state: tag('Posted'), paymentState: tag('InPayment'), amountResidual: 40 }, t, NOW);

  assert.equal(status.badge.label, 'Partially paid');
  assert.equal(status.current, 'Posted');
});

test('a paid invoice is on the last stage, even if its due date has passed', () => {
  const status = invoiceStatus(
    { state: tag('Posted'), paymentState: tag('Paid'), amountResidual: 0, invoiceDateDue: micros(NOW - 86_400_000) },
    t,
    NOW,
  );

  assert.equal(status.current, 'Paid');
  assert.equal(status.badge.label, 'Paid');
});

test('a cancelled document is outside the flow', () => {
  const status = invoiceStatus({ state: tag('Cancelled') }, t, NOW);

  assert.equal(status.current, '');
  assert.equal(status.terminal?.label, 'Cancelled');
});

test('the move type decides the kind of document', () => {
  assert.equal(invoiceKind({ moveType: tag('OutInvoice') }), 'invoice');
  assert.equal(invoiceKind({ moveType: tag('InInvoice') }), 'bill');
  assert.equal(invoiceKind({ moveType: tag('OutRefund') }), 'creditNote');
  assert.equal(invoiceKind({ moveType: tag('InRefund') }), 'vendorCredit');
  assert.equal(invoiceKind({ moveType: tag('Entry') }), 'entry');
});
