import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateWarehouseParamsFromTemplate, buildFirstWarehouseParams } from './warehouse-create-params';

const template = {
  lotStockId: '9007199254740997', inTypeId: 1, outTypeId: 2, intTypeId: 3, packTypeId: 4, pickTypeId: 5,
  whInputStockLocId: '9007199254740999', resupplyWhIds: ['18446744073709551615'],
};
const options = { name: ' North ', code: ' NTH ', active: true, sequence: 1 };

test('warehouse template mapping preserves exact native IDs through the transport boundary', () => {
  const result = buildCreateWarehouseParamsFromTemplate(template, options);
  assert.equal(result.lotStockId, 9007199254740997n);
  assert.equal(result.whInputStockLocId, 9007199254740999n);
  assert.deepEqual(result.resupplyWhIds, [18446744073709551615n]);
  assert.equal(result.name, 'North');
  assert.equal(result.code, 'NTH');
});

test('invalid or unsafe template references reject rather than rounding or substituting zero', () => {
  for (const lotStockId of [0, -1, 1.5, Number('9007199254740997'), '18446744073709551616', 'bad']) {
    assert.throws(() => buildCreateWarehouseParamsFromTemplate({ ...template, lotStockId }, options));
  }
  assert.throws(() => buildCreateWarehouseParamsFromTemplate({ ...template, resupplyWhIds: ['bad'] }, options));
  assert.throws(() => buildCreateWarehouseParamsFromTemplate({ ...template, whInputStockLocId: 'bad' }, options));
});

test('first warehouse uses the native single-step preset and an actual internal location', () => {
  const result = buildFirstWarehouseParams('9007199254740997', options);
  assert.equal(result.lotStockId, 9007199254740997n);
  assert.deepEqual([result.inTypeId, result.outTypeId, result.intTypeId, result.packTypeId, result.pickTypeId], [1n, 1n, 1n, 1n, 1n]);
  assert.equal(result.active, true);
  assert.equal(result.receptionSteps, 'one_step');
  assert.equal(result.deliverySteps, 'ship_only');
  assert.equal(result.manufactureSteps, 'mrp_one_step');
  assert.throws(() => buildFirstWarehouseParams(0, options));
});
