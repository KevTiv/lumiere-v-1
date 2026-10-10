import assert from 'node:assert/strict';
import test from 'node:test';

import { canCancelMove, canEditMoveLines, canRecomputeInvoiceTotals, canRegisterPayment, paymentOptionLabel, registrablePayments } from './invoice-actions';

const tag = (value: string) => ({ tag: value });

test('only draft and posted moves can be cancelled', () => {
  assert.equal(canCancelMove({ state: tag('Draft') }), true);
  assert.equal(canCancelMove({ state: tag('Posted') }), true);
  assert.equal(canCancelMove({ state: tag('Cancelled') }), false);
});

test('a payment can be registered on a posted invoice or bill with a balance', () => {
  const open = { state: tag('Posted'), amountResidual: 50 };
  assert.equal(canRegisterPayment(open, 'invoice'), true);
  assert.equal(canRegisterPayment(open, 'bill'), true);
  assert.equal(canRegisterPayment(open, 'creditNote'), false);
  assert.equal(canRegisterPayment({ ...open, amountResidual: 0 }, 'invoice'), false);
  assert.equal(canRegisterPayment({ state: tag('Draft'), amountResidual: 50 }, 'invoice'), false);
});

test('registrable payments are posted payments of the same company', () => {
  const move = { companyId: 1n };
  const payments = [
    { id: 1, state: tag('Paid'), companyId: 1n },
    { id: 2, state: tag('NotPaid'), companyId: 1n },
    { id: 3, state: tag('Paid'), companyId: 2n },
    { id: 4, state: tag('Paid') },
  ];
  assert.deepEqual(registrablePayments(payments, move).map((p) => p.id), [1, 4]);
});

test('payment labels prefer the reference and fall back to the id', () => {
  assert.equal(paymentOptionLabel({ id: 7, ref: 'PAY/7', amount: 10 }), 'PAY/7 (10)');
  assert.equal(paymentOptionLabel({ id: 8 }), 'Payment #8');
});

test('lines are editable on a draft only, and plain entries have no totals to recompute', () => {
  assert.equal(canEditMoveLines({ state: tag('Draft') }), true);
  assert.equal(canEditMoveLines({ state: tag('Posted') }), false);
  assert.equal(canRecomputeInvoiceTotals('bill'), true);
  assert.equal(canRecomputeInvoiceTotals('entry'), false);
});
