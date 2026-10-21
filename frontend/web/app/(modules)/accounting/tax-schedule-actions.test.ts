import assert from 'node:assert/strict';
import test from 'node:test';

import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

import {
  canEditTaxSchedule,
  scheduleJurisdictionOptions,
  scheduleTaxIds,
  scheduleTaxOptions,
  taxScheduleEditDefaults,
  toTaxScheduleCreateParams,
  toTaxScheduleUpdateParams,
} from './tax-schedule-actions';

const day = (iso: string) => ({ __timestamp_micros_since_unix_epoch__: Date.parse(iso) * 1000 });
const schedule = {
  id: 6,
  companyId: '9',
  name: 'Quarterly VAT',
  description: undefined,
  jurisdictionId: { some: '3' },
  taxIds: [1n, 2n],
  isActive: true,
  effectiveFrom: { some: { microsSinceUnixEpoch: BigInt(Date.parse('2026-01-01')) * 1000n } },
  effectiveTo: undefined,
};

// The hooks encode without a struct name, so this is the exact body that goes on the wire.
const wire = (params: object) => stdbParamsToJson(params);

test('create sends every option field explicitly', () => {
  const params = toTaxScheduleCreateParams({ name: ' Monthly ', taxIds: ['4', '5'] });
  assert.ok(params);
  assert.deepEqual(wire(params), {
    name: 'Monthly',
    description: { none: [] },
    jurisdiction_id: { none: [] },
    tax_ids: [4, 5],
    is_active: true,
    effective_from: { none: [] },
    effective_to: { none: [] },
    metadata: { none: [] },
  });
});

test('create carries description, jurisdiction, flag and effective dates', () => {
  const params = toTaxScheduleCreateParams({
    name: 'Seasonal',
    description: 'Summer rate',
    jurisdictionId: '3',
    taxIds: ['4'],
    isActive: false,
    effectiveFrom: '2026-06-01',
    effectiveTo: '2026-09-30',
  });
  assert.ok(params);
  assert.deepEqual(wire(params), {
    name: 'Seasonal',
    description: { some: 'Summer rate' },
    jurisdiction_id: { some: 3 },
    tax_ids: [4],
    is_active: false,
    effective_from: { some: day('2026-06-01') },
    effective_to: { some: day('2026-09-30') },
    metadata: { none: [] },
  });
});

test('a schedule needs a name and readable dates; an empty tax list is accepted like the reducer does', () => {
  assert.equal(toTaxScheduleCreateParams({ name: ' ' }), null);
  assert.equal(toTaxScheduleCreateParams({ name: 'A', effectiveFrom: 'nope' }), null);
  assert.equal(toTaxScheduleCreateParams({ name: 'A', effectiveTo: 'nope' }), null);
  assert.equal(toTaxScheduleCreateParams(null), null);
  const empty = toTaxScheduleCreateParams({ name: 'A' });
  assert.ok(empty);
  assert.deepEqual(wire(empty).tax_ids, []);
});

test('tax ids are de-duplicated and non-ids dropped', () => {
  assert.deepEqual(scheduleTaxIds(['2', '2', '0', 'x', '7']), [2n, 7n]);
  assert.deepEqual(scheduleTaxIds(undefined), []);
});

test('the edit form is prefilled from the row', () => {
  assert.deepEqual(taxScheduleEditDefaults(schedule), {
    name: 'Quarterly VAT',
    description: '',
    jurisdictionId: '3',
    taxIds: ['1', '2'],
    isActive: true,
    effectiveFrom: '2026-01-01',
    effectiveTo: '',
  });
});

test('an untouched form sends nothing, whatever the order of the taxes', () => {
  const same = { name: 'Quarterly VAT', jurisdictionId: '3', taxIds: ['2', '1'], isActive: true, effectiveFrom: '2026-01-01' };
  assert.deepEqual(toTaxScheduleUpdateParams(same, schedule), { ok: false, reason: 'unchanged' });
  assert.deepEqual(toTaxScheduleUpdateParams({ ...same, name: '' }, schedule), { ok: false, reason: 'invalid' });
  assert.deepEqual(toTaxScheduleUpdateParams({ ...same, effectiveTo: 'x' }, schedule), { ok: false, reason: 'invalid' });
});

test('update sends only changed fields, with double options for the clearable ones', () => {
  const r = toTaxScheduleUpdateParams(
    {
      name: 'Quarterly VAT',
      description: 'Updated',
      jurisdictionId: '',
      taxIds: ['1', '2', '8'],
      isActive: false,
      effectiveFrom: '',
      effectiveTo: '2026-12-31',
    },
    schedule,
  );
  assert.ok(r.ok);
  assert.deepEqual(wire(r.ok ? r.params : {}), {
    name: { none: [] },
    description: { some: { some: 'Updated' } },
    jurisdiction_id: { some: { none: [] } },
    tax_ids: { some: [1, 2, 8] },
    is_active: { some: false },
    effective_from: { some: { none: [] } },
    effective_to: { some: { some: day('2026-12-31') } },
    metadata: { none: [] },
  });
});

test('removing every tax is a real change and sends an empty list', () => {
  const r = toTaxScheduleUpdateParams(
    { name: 'Quarterly VAT', jurisdictionId: '3', taxIds: [], isActive: true, effectiveFrom: '2026-01-01' },
    schedule,
  );
  assert.ok(r.ok);
  assert.deepEqual(wire(r.ok ? r.params : {}).tax_ids, { some: [] });
});

test('tax options are the active taxes of the company, keeping a selected inactive one', () => {
  const taxes = [
    { id: 1, name: 'VAT 20', active: true, companyId: '9' },
    { id: 2, name: 'Old levy', active: false, companyId: '9' },
    { id: 3, name: 'Gone', active: false, companyId: '9' },
    { id: 4, name: 'Elsewhere', active: true, companyId: '5' },
  ];
  assert.deepEqual(scheduleTaxOptions(taxes, 9n, ['2'], '(inactive)'), [
    { value: '1', label: 'VAT 20' },
    { value: '2', label: 'Old levy (inactive)' },
  ]);
  assert.deepEqual(scheduleTaxOptions(taxes, 9n, [], '(inactive)'), [{ value: '1', label: 'VAT 20' }]);
});

test('jurisdiction options are the active ones plus the current link', () => {
  const js = [
    { id: 3, name: 'California', code: 'US-CA', isActive: false },
    { id: 4, name: 'Texas', code: 'US-TX', isActive: true },
    { id: 5, name: 'Closed', code: 'X', isActive: false },
  ];
  assert.deepEqual(scheduleJurisdictionOptions(js, '3', '(inactive)'), [
    { value: '3', label: 'California (US-CA) (inactive)' },
    { value: '4', label: 'Texas (US-TX)' },
  ]);
});

test('only schedules of the bound company are editable', () => {
  assert.equal(canEditTaxSchedule(schedule, 9n), true);
  assert.equal(canEditTaxSchedule(schedule, 2n), false);
});
