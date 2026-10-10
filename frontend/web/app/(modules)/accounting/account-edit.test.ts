import assert from 'node:assert/strict';
import test from 'node:test';

import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

import { accountEditCompanyId, accountEditDefaults, toAccountUpdateParams } from './account-edit';

const account = {
  id: 7,
  companyId: '9',
  name: 'Bank',
  code: '1010',
  deprecated: false,
  reconcile: false,
  note: null,
  internalType: { tag: 'Asset' },
};
const wire = (r: ReturnType<typeof toAccountUpdateParams>) => {
  assert.equal(r.ok, true);
  return r.ok ? stdbParamsToJson(r.params, 'UpdateAccountAccountParams') : {};
};

test('the account company wins over the operating company, and one is required', () => {
  assert.equal(accountEditCompanyId({ companyId: '9' }, 5n), 9n);
  assert.equal(accountEditCompanyId({}, 5n), 5n);
  assert.equal(accountEditCompanyId({}, 0n), null);
  assert.deepEqual(toAccountUpdateParams({ name: 'x', code: '1' }, {}, 0n), { ok: false, reason: 'noCompany' });
});

test('the form is prefilled from the row', () => {
  assert.deepEqual(accountEditDefaults({ ...account, note: { some: 'n' }, internalType: { tag: 'Liquidity' } }), {
    name: 'Bank',
    code: '1010',
    deprecated: false,
    reconcile: false,
    note: 'n',
    internalType: 'Liquidity',
  });
});

test('a blank name or code is rejected and an untouched form sends nothing', () => {
  assert.deepEqual(toAccountUpdateParams({ name: ' ', code: '1010' }, account, 1n), { ok: false, reason: 'invalid' });
  assert.deepEqual(toAccountUpdateParams({ name: 'Bank', code: '' }, account, 1n), { ok: false, reason: 'invalid' });
  assert.deepEqual(
    toAccountUpdateParams({ name: 'Bank', code: '1010', deprecated: false, reconcile: false, note: '', internalType: 'Asset' }, account, 1n),
    { ok: false, reason: 'unchanged' },
  );
});

test('only changed fields are sent, the rest encode as none', () => {
  const body = wire(toAccountUpdateParams({ name: 'Main bank', code: '1010', reconcile: true }, account, 1n));
  assert.deepEqual(body.company_id, { some: 9 });
  assert.deepEqual(body.name, { some: 'Main bank' });
  assert.deepEqual(body.reconcile, { some: true });
  for (const key of ['code', 'deprecated', 'note', 'internal_type', 'internal_group', 'group_id', 'tax_ids', 'metadata']) {
    assert.deepEqual(body[key], { none: [] }, key);
  }
});

test('note is a double option and internal type a wrapped enum', () => {
  const set = wire(toAccountUpdateParams({ name: 'Bank', code: '1010', note: ' hi ', internalType: 'Liquidity' }, account, 1n));
  assert.deepEqual(set.note, { some: { some: 'hi' } });
  assert.deepEqual(set.internal_type, { some: { liquidity: [] } });
  const cleared = wire(
    toAccountUpdateParams({ name: 'Bank', code: '1010', note: '' }, { ...account, note: 'old' }, 1n),
  );
  assert.deepEqual(cleared.note, { some: { none: [] } });
});

test('deprecating through the edit form sends the flag', () => {
  const body = wire(toAccountUpdateParams({ name: 'Bank', code: '1010', deprecated: true }, account, 1n));
  assert.deepEqual(body.deprecated, { some: true });
});
