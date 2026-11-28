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
    assert.equal(result.status, status === 'loading' || status === 'denied' ? status : 'unavailable');
    assert.deepEqual(result.templates, []);
  }
  assert.equal(warehouseSetup({ ...input, locationState: { status: 'denied' } }).status, 'denied');
});

test('first setup requires a real internal location and never copies another company', () => {
  for (const changed of [
    { ...warehouse, companyId: '23' }, { ...warehouse, organizationId: '12' }, { ...warehouse, active: false },
  ]) {
    const result = warehouseSetup({ ...input, warehouses: [changed] });
    assert.equal(result.status, 'first-warehouse');
    assert.deepEqual(result.stockLocations, [location]);
    assert.deepEqual(result.templates, []);
  }
  for (const changed of [
    { ...warehouse, lotStockId: '123' }, { ...warehouse, outTypeId: 'bad' }, { ...warehouse, whInputStockLocId: '123' },
  ]) assert.equal(warehouseSetup({ ...input, warehouses: [changed] }).status, 'assisted-setup');
  assert.equal(warehouseSetup({ ...input, companyId: undefined }).status, 'company-required');
  assert.equal(warehouseSetup({ ...input, companyId: '23' }).status, 'locations-required');
});

test('a saved warehouse using unassigned operation codes reads back and still needs a customer destination', () => {
  const unassigned = { ...warehouse, inTypeId: 0, outTypeId: 0, intTypeId: 0, packTypeId: 0, pickTypeId: 0 };
  const result = warehouseSetup({ ...input, warehouses: [unassigned] });
  assert.equal(result.status, 'ready');
  assert.equal(result.needsCustomerLocation, true);
  const customer = { ...location, id: '99', usage: 'customer' };
  assert.equal(warehouseSetup({ ...input, locations: [location, customer] }).needsCustomerLocation, false);
  assert.equal(warehouseSetup({ ...input, locations: [location, { ...customer, companyId: '23' }] }).needsCustomerLocation, true);
});

test('masked location scope is unavailable for setup; explicit shared scope is allowed', () => {
  const { companyId: _companyId, ...maskedLocation } = location;
  assert.equal(warehouseSetup({ ...input, locations: [maskedLocation] }).status, 'unavailable');
  assert.equal(warehouseSetup({ ...input, warehouses: [{ ...warehouse, outTypeId: undefined }] }).status, 'unavailable');
  for (const changed of [{ ...location, active: false }, { ...location, usage: 'supplier' }]) {
    assert.equal(warehouseSetup({ ...input, locations: [changed] }).status, 'locations-required');
  }
  assert.equal(warehouseSetup({ ...input, warehouses: [] }).status, 'first-warehouse');
});
