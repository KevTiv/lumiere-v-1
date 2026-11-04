import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModuleDataState } from '@lumiere/ui/lib/module-data-state';
import { warehouseSetup } from './warehouse-setup';

const warehouse = {
  id: '9007199254740999', organizationId: '11', companyId: '22', active: true,
  lotStockId: '9007199254740997', inTypeId: 1, outTypeId: 2, intTypeId: 3, packTypeId: 4, pickTypeId: 5,
};
const location = { id: '9007199254740997', organizationId: '11', companyId: '22', active: true, usage: 'internal' };
const input = { organizationId: '11', companyId: '22', warehouses: [warehouse], locations: [location], warehouseState: { status: 'ready' } as ModuleDataState, locationState: { status: 'ready' } as ModuleDataState };

test('setup preserves the exact scoped template and stock-location identity', () => {
  const result = warehouseSetup(input);
  assert.equal(result.status, 'ready');
  assert.equal(result.templates[0], warehouse);
  assert.equal(warehouseSetup({ ...input, locations: [{ ...location, companyId: null }] }).status, 'ready');
  assert.equal(warehouseSetup({ ...input, locations: [{ ...location, companyId: undefined }] }).status, 'ready');
});

test('denied, stale, failed and loading reads cannot supply cached setup templates', () => {
  for (const status of ['denied', 'partial', 'error', 'loading'] as const) {
    const result = warehouseSetup({ ...input, warehouseState: { status } });
    assert.equal(result.status, status === 'loading' ? 'loading' : 'unavailable');
    assert.deepEqual(result.templates, []);
  }
  assert.equal(warehouseSetup({ ...input, locationState: { status: 'denied' } }).status, 'unavailable');
});

test('a company change, foreign template, inactive warehouse or missing operational reference cannot be reused', () => {
  for (const changed of [
    { ...warehouse, companyId: '23' }, { ...warehouse, organizationId: '12' },
    { ...warehouse, active: false }, { ...warehouse, lotStockId: '123' },
    { ...warehouse, outTypeId: 0 }, { ...warehouse, whInputStockLocId: '123' },
  ]) assert.equal(warehouseSetup({ ...input, warehouses: [changed] }).status, 'assisted-setup');
  assert.equal(warehouseSetup({ ...input, companyId: undefined }).status, 'company-required');
  assert.equal(warehouseSetup({ ...input, companyId: '23' }).status, 'locations-required');
});

test('masked location scope is unavailable for setup; explicit shared scope is allowed', () => {
  const { companyId: _companyId, ...maskedLocation } = location;
  assert.equal(warehouseSetup({ ...input, locations: [maskedLocation] }).status, 'unavailable');
  assert.equal(warehouseSetup({ ...input, warehouses: [{ ...warehouse, outTypeId: undefined }] }).status, 'unavailable');
  for (const changed of [{ ...location, active: false }, { ...location, usage: 'supplier' }]) {
    assert.equal(warehouseSetup({ ...input, locations: [changed] }).status, 'locations-required');
  }
  assert.equal(warehouseSetup({ ...input, warehouses: [] }).status, 'assisted-setup');
});
