import assert from 'node:assert/strict';
import test from 'node:test';

import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

import {
  assetAccountOptions,
  assetCompanyId,
  assetEditDefaults,
  assetJournalOptions,
  canEditAsset,
  toAssetCreateParams,
  toAssetUpdateParams,
} from './asset-actions';

const acct = (id: number, group: string, extra: Record<string, unknown> = {}) => ({
  id,
  code: `A${id}`,
  name: `Account ${id}`,
  companyId: 9,
  deprecated: false,
  internalGroup: { tag: group },
  ...extra,
});
const accounts = [
  acct(1, 'Asset'),
  acct(2, 'Asset'),
  acct(3, 'Expense'),
  acct(4, 'Income'),
  acct(5, 'Asset', { deprecated: true }),
  acct(6, 'Asset', { companyId: 10 }),
  acct(7, 'Expense'),
];
const journals = [
  { id: 20, code: 'GEN', name: 'General', companyId: 9, active: true, type: { tag: 'General' } },
  { id: 21, code: 'BNK', name: 'Bank', companyId: 9, active: true, type: { tag: 'Bank' } },
  { id: 22, code: 'OLD', name: 'Old', companyId: 9, active: false, type: { tag: 'General' } },
  { id: 23, code: 'OTH', name: 'Other', companyId: 10, active: true, type: { tag: 'General' } },
];
const lookups = { companyId: 9n, accounts, journals };

const form = {
  code: ' EQ-1 ',
  name: ' Laptop ',
  assetType: 'Purchase',
  currencyId: '3',
  originalValue: '1200',
  salvageValue: '200',
  method: 'Linear',
  methodNumber: '5',
  methodPeriod: '12',
  methodProgressFactor: '30',
  prorata: false,
  acquisitionDate: '2026-02-01',
  journalId: '20',
  accountAssetId: '1',
  accountDepreciationId: '2',
  accountDepreciationExpenseId: '3',
  gainAccountId: '',
  lossAccountId: '',
  accountDisposalId: '',
  firstDepreciationDate: '',
};
const micros = (iso: string) => Date.parse(iso) * 1000;

const createWire = (patch: Record<string, unknown> = {}) => {
  const r = toAssetCreateParams({ ...form, ...patch }, lookups, 'create-account-asset:key-1');
  assert.equal(r.ok, true, JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
  // The create hook encodes without a struct name (the option-field table has a stale salvage_move_id).
  return r.ok ? stdbParamsToJson(r.params as object) : {};
};

test('create spells every option field explicitly and keeps zero numbers', () => {
  assert.deepEqual(createWire(), {
    idempotency_key: 'create-account-asset:key-1',
    code: 'EQ-1',
    name: 'Laptop',
    active: true,
    asset_type: { purchase: [] },
    currency_id: 3,
    original_value: 1200,
    salvage_value: 200,
    method: { linear: [] },
    method_number: 5,
    method_period: 12,
    method_progress_factor: 0,
    prorata: false,
    prorata_date: { none: [] },
    account_asset_id: 1,
    account_depreciation_id: 2,
    account_depreciation_expense_id: 3,
    journal_id: 20,
    acquisition_date: { __timestamp_micros_since_unix_epoch__: micros('2026-02-01') },
    account_analytic_id: { none: [] },
    parent_id: { none: [] },
    gain_account_id: { none: [] },
    loss_account_id: { none: [] },
    account_disposal_id: { none: [] },
    first_depreciation_date: { none: [] },
    first_depreciation_date_manual: { none: [] },
    already_depreciated_amount_import: 0,
    is_imported: false,
    account_analytic_tag_ids: [],
    asset_lifetime_days: 0,
    asset_paused_days: 0,
    depreciation_schedule: { none: [] },
    metadata: { none: [] },
  });
});

test('create sends chosen optional accounts, the first depreciation date and the degressive factor', () => {
  const wire = createWire({
    method: 'Degressive',
    methodProgressFactor: '25',
    assetType: 'Sale',
    gainAccountId: '4',
    lossAccountId: '7',
    accountDisposalId: '2',
    firstDepreciationDate: '2026-03-01',
    prorata: true,
    salvageValue: '0',
  }) as Record<string, unknown>;
  assert.deepEqual(wire.method, { degressive: [] });
  assert.equal(wire.method_progress_factor, 25);
  assert.deepEqual(wire.asset_type, { sale: [] });
  assert.equal(wire.salvage_value, 0);
  assert.equal(wire.prorata, true);
  assert.deepEqual(wire.gain_account_id, { some: 4 });
  assert.deepEqual(wire.loss_account_id, { some: 7 });
  assert.deepEqual(wire.account_disposal_id, { some: 2 });
  assert.deepEqual(wire.first_depreciation_date, { some: { __timestamp_micros_since_unix_epoch__: micros('2026-03-01') } });
});

test('create rejects values and accounts the reducer would refuse', () => {
  const reason = (patch: Record<string, unknown>) => {
    const r = toAssetCreateParams({ ...form, ...patch }, lookups, 'k');
    return r.ok ? 'ok' : r.reason;
  };
  assert.equal(reason({ code: ' ' }), 'code');
  assert.equal(reason({ name: '' }), 'name');
  assert.equal(reason({ assetType: 'Lease' }), 'assetType');
  assert.equal(reason({ currencyId: '' }), 'currency');
  assert.equal(reason({ originalValue: '0' }), 'originalValue');
  assert.equal(reason({ originalValue: 'x' }), 'originalValue');
  assert.equal(reason({ salvageValue: '-1' }), 'salvageValue');
  assert.equal(reason({ salvageValue: '1200' }), 'salvageValue');
  assert.equal(reason({ method: 'Declining' }), 'method');
  assert.equal(reason({ methodNumber: '0' }), 'methodNumber');
  assert.equal(reason({ methodNumber: '1.5' }), 'methodNumber');
  assert.equal(reason({ methodPeriod: '0' }), 'methodPeriod');
  assert.equal(reason({ method: 'DegressiveThenLinear', methodProgressFactor: '0' }), 'progressFactor');
  assert.equal(reason({ method: 'Degressive', methodProgressFactor: '120' }), 'progressFactor');
  assert.equal(reason({ acquisitionDate: '' }), 'acquisitionDate');
  assert.equal(reason({ acquisitionDate: '2026-13-40' }), 'acquisitionDate');
  assert.equal(reason({ firstDepreciationDate: 'soon' }), 'firstDepreciationDate');
  assert.equal(reason({ journalId: '21' }), 'journal');
  assert.equal(reason({ journalId: '22' }), 'journal');
  assert.equal(reason({ journalId: '23' }), 'journal');
  assert.equal(reason({ accountAssetId: '3' }), 'assetAccount');
  assert.equal(reason({ accountAssetId: '5' }), 'assetAccount');
  assert.equal(reason({ accountAssetId: '6' }), 'assetAccount');
  assert.equal(reason({ accountDepreciationId: '4' }), 'depreciationAccount');
  assert.equal(reason({ accountDepreciationExpenseId: '1' }), 'expenseAccount');
  assert.equal(reason({ gainAccountId: '1' }), 'gainAccount');
  assert.equal(reason({ lossAccountId: '4' }), 'lossAccount');
  assert.equal(reason({ accountDisposalId: '3' }), 'disposalAccount');
  assert.equal(reason({}), 'ok');
});

test('account and journal pickers filter by company, group, deprecation and journal type', () => {
  const ids = (options: { value: string }[]) => options.map((o) => o.value);
  assert.deepEqual(ids(assetAccountOptions(accounts, 9n, 'asset')), ['1', '2']);
  assert.deepEqual(ids(assetAccountOptions(accounts, 9n, 'expense')), ['3', '7']);
  assert.deepEqual(ids(assetAccountOptions(accounts, 9n, 'gain')), ['4']);
  assert.deepEqual(ids(assetAccountOptions(accounts, 9n, 'disposal')), ['1', '2']);
  // The asset's current account stays visible (flagged) even if it was deprecated since.
  const kept = assetAccountOptions(accounts, 9n, 'asset', '5', '(unavailable)');
  assert.deepEqual(ids(kept), ['1', '2', '5']);
  assert.equal(kept[2]!.label, 'A5 Account 5 (unavailable)');
  assert.deepEqual(ids(assetJournalOptions(journals, 9n)), ['20']);
  assert.deepEqual(ids(assetJournalOptions(journals, 9n, '22')), ['20', '22']);
});

const asset = {
  id: 40,
  companyId: '9',
  state: { tag: 'Draft' },
  name: 'Laptop',
  originalValue: 1200,
  salvageValue: 200,
  method: { tag: 'Linear' },
  methodNumber: 5,
  methodPeriod: 12,
  methodProgressFactor: 0,
  prorata: false,
  accountAssetId: 1,
  accountDepreciationId: 2,
  accountDepreciationExpenseId: 3,
  journalId: 20,
  gainAccountId: undefined,
  lossAccountId: { some: 7 },
  accountDisposalId: null,
  firstDepreciationDate: undefined,
};
const same = { ...assetEditDefaults(asset) };
const updateWire = (patch: Record<string, unknown>) => {
  const r = toAssetUpdateParams({ ...same, ...patch }, asset, lookups);
  assert.equal(r.ok, true, JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
  return r.ok ? stdbParamsToJson(r.params as object, 'UpdateAccountAssetParams') : {};
};
const allNone = {
  name: { none: [] },
  original_value: { none: [] },
  salvage_value: { none: [] },
  method: { none: [] },
  method_number: { none: [] },
  method_period: { none: [] },
  method_progress_factor: { none: [] },
  prorata: { none: [] },
  prorata_date: { none: [] },
  account_analytic_id: { none: [] },
  account_asset_id: { none: [] },
  account_depreciation_id: { none: [] },
  account_depreciation_expense_id: { none: [] },
  journal_id: { none: [] },
  gain_account_id: { none: [] },
  loss_account_id: { none: [] },
  account_disposal_id: { none: [] },
  first_depreciation_date: { none: [] },
  first_depreciation_date_manual: { none: [] },
  account_analytic_tag_ids: { none: [] },
  metadata: { none: [] },
};

test('only Draft assets are editable and the edit form starts from the current values', () => {
  assert.equal(canEditAsset(asset), true);
  assert.equal(canEditAsset({ ...asset, state: { tag: 'Running' } }), false);
  assert.equal(canEditAsset({ state: 'Draft' }), true);
  assert.equal(same.lossAccountId, '7');
  assert.equal(same.gainAccountId, '');
  assert.equal(same.journalId, '20');
  assert.equal(assetCompanyId(asset, 4n), 9n);
  assert.equal(assetCompanyId({}, 4n), 4n);
  assert.equal(assetCompanyId({}, 0n), null);
});

test('an untouched edit sends nothing and a Running asset is refused', () => {
  assert.deepEqual(toAssetUpdateParams(same, asset, lookups), { ok: false, reason: 'unchanged' });
  const running = toAssetUpdateParams({ ...same, name: 'X' }, { ...asset, state: { tag: 'Running' } }, lookups);
  assert.equal(running.ok, false);
});

test('only changed fields are some and everything else is spelled none', () => {
  assert.deepEqual(updateWire({ name: ' Laptop Pro ' }), { ...allNone, name: { some: 'Laptop Pro' } });
  assert.deepEqual(updateWire({ originalValue: '1500', salvageValue: '0' }), {
    ...allNone,
    original_value: { some: 1500 },
    salvage_value: { some: 0 },
  });
  assert.deepEqual(updateWire({ method: 'Degressive', methodProgressFactor: '30', methodNumber: '6' }), {
    ...allNone,
    method: { some: { degressive: [] } },
    method_number: { some: 6 },
    method_progress_factor: { some: 30 },
  });
  assert.deepEqual(updateWire({ accountAssetId: '2', journalId: '20', prorata: true }), {
    ...allNone,
    account_asset_id: { some: 2 },
    prorata: { some: true },
  });
});

test('optional accounts and the first depreciation date are doubly wrapped', () => {
  assert.deepEqual(updateWire({ gainAccountId: '4', lossAccountId: '', accountDisposalId: '1' }), {
    ...allNone,
    gain_account_id: { some: { some: 4 } },
    loss_account_id: { some: { none: [] } },
    account_disposal_id: { some: { some: 1 } },
  });
  assert.deepEqual(updateWire({ firstDepreciationDate: '2026-04-01' }), {
    ...allNone,
    first_depreciation_date: { some: { some: { __timestamp_micros_since_unix_epoch__: micros('2026-04-01') } } },
  });
  const cleared = stdbParamsToJson(
    (toAssetUpdateParams({ ...same, firstDepreciationDate: '' }, { ...asset, firstDepreciationDate: { some: { microsSinceUnixEpoch: BigInt(micros('2026-04-01')) } } }, lookups) as { params: object }).params,
    'UpdateAccountAssetParams',
  );
  assert.deepEqual(cleared, { ...allNone, first_depreciation_date: { some: { none: [] } } });
});

test('edit validates the effective original and salvage pair and the account roles', () => {
  const reason = (patch: Record<string, unknown>) => {
    const r = toAssetUpdateParams({ ...same, ...patch }, asset, lookups);
    return r.ok ? 'ok' : r.reason;
  };
  assert.equal(reason({ name: ' ' }), 'name');
  assert.equal(reason({ originalValue: '0' }), 'originalValue');
  assert.equal(reason({ originalValue: '150' }), 'salvageValue');
  assert.equal(reason({ salvageValue: '1200' }), 'salvageValue');
  assert.equal(reason({ salvageValue: '-5' }), 'salvageValue');
  assert.equal(reason({ methodNumber: '0' }), 'methodNumber');
  assert.equal(reason({ method: 'Degressive', methodProgressFactor: '0' }), 'progressFactor');
  assert.equal(reason({ journalId: '21' }), 'journal');
  assert.equal(reason({ accountDepreciationExpenseId: '1' }), 'expenseAccount');
  assert.equal(reason({ accountAssetId: '3' }), 'assetAccount');
  assert.equal(reason({ gainAccountId: '2' }), 'gainAccount');
  assert.equal(reason({ firstDepreciationDate: 'x' }), 'firstDepreciationDate');
});
