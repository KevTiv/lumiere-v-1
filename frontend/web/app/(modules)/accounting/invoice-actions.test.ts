import assert from 'node:assert/strict';
import test from 'node:test';

import { canReconcilePayment, reconcilablePaymentMoves, canResetMove, canCancelMove, canEditMoveLines, canRecomputeInvoiceTotals, canRegisterPayment, paymentOptionLabel, registrablePayments } from './invoice-actions';

const tag = (value: string) => ({ tag: value });

test('only never-posted cancelled moves can reset to draft', () => {
  assert.equal(canResetMove({ state: tag('Cancelled'), postedBefore: false }), true);
  assert.equal(canResetMove({ state: tag('Cancelled'), posted_before: false }), true);
  assert.equal(canResetMove({ state: tag('Cancelled'), postedBefore: true }), false);
  assert.equal(canResetMove({ state: tag('Posted'), postedBefore: true }), false);
  assert.equal(canResetMove({ state: tag('Draft'), postedBefore: false }), false);
  assert.equal(canResetMove({ state: tag('Cancelled') }), false);
});

test('only draft moves can be cancelled directly', () => {
  assert.equal(canCancelMove({ state: tag('Draft') }), true);
  assert.equal(canCancelMove({ state: tag('Posted') }), false);
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

test('reconcile is offered only for open posted invoices and bills', () => {
  const open = { state: tag('Posted'), amountResidual: 50 };
  assert.equal(canReconcilePayment(open, 'invoice'), true);
  assert.equal(canReconcilePayment(open, 'bill'), true);
  assert.equal(canReconcilePayment(open, 'entry'), false);
  assert.equal(canReconcilePayment({ ...open, amountResidual: 0 }, 'invoice'), false);
  assert.equal(canReconcilePayment({ state: tag('Draft'), amountResidual: 50 }, 'invoice'), false);
});

test('reconcilable payment moves are posted entries of the same company and partner with a balance', () => {
  const invoice = { id: 1, companyId: 7, partnerId: 3, state: tag('Posted'), moveType: tag('OutInvoice') };
  const entry = (over: Record<string, unknown>) => ({ id: 2, companyId: 7, partnerId: 3, state: tag('Posted'), moveType: tag('Entry'), amountResidual: 20, ...over });
  const ids = (rows: Record<string, unknown>[]) => reconcilablePaymentMoves(rows, invoice).map((r) => r.id);
  assert.deepEqual(ids([entry({})]), [2]);
  assert.deepEqual(ids([entry({ state: tag('Draft') })]), []);
  assert.deepEqual(ids([entry({ companyId: 8 })]), []);
  assert.deepEqual(ids([entry({ partnerId: 4 })]), []);
  assert.deepEqual(ids([entry({ amountResidual: 0 })]), []);
  assert.deepEqual(ids([entry({ moveType: tag('OutInvoice') })]), []);
  assert.deepEqual(ids([entry({ id: 1 })]), []);
});
