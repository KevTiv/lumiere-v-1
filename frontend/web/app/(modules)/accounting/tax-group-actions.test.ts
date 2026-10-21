import assert from 'node:assert/strict';
import test from 'node:test';

import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

import {
  canEditTaxGroup,
  parseTaxGroupSequence,
  taxGroupAccountOptions,
  taxGroupEditDefaults,
  toTaxGroupCreateParams,
  toTaxGroupUpdateParams,
} from './tax-group-actions';

const group = {
  id: 4,
  companyId: '9',
  name: 'VAT',
  sequence: 10,
  precedingSubtotal: 'Untaxed',
  taxPayableAccountId: { some: '21' },
  taxReceivableAccountId: undefined,
  advanceTaxPaymentAccountId: undefined,
};

// The hooks encode without a struct name, so this is the exact body that goes on the wire.
const wire = (params: object) => stdbParamsToJson(params);

test('create sends every option field explicitly', () => {
  const params = toTaxGroupCreateParams({ name: ' VAT ', sequence: '10' });
  assert.ok(params);
  assert.deepEqual(wire(params), {
    name: 'VAT',
    sequence: 10,
    preceding_subtotal: { none: [] },
    tax_payable_account_id: { none: [] },
    tax_receivable_account_id: { none: [] },
    advance_tax_payment_account_id: { none: [] },
    metadata: { none: [] },
  });
});

test('create carries the chosen subtotal and accounts', () => {
  const params = toTaxGroupCreateParams({
    name: 'VAT',
    sequence: 0,
    precedingSubtotal: 'Untaxed',
    taxPayableAccountId: '21',
    taxReceivableAccountId: '11',
    advanceTaxPaymentAccountId: '12',
  });
  assert.ok(params);
  const body = wire(params);
  assert.equal(body.sequence, 0);
  assert.deepEqual(body.preceding_subtotal, { some: 'Untaxed' });
  assert.deepEqual(body.tax_payable_account_id, { some: 21 });
  assert.deepEqual(body.tax_receivable_account_id, { some: 11 });
  assert.deepEqual(body.advance_tax_payment_account_id, { some: 12 });
});

test('a name and a whole-number sequence are required', () => {
  assert.equal(toTaxGroupCreateParams({ name: '  ', sequence: '1' }), null);
  assert.equal(toTaxGroupCreateParams({ name: 'VAT', sequence: '' }), null);
  assert.equal(toTaxGroupCreateParams({ name: 'VAT', sequence: '1.5' }), null);
  assert.equal(toTaxGroupCreateParams({ name: 'VAT', sequence: '-1' }), null);
  assert.equal(toTaxGroupCreateParams(null), null);
  assert.equal(parseTaxGroupSequence('4294967295'), 4294967295);
  assert.equal(parseTaxGroupSequence('4294967296'), null);
});

test('the edit form is prefilled from the row', () => {
  assert.deepEqual(taxGroupEditDefaults(group), {
    name: 'VAT',
    sequence: 10,
    precedingSubtotal: 'Untaxed',
    taxPayableAccountId: '21',
    taxReceivableAccountId: '',
    advanceTaxPaymentAccountId: '',
  });
});

test('an untouched form sends nothing and a blank name is invalid', () => {
  const same = { name: 'VAT', sequence: 10, precedingSubtotal: 'Untaxed', taxPayableAccountId: '21' };
  assert.deepEqual(toTaxGroupUpdateParams(same, group), { ok: false, reason: 'unchanged' });
  assert.deepEqual(toTaxGroupUpdateParams({ ...same, name: ' ' }, group), { ok: false, reason: 'invalid' });
  assert.deepEqual(toTaxGroupUpdateParams({ ...same, sequence: 'x' }, group), { ok: false, reason: 'invalid' });
});

test('update sends only the changed fields, everything else as none', () => {
  const r = toTaxGroupUpdateParams(
    { name: 'GST', sequence: 10, precedingSubtotal: 'Untaxed', taxPayableAccountId: '21' },
    group,
  );
  assert.ok(r.ok);
  assert.deepEqual(wire(r.ok ? r.params : {}), {
    name: { some: 'GST' },
    sequence: { none: [] },
    preceding_subtotal: { none: [] },
    tax_payable_account_id: { none: [] },
    tax_receivable_account_id: { none: [] },
    advance_tax_payment_account_id: { none: [] },
    metadata: { none: [] },
  });
});

test('clearing a subtotal or account is a double option, setting one wraps the value once more', () => {
  const r = toTaxGroupUpdateParams(
    { name: 'VAT', sequence: '25', precedingSubtotal: '', taxPayableAccountId: '', taxReceivableAccountId: '11' },
    group,
  );
  assert.ok(r.ok);
  const body = wire(r.ok ? r.params : {});
  assert.deepEqual(body.sequence, { some: 25 });
  assert.deepEqual(body.preceding_subtotal, { some: { none: [] } });
  assert.deepEqual(body.tax_payable_account_id, { some: { none: [] } });
  assert.deepEqual(body.tax_receivable_account_id, { some: { some: 11 } });
  assert.deepEqual(body.advance_tax_payment_account_id, { none: [] });
});

test('account options follow the role each account must have', () => {
  const accounts = [
    { id: 1, code: '2100', name: 'VAT payable', internalGroup: { tag: 'Liability' }, companyId: '9' },
    { id: 2, code: '1100', name: 'VAT receivable', internalGroup: { tag: 'Asset' }, companyId: '9' },
    { id: 3, code: '1200', name: 'Retired', internalGroup: { tag: 'Asset' }, companyId: '9', deprecated: true },
    { id: 4, code: '1300', name: 'Other company', internalGroup: { tag: 'Asset' }, companyId: '5' },
    { id: 5, code: '4000', name: 'Sales', internalGroup: { tag: 'Income' }, companyId: '9' },
  ];
  assert.deepEqual(taxGroupAccountOptions(accounts, 'payable', 9n), [{ value: '1', label: '2100 VAT payable' }]);
  assert.deepEqual(taxGroupAccountOptions(accounts, 'receivable', 9n), [{ value: '2', label: '1100 VAT receivable' }]);
  assert.deepEqual(taxGroupAccountOptions(accounts, 'advance', 9n), [{ value: '2', label: '1100 VAT receivable' }]);
});

test('only groups of the bound company are editable', () => {
  assert.equal(canEditTaxGroup(group, 9n), true);
  assert.equal(canEditTaxGroup(group, 3n), false);
  assert.equal(canEditTaxGroup({}, 9n), false);
});
