import assert from 'node:assert/strict'
import test from 'node:test'
import { cardMatchCandidates, companyWorkflowRows, eligibleExpenseReports, reportCurrencyTotals, workflowOptions } from './expense-workflow-model'

test('record choices require exact organization and company without losing large IDs', () => {
  const rows = [
    { id: '9007199254740993', organizationId: 1n, companyId: 2n, name: 'Travel' },
    { id: 2, organizationId: 1n, companyId: 3n },
    { id: 3, organizationId: 9n, companyId: 2n },
    { id: 4, organizationId: 1n },
  ]
  assert.deepEqual(workflowOptions(companyWorkflowRows(rows, 1n, 2n)), [{ value: '9007199254740993', label: 'Travel' }])
  assert.deepEqual(companyWorkflowRows(rows, 1n, 0n), [])
})

test('reports offered to an expense match its employee, currency and draft state', () => {
  const rows = [
    { id: '1', employeeId: 4n, currencyId: 5n, state: { tag: 'Draft' } },
    { id: '2', employeeId: 4n, currencyId: 6n, state: 'Draft' },
    { id: '3', employeeId: 7n, currencyId: 5n, state: 'Draft' },
    { id: '4', employeeId: 4n, currencyId: 5n, state: 'Submitted' },
  ]
  assert.deepEqual(eligibleExpenseReports(rows, { employeeId: 4n, currencyId: 5n }).map(row => row.id), ['1'])
  assert.deepEqual(eligibleExpenseReports(rows, { employeeId: 4n }), [])
})

test('dashboard separates currencies and never labels missing amounts as dollars or zero', () => {
  const codes = new Map([['1', 'USD'], ['2', 'EUR']])
  const value = reportCurrencyTotals([{ currencyId: 1, totalAmount: 10 }, { currencyId: 2, totalAmount: 20 }, { currencyId: 1, totalAmount: 5 }], codes, 'en-US', 'Unavailable')
  assert.match(value, /USD.*15\.00/)
  assert.match(value, /EUR.*20\.00/)
  assert.equal(reportCurrencyTotals([{ totalAmount: 10 }], codes, 'en-US', 'Unavailable'), 'Unavailable')
  assert.equal(reportCurrencyTotals([{ currencyId: 1 }], codes, 'en-US', 'Unavailable'), 'Unavailable')
  assert.equal(reportCurrencyTotals([{ currencyId: 1, totalAmount: 0 }], codes, 'en-US', 'Unavailable').includes('0.00'), true)
  assert.equal(reportCurrencyTotals([], codes, 'en-US', 'Unavailable'), '—')
})

test('card candidates match payment mode, currency, amount tolerance and merchant', () => {
  const line = { currencyId: 1, amount: 12, merchantKey: 'Cafe' }
  const valid = { id: 'good', currencyId: 1, totalAmount: 12, paymentMode: { tag: 'CorporateCard' }, merchantKey: 'Cafe' }
  const rows = [valid, { ...valid, id: 'cash', paymentMode: 'OutOfPocket' }, { ...valid, id: 'other-currency', currencyId: 2 }, { ...valid, id: 'wrong-amount', totalAmount: 22 }, { ...valid, id: 'other-merchant', merchantKey: 'Taxi' }]
  assert.deepEqual(cardMatchCandidates(rows, line).map(row => row.id), ['good'])
})
