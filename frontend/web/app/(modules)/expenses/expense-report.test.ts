import assert from 'node:assert/strict';
import test from 'node:test';

import { expenseReportHref, expenseReportStatusBar, expensesOfReport, reportMoveIds } from './expense-report';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);

test('a report links to its own page', () => {
  assert.equal(expenseReportHref({ id: 4 }), '/expenses/reports/4');
  assert.equal(expenseReportHref({}), undefined);
});

test('the status bar runs draft to done and puts a refused report outside the flow', () => {
  const bar = expenseReportStatusBar({ state: { tag: 'Submitted' } }, t);

  assert.deepEqual(bar.steps.map((s) => s.id), ['Draft', 'Submitted', 'Approved', 'Posted', 'Done']);
  assert.equal(bar.current, 'Submitted');
  const refused = expenseReportStatusBar({ state: 'Refused' }, t);
  assert.equal(refused.current, '');
  assert.equal(refused.terminal?.label, 'Refused');
});

test('expenses are matched to their report whichever way the id is spelled', () => {
  const rows = [{ id: 1, sheetId: 7 }, { id: 2, sheet_id: '7' }, { id: 3, sheetId: 8 }, { id: 4 }];

  assert.deepEqual(expensesOfReport(rows, '7').map((r) => r.id), [1, 2]);
});

test('only the accounting entries that exist are listed', () => {
  assert.deepEqual(reportMoveIds({ accountMoveId: 5, reimbursement_move_id: 6, rebillMoveId: null }), [
    { key: 'post', id: '5' },
    { key: 'reimbursement', id: '6' },
  ]);
  assert.deepEqual(reportMoveIds({}), []);
});
