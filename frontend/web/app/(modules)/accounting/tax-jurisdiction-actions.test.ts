import assert from 'node:assert/strict';
import test from 'node:test';

import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

import {
  taxJurisdictionEditDefaults,
  toTaxJurisdictionCreateParams,
  toTaxJurisdictionUpdateParams,
} from './tax-jurisdiction-actions';

const row = {
  id: 3,
  name: 'California',
  code: 'US-CA',
  countryCode: 'US',
  stateCode: 'CA',
  countyCode: undefined,
  city: { some: 'Fresno' },
  zipFrom: undefined,
  zipTo: undefined,
  isActive: true,
};

// The hooks encode without a struct name, so this is the exact body that goes on the wire.
const wire = (params: object) => stdbParamsToJson(params);

test('create sends every option field explicitly and upper-cases the country', () => {
  const params = toTaxJurisdictionCreateParams({ name: ' Texas ', code: 'US-TX', countryCode: ' us ', stateCode: 'TX' });
  assert.ok(params);
  assert.deepEqual(wire(params), {
    name: 'Texas',
    code: 'US-TX',
    country_code: 'US',
    state_code: { some: 'TX' },
    county_code: { none: [] },
    city: { none: [] },
    zip_from: { none: [] },
    zip_to: { none: [] },
    is_active: true,
    metadata: { none: [] },
  });
});

test('create keeps zip bounds and an inactive flag', () => {
  const params = toTaxJurisdictionCreateParams({
    name: 'Zone',
    code: 'Z1',
    countryCode: 'US',
    zipFrom: '90001',
    zipTo: '90099',
    isActive: false,
  });
  assert.ok(params);
  const body = wire(params);
  assert.deepEqual(body.zip_from, { some: '90001' });
  assert.deepEqual(body.zip_to, { some: '90099' });
  assert.equal(body.is_active, false);
});

test('name, code and country are required', () => {
  const ok = { name: 'A', code: 'B', countryCode: 'US' };
  assert.ok(toTaxJurisdictionCreateParams(ok));
  for (const key of ['name', 'code', 'countryCode']) {
    assert.equal(toTaxJurisdictionCreateParams({ ...ok, [key]: ' ' }), null, key);
  }
  assert.equal(toTaxJurisdictionCreateParams(null), null);
});

test('the edit form is prefilled from the row', () => {
  assert.deepEqual(taxJurisdictionEditDefaults(row), {
    name: 'California',
    code: 'US-CA',
    countryCode: 'US',
    stateCode: 'CA',
    countyCode: '',
    city: 'Fresno',
    zipFrom: '',
    zipTo: '',
    isActive: true,
  });
});

test('an untouched form sends nothing and a blank name or code is invalid', () => {
  const same = { name: 'California', code: 'US-CA', stateCode: 'CA', city: 'Fresno', isActive: true };
  assert.deepEqual(toTaxJurisdictionUpdateParams(same, row), { ok: false, reason: 'unchanged' });
  assert.deepEqual(toTaxJurisdictionUpdateParams({ ...same, name: '' }, row), { ok: false, reason: 'invalid' });
  assert.deepEqual(toTaxJurisdictionUpdateParams({ ...same, code: ' ' }, row), { ok: false, reason: 'invalid' });
  assert.deepEqual(toTaxJurisdictionUpdateParams(null, row), { ok: false, reason: 'invalid' });
});

test('update sends only changed fields; set and cleared locations are double options', () => {
  const r = toTaxJurisdictionUpdateParams(
    { name: 'California State', code: 'US-CA', stateCode: 'CA', city: '', countyCode: 'Fresno', isActive: false },
    row,
  );
  assert.ok(r.ok);
  assert.deepEqual(wire(r.ok ? r.params : {}), {
    name: { some: 'California State' },
    code: { none: [] },
    state_code: { none: [] },
    county_code: { some: { some: 'Fresno' } },
    city: { some: { none: [] } },
    zip_from: { none: [] },
    zip_to: { none: [] },
    is_active: { some: false },
    metadata: { none: [] },
  });
});
