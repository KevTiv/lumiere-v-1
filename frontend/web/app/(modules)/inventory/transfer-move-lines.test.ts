import assert from 'node:assert/strict';
import test from 'node:test';

import { detailedOperationRows, moveLinesForTransfer } from './transfer-move-lines';

test('move lines belong to a transfer by picking or by one of its moves', () => {
  const lines = [
    { id: 1n, pickingId: 4n },
    { id: 2n, picking_id: 9n, moveId: 70n },
    { id: 3n, moveId: 71n },
    { id: 4n, picking_id: 9n },
  ];
  const picked = moveLinesForTransfer('4', lines, new Set(['71']));
  assert.deepEqual(picked.map((l) => String(l.id)), ['1', '3']);
});

const lookups = {
  productNameById: new Map([['5', 'Widget']]),
  locationNameById: new Map([['1', 'WH/Stock']]),
  lotNameById: new Map([['8', 'LOT-8']]),
};

test('operation rows resolve names and never fall back to raw ids', () => {
  const rows = detailedOperationRows(
    [
      { id: 1n, productId: 5n, lotId: 8n, locationId: 1n, locationDestId: 2n, locationDestIdName: 'Customers', qtyDone: 3, reservedUomQty: 4 },
      { id: 2n, product_id: 99n, location_id: 77n, quantityDone: 1, reserved_qty: 2 },
    ],
    lookups,
  );
  assert.deepEqual(rows[0], {
    id: '1',
    product: 'Widget',
    lot: 'LOT-8',
    fromLocation: 'WH/Stock',
    toLocation: 'Customers',
    quantityDone: 3,
    quantityReserved: 4,
  });
  assert.deepEqual(rows[1], {
    id: '2',
    product: null,
    lot: null,
    fromLocation: null,
    toLocation: null,
    quantityDone: 1,
    quantityReserved: 2,
  });
});
