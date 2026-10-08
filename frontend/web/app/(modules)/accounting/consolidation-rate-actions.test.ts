import assert from 'node:assert/strict';
import test from 'node:test';

import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

import { toConsolidationRateParams } from './consolidation-rate-actions';

const valid = {
  companyId: '2',
  periodId: '3',
  currencyId: '4',
  exchangeRate: '5.25',
  rateType: 'spot',
  effectiveDate: '2026-03-31',
};

test('a complete form becomes the reducer body', () => {
  const params = toConsolidationRateParams(valid);
  assert.ok(params);
  const body = stdbParamsToJson(params);
  assert.deepEqual(body, {
    company_id: 2,
    period_id: 3,
    currency_id: 4,
    exchange_rate: 5.25,
    rate_type: 'spot',
    effective_date: { __timestamp_micros_since_unix_epoch__: Date.UTC(2026, 2, 31) * 1000 },
    metadata: { none: [] },
  });
});

test('the rate must be a positive number', () => {
  for (const bad of ['', '0', '-1', 'abc', 'NaN']) {
    assert.equal(toConsolidationRateParams({ ...valid, exchangeRate: bad }), null, bad);
  }
  assert.ok(toConsolidationRateParams({ ...valid, exchangeRate: 0.0001 }));
});

test('company, period, currency, type and date are required', () => {
  for (const key of ['companyId', 'periodId', 'currencyId']) {
    assert.equal(toConsolidationRateParams({ ...valid, [key]: '' }), null, key);
    assert.equal(toConsolidationRateParams({ ...valid, [key]: '0' }), null, key);
  }
  assert.equal(toConsolidationRateParams({ ...valid, rateType: 'fixed' }), null);
  assert.equal(toConsolidationRateParams({ ...valid, effectiveDate: '' }), null);
  assert.equal(toConsolidationRateParams({ ...valid, effectiveDate: 'x' }), null);
  assert.equal(toConsolidationRateParams(null), null);
});

test('each rate type the reducer accepts is allowed', () => {
  for (const rateType of ['average', 'spot', 'historical']) {
    assert.ok(toConsolidationRateParams({ ...valid, rateType }));
  }
});
