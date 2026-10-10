import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPostParams, buildRebillParams, buildReimburseParams, financeKindsFor } from './expense-report-finance';

test('each report state offers only its accounting steps', () => {
  assert.deepEqual(financeKindsFor('Draft'), []);
  assert.deepEqual(financeKindsFor({ tag: 'Submitted' }), []);
  assert.deepEqual(financeKindsFor({ tag: 'Approved' }), ['postReport']);
  assert.deepEqual(financeKindsFor('Posted'), ['reimburseReport', 'projectRebill']);
  assert.deepEqual(financeKindsFor('Done'), ['projectRebill']);
  assert.deepEqual(financeKindsFor('Refused'), []);
});

test('post needs date, journal, payable and expense accounts and is idempotent per report', () => {
  assert.equal(buildPostParams('4', { accountingDate: '2026-01-02', journalId: '1' }), undefined);
  const args = buildPostParams('4', {
    accountingDate: '2026-01-02', journalId: '1', payableAccountId: '2', defaultExpenseAccountId: '3', fxFeeAmount: '1.5', advanceAccountId: '',
  });
  assert.equal(args?.sheetId, '4');
  assert.equal(args?.params.clientRequestId, 'exp-post-4');
  assert.equal(args?.params.journalId, 1n);
  assert.equal(args?.params.advanceAccountId, undefined);
  assert.equal(args?.params.fxFeeAmount, 1.5);
});

test('reimburse and rebill require their accounts; amount is optional', () => {
  assert.equal(buildReimburseParams('4', { paymentDate: '2026-01-02' }), undefined);
  const r = buildReimburseParams('4', { paymentDate: '2026-01-02', journalId: 1, payableAccountId: 2, liquidityAccountId: 3 });
  assert.equal(r?.params.clientRequestId, 'exp-reimburse-4');
  assert.equal('amount' in (r?.params ?? {}), false);
  assert.equal(buildRebillParams('4', { invoiceDate: '2026-01-02', journalId: 1 }), undefined);
  assert.equal(buildRebillParams('4', { invoiceDate: '2026-01-02', journalId: 1, receivableAccountId: 2, incomeAccountId: 3 })?.params.incomeAccountId, 3n);
});
