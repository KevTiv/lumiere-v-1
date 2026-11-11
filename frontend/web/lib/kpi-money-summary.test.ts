import assert from 'node:assert/strict';
import test from 'node:test';
import { kpiMoneySummary, type KpiMoneyRow } from './kpi-money-summary';

const currencies = [
  { id: 1, code: 'EUR', decimalPlaces: 2 },
  { id: 2, code: 'JPY', decimalPlaces: 0 },
  { id: 3, code: 'KWD', decimalPlaces: 3 },
];
const ready = { status: 'ready' } as const;
const input = {
  currencies, rowsState: ready, currenciesState: ready,
  amount: (row: KpiMoneyRow) => row.value,
  currencyId: (row: KpiMoneyRow) => row.currencyId,
};

test('money uses each verified currency and catalog precision, without summing distinct IDs', () => {
  const result = kpiMoneySummary({ ...input, rows: [{ value: 12.34, currencyId: 1 }, { value: 150, currencyId: 2 }, { value: 1.001, currencyId: 3 }] });
  assert.equal(result.value, '€12.34 · ¥150 · KWD\u00a01.001');
  assert.equal(result.state.status, 'ready');
});

test('same-code currency IDs stay in separate groups', () => {
  assert.equal(kpiMoneySummary({ ...input, currencies: [{ id: 1, code: 'EUR', decimalPlaces: 2 }, { id: 2, code: 'EUR', decimalPlaces: 2 }], rows: [{ value: 100, currencyId: 1 }, { value: 200, currencyId: 2 }] }).value, '€100.00 · €200.00');
});

test('no absent, redacted, invalid, unsafe or unknown-currency input becomes a partial total or zero', () => {
  for (const value of [undefined, null, '', ' ', true, '0x10', 'invalid', Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.equal(kpiMoneySummary({ ...input, rows: [{ value: 20, currencyId: 1 }, { value, currencyId: 1 }] }).value, null, String(value));
  }
  for (const currencyId of [undefined, null, '', 8]) {
    assert.equal(kpiMoneySummary({ ...input, rows: [{ value: 20, currencyId }] }).value, null);
  }
});

test('missing or ambiguous currency metadata cannot supply a monetary total', () => {
  const rows = [{ value: 100, currencyId: 1 }];
  for (const catalog of [[], [{ id: 1, code: 'EUR' }], [currencies[0]!, currencies[0]!], [{ id: 1, code: 'EUR', decimalPlaces: -1 }]]) {
    assert.equal(kpiMoneySummary({ ...input, currencies: catalog, rows }).value, null);
  }
});

test('every unavailable read status suppresses cached figures', () => {
  for (const status of ['loading', 'denied', 'error', 'partial'] as const) {
    for (const key of ['rowsState', 'currenciesState'] as const) {
      const result = kpiMoneySummary({ ...input, [key]: { status }, rows: [{ value: 100, currencyId: 1 }] });
      assert.equal(result.value, null);
      assert.equal(result.state.status, status);
    }
  }
});

test('scope excludes foreign companies and organizations and rejects missing scope projections', () => {
  const scope = { organizationId: 1n, companyId: 7n };
  const row = { organizationId: 1, companyId: 7, value: 10, currencyId: 1 };
  assert.equal(kpiMoneySummary({ ...input, scope, rows: [row, { ...row, companyId: 8, value: 999 }, { ...row, organizationId: 2, value: 999 }, { ...row, deletedAt: 1, value: 999 }] }).value, '€10.00');
  assert.equal(kpiMoneySummary({ ...input, scope, rows: [{ ...row, companyId: undefined }] }).value, null);
  assert.equal(kpiMoneySummary({ ...input, scope: { ...scope, companyId: 0n }, rows: [] }).value, null);
});

test('genuine zero, fractional amounts and empty collections remain distinguishable', () => {
  assert.equal(kpiMoneySummary({ ...input, rows: [{ value: 0, currencyId: 1 }] }).value, '€0.00');
  assert.equal(kpiMoneySummary({ ...input, rows: [{ value: 0.004, currencyId: 1 }, { value: 0.004, currencyId: 1 }] }).value, '€0.01');
  assert.equal(kpiMoneySummary({ ...input, rows: [] }).value, '—');
});
