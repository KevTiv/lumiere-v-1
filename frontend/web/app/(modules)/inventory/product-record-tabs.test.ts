import assert from 'node:assert/strict';
import test from 'node:test';

import {
  packagingOptionLabel,
  packagingsForProduct,
  variantLinesForTemplate,
  vendorPriceOptionLabel,
  vendorPricesForTemplate,
} from './product-record-tabs';

const attributes = [
  { id: 1n, name: 'Color', sequence: 2 },
  { id: 2n, name: 'Size', sequence: 1 },
];
const values = [
  { id: 10n, name: 'Red' },
  { id: 11n, name: 'Blue' },
  { id: 20n, name: 'L' },
];

test('variant lines list value names per attribute for one template, in attribute order', () => {
  const lines = [
    { id: 1n, productTmplId: 5n, attributeId: 1n, valueIds: [10n, 11n], active: true },
    { id: 2n, product_tmpl_id: 5n, attribute_id: 2n, value_ids: [20n], active: true },
    { id: 3n, productTmplId: 6n, attributeId: 1n, valueIds: [10n], active: true },
    { id: 4n, productTmplId: 5n, attributeId: 1n, valueIds: [10n], active: false },
  ];
  const rows = variantLinesForTemplate(5n, lines, attributes, values);
  assert.deepEqual(rows, [
    { id: '2', attribute: 'Size', values: 'L', valueCount: 1 },
    { id: '1', attribute: 'Color', values: 'Red, Blue', valueCount: 2 },
  ]);
});

test('unknown attributes and values are left empty, never shown as ids', () => {
  const rows = variantLinesForTemplate(5n, [{ id: 1n, productTmplId: 5n, attributeId: 99n, valueIds: [98n] }], attributes, values);
  assert.deepEqual(rows, [{ id: '1', attribute: null, values: null, valueCount: 0 }]);
  assert.deepEqual(variantLinesForTemplate(undefined, [], attributes, values), []);
});

test('vendor prices resolve vendor and currency names and drop unknown ones', () => {
  const infos = [
    { id: 1n, productTmplId: 5n, partnerId: 7n, minQty: 10, price: 4.5, currencyId: 3n, delay: 2, sequence: 2, isActive: true },
    { id: 2n, product_tmpl_id: 5n, partner_id: 8n, min_qty: 1, price: 5, currency_id: 9n, sequence: 1, is_active: true },
    { id: 3n, productTmplId: 6n, partnerId: 7n, price: 1 },
    { id: 4n, productTmplId: 5n, partnerId: 7n, price: 1, isActive: false },
  ];
  const rows = vendorPricesForTemplate(5n, infos, new Map([['7', 'Acme']]), new Map([['3', 'EUR']]));
  assert.deepEqual(
    rows.map((r) => [r.id, r.vendor, r.minQty, r.price, r.currency, r.delay]),
    [
      ['2', null, 1, 5, null, null],
      ['1', 'Acme', 10, 4.5, 'EUR', 2],
    ],
  );
});

test('packagings are those of the product, by sequence', () => {
  const rows = packagingsForProduct(5n, [
    { id: 1n, productId: 5n, name: 'Box', qty: 12, sequence: 2, barcode: '123', sales: true },
    { id: 2n, product_id: 5n, name: 'Pallet', qty: 480, sequence: 1, barcode: '' },
    { id: 3n, productId: 6n, name: 'Other', qty: 1 },
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.qty, r.barcode, r.sales]), [
    ['2', 'Pallet', 480, null, false],
    ['1', 'Box', 12, '123', true],
  ]);
});

test('picker labels drop absent parts', () => {
  assert.equal(
    vendorPriceOptionLabel({ partnerId: 7n, minQty: 10, price: 4.5, productTmplId: 5n }, new Map([['7', 'Acme']]), new Map([['5', 'Widget']])),
    'Widget · Acme · min 10 · @ 4.5',
  );
  assert.equal(vendorPriceOptionLabel({ partnerId: 7n }, new Map()), '');
  assert.equal(packagingOptionLabel({ name: 'Box', qty: 12, productId: 5n }, new Map([['5', 'Widget']])), 'Box · x12 · Widget');
});
