import assert from 'node:assert/strict';
import test from 'node:test';

import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

import {
  bankJournals,
  canEditBankStatement,
  statementDateInput,
  toBankStatementCreateInput,
  toBankStatementUpdateParams,
} from './bank-statement-actions';

const journals = [
  { id: 1, companyId: 4, type: { tag: 'Bank' }, name: 'Bank' },
  { id: 2, companyId: 4, type: { tag: 'Sale' }, name: 'Sales' },
  { id: 3, company_id: 5, type_: 'Bank', name: 'Bank 2' },
];

test('only bank journals are offered and accepted', () => {
  assert.deepEqual(bankJournals(journals).map((j) => j.id), [1, 3]);
  assert.equal(toBankStatementCreateInput({ journalId: '2', currencyId: '1' }, journals), null);
  assert.equal(toBankStatementCreateInput({ journalId: '99', currencyId: '1' }, journals), null);
});

test('create input takes the journal company and validates the numbers', () => {
  const input = toBankStatementCreateInput(
    { journalId: '3', currencyId: '2', name: ' May ', reference: '', balanceStart: '-12.5', date: '2026-05-31' },
    journals,
  );
  assert.equal(input?.companyId, 5n);
  assert.equal(input?.journalId, 3n);
  assert.equal(input?.params.name, 'May');
  assert.equal(input?.params.reference, undefined);
  assert.equal(input?.params.balanceStart, -12.5);
  assert.equal(input?.params.currencyId, 2n);
  const body = stdbParamsToJson(input!.params, 'CreateAccountBankStatementParams');
  assert.deepEqual(body.reference, { none: [] });
  assert.deepEqual(body.name, { some: 'May' });
  assert.equal(toBankStatementCreateInput({ journalId: '1', currencyId: '', balanceStart: '0' }, journals), null);
  assert.equal(toBankStatementCreateInput({ journalId: '1', currencyId: '1', balanceStart: 'abc' }, journals), null);
  assert.equal(toBankStatementCreateInput({ journalId: '1', currencyId: '1' }, journals)?.params.balanceStart, 0);
});

test('a posted statement cannot be edited', () => {
  assert.equal(canEditBankStatement({ state: { tag: 'Open' } }), true);
  assert.equal(canEditBankStatement({ state: 'Posted' }), false);
});

const statement = {
  id: 3,
  name: 'May',
  reference: null,
  date: '2026-05-31T00:00:00.000Z',
  balanceStart: 100,
  balanceEndReal: 150,
  state: { tag: 'Open' },
};

test('the edit form date input reads the stored timestamp', () => {
  assert.equal(statementDateInput(statement.date), '2026-05-31');
  assert.equal(statementDateInput(null), '');
});

test('an untouched form sends nothing and a bad number is invalid', () => {
  const same = { name: 'May', reference: '', date: '2026-05-31', balanceStart: '100', balanceEndReal: '150' };
  assert.deepEqual(toBankStatementUpdateParams(same, statement), { ok: false, reason: 'unchanged' });
  assert.deepEqual(toBankStatementUpdateParams({ ...same, balanceStart: 'x' }, statement), { ok: false, reason: 'invalid' });
  assert.deepEqual(toBankStatementUpdateParams({ ...same, date: 'nope' }, statement), { ok: false, reason: 'invalid' });
});

test('only the five editable fields can be sent, locked fields stay none', () => {
  const r = toBankStatementUpdateParams(
    { name: 'June', reference: 'REF', date: '2026-06-30', balanceStart: '-5', balanceEndReal: '0' },
    statement,
  );
  assert.equal(r.ok, true);
  const body = stdbParamsToJson((r as { params: object }).params, 'UpdateAccountBankStatementParams');
  assert.deepEqual(body.name, { some: { some: 'June' } });
  assert.deepEqual(body.reference, { some: { some: 'REF' } });
  assert.deepEqual(body.date, { some: { some: { __timestamp_micros_since_unix_epoch__: Date.UTC(2026, 5, 30) * 1000 } } });
  assert.deepEqual(body.balance_start, { some: -5 });
  assert.deepEqual(body.balance_end_real, { some: 0 });
  for (const key of ['state', 'balance_end', 'currency_id', 'line_ids', 'move_line_ids', 'total_entry_encoding', 'total_amount', 'total_amount_currency', 'date_done', 'is_valid_balance_start', 'is_valid_balance_end', 'metadata']) {
    assert.deepEqual(body[key], { none: [] }, key);
  }
});

test('clearing a text field or the date sends the inner none', () => {
  const r = toBankStatementUpdateParams(
    { name: '', reference: '', date: '', balanceStart: '100', balanceEndReal: '150' },
    { ...statement, reference: 'old' },
  );
  const body = stdbParamsToJson((r as { params: object }).params, 'UpdateAccountBankStatementParams');
  assert.deepEqual(body.name, { some: { none: [] } });
  assert.deepEqual(body.reference, { some: { none: [] } });
  assert.deepEqual(body.date, { some: { none: [] } });
  assert.deepEqual(body.balance_start, { none: [] });
});
