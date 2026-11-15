import assert from 'node:assert/strict';
import test from 'node:test';
import { stockReorderQueue } from '@lumiere/erp-shared/replenishment-stock';
import { stockQuantMoveInput } from './stock-quant-move-model';
import { buildWarehouse3DView } from '@lumiere/erp-shared/warehouse-3d-from-api';
import { completedTransferCounts, inventoryCategoryCounts, inventoryStockValue, stockCategoriesByProduct } from './inventory-dashboard-data';

const company = { organizationId: 7n, companyId: 3n };
const stock = (productId: number, locationId: number, availableQuantity: number | undefined) => ({
  ...company, productId, locationId, availableQuantity,
});
const rule = (productId: number, locationId: number, productMinQty: number) => ({
  ...company, productId, locationId, productMinQty, active: true,
});

test('reorder locations use the exact active company rule and aggregate the lots', () => {
  const result = stockReorderQueue([
    stock(1, 2, 2), stock(1, 2, 3), stock(1, 3, 6), stock(2, 2, 0), stock(3, 4, undefined),
    { ...stock(1, 2, 20), companyId: 4n },
  ], [
    rule(1, 2, 6), rule(1, 3, 6), rule(3, 4, 10), rule(4, 5, 2), rule(6, 7, 0),
    { ...rule(1, 3, 7), active: false },
    { ...rule(1, 3, 100), companyId: 4n },
  ], company);
  assert.equal(result.incomplete, 1);
  assert.deepEqual(result.entries.map(({ key, available, minimum, reason, rows }) =>
    [key, available, minimum, reason, rows.length]), [
    ['1:2', 5, 6, 'below-minimum', 2],
    ['2:2', 0, undefined, 'zero-stock', 1],
    ['4:5', 0, 2, 'zero-stock', 0],
  ]);
});

test('inventory values retain currency and refuse a partial or mixed-currency fiction', () => {
  const currencies = new Map([['1', 'USD'], ['2', 'RWF']]);
  assert.equal(inventoryStockValue([{ value: 18, currencyId: 1 }, { value: 5, currencyId: { some: 2 } }], currencies, 'RWF', 'en-US'), 'RWF\u00a05 · $18.00');
  assert.equal(inventoryStockValue([{ value: 9, currencyId: null }], currencies, 'RWF', 'en-US'), 'RWF\u00a09');
  assert.equal(inventoryStockValue([{ value: 9, currencyId: 44 }], currencies, 'RWF'), '—');
  assert.equal(inventoryStockValue([{ currencyId: 1 }], currencies, 'RWF'), '—');
});

test('stock positions group by the product category without summing unlike units', () => {
  const categories = stockCategoriesByProduct([{ id: 25, categ_id: 3 }, { id: 26, categId: 3 }], [{ id: 3, name: 'Grain' }]);
  assert.deepEqual(inventoryCategoryCounts([
    { productId: 25, costMethod: 'standard', availableQuantity: 100 },
    { productId: 26, costMethod: 'fifo' },
    { productId: 5 },
  ], categories, 'Unavailable'), [
    { label: 'Grain', value: 2 }, { label: 'Unavailable', value: 1 },
  ]);
});

test('movement chart applies the selected range and separates internal transfers', () => {
  const row = { state: 'Done', dateDone: '2026-02-01T12:00:00Z' };
  const result = completedTransferCounts([
    { ...row, pickingCode: 'incoming' },
    { ...row, pickingCode: 'outgoing' },
    { ...row, picking_code: 'internal' },
    { ...row, pickingCode: 'incoming', state: 'Draft' },
    { ...row, pickingCode: 'outgoing', dateDone: '2026-02-03T00:00:00Z' },
    { ...row, pickingCode: 'other' },
  ], { startMs: Date.parse('2026-02-01T00:00:00Z'), endMs: Date.parse('2026-02-03T00:00:00Z') });
  assert.deepEqual(result, [{ period: '2026-02-01', In: 1, Out: 1, Internal: 1 }]);
});

test('3D view displays scoped active warehouse zones and real location stock and categories', () => {
  const zones = [{ id: 2, warehouseId: 7, locationId: 20 }, { id: 3, warehouseId: 9, locationId: 21 }];
  const locations = [{ id: 20, name: 'East zone' }, { id: 21, name: 'West zone' }, { id: 22, locationId: 20, name: 'Rack one' }];
  const quants = [
    { id: 4, ...stock(1, 22, 2), quantity: 5 },
    { id: 5, ...stock(1, 21, 1), quantity: 1 },
  ];
  const products = new Map([['1', { name: 'Flour', sku: 'FL', category: 'Baking ingredients' }]]);
  const reorder = stockReorderQueue(quants, [rule(1, 22, 3)], company);
  const view = buildWarehouse3DView(7n, zones, locations, quants, products, reorder.entries);
  assert.equal(view.zones.length, 1);
  assert.deepEqual(view.slots.map((slot) => slot.locationId), ['22']);
  assert.deepEqual(view.items.map((item) => [
    item.id, item.category, item.quantity, item.availableQuantity, item.lowStock, item.minStock, item.lastUpdated,
  ]), [
    ['4', 'Baking ingredients', 5, 2, true, 3, undefined],
  ]);
});

test('3D Move submits a validated real destination and chosen quantity', () => {
  const quant = { id: 12, locationId: 2, availableQuantity: 6.5 };
  const target = { id: 3, active: true, usage: 'internal' };
  assert.deepEqual(stockQuantMoveInput(quant, target, 2.75), {
    quantId: '12', targetLocationId: '3', quantity: 2.75,
  });
  assert.equal(stockQuantMoveInput(quant, undefined, 2), undefined);
  assert.equal(stockQuantMoveInput(quant, { ...target, id: 2 }, 2), undefined);
  assert.equal(stockQuantMoveInput(quant, { ...target, active: false }, 2), undefined);
  assert.equal(stockQuantMoveInput(quant, { ...target, usage: 'customer' }, 2), undefined);
  assert.equal(stockQuantMoveInput(quant, target, 0), undefined);
  assert.equal(stockQuantMoveInput(quant, target, 7), undefined);
  assert.equal(stockQuantMoveInput({ ...quant, availableQuantity: undefined }, target, 2), undefined);
});
