import assert from 'node:assert/strict';
import test from 'node:test';
import { billLineCorrectionParams, billLineCorrectionSource } from './bill-line-correction';
const bill = { id: 3, state: 'Draft', moveType: { tag: 'InInvoice' }, postedBefore: false, companyId: 1, currencyId: 2, companyCurrencyId: 2, amountTax: 0, invoiceOrigin: 'PO7' };
const line = { id: 4, moveId: 3, companyId: 1, productId: 5, quantity: 3, priceUnit: 10 };
const order = { id: 7, companyId: 1, invoiceIds: [3] };
const source = { id: 8, companyId: 1, orderId: 7, productId: 5, invoiceLines: [4], priceUnit: 10 };
test('correction uses the exact bill/PO/line relations, including repeated products', () => {
  assert.equal(billLineCorrectionSource(bill, line, [order], [{ ...source, id: 9, invoiceLines: [99] }, source]), source);
  assert.equal(billLineCorrectionSource(bill, line, [order], [{ ...source, invoiceLines: [] }]), undefined);
  assert.equal(billLineCorrectionSource(bill, line, [order], [source, { ...source, id: 9 }]), undefined);
});
test('posted, malformed, foreign-company and manual bills are unavailable', () => {
  for (const change of [{ state: 'Posted' }, { postedBefore: true }, { postedBefore: undefined }, { amountTax: NaN }, { amountTax: -1 }, { companyCurrencyId: undefined }, { companyId: 9 }, { invoiceOrigin: 'PO Box 7' }]) assert.equal(billLineCorrectionSource({ ...bill, ...change }, line, [order], [source]), undefined);
});
test('reviewed price and quantity travel with the correction without debit/credit guesses', () => {
  assert.deepEqual(billLineCorrectionParams(line, { quantity: '2', priceUnit: '11' }, 1n), { companyId: 1n, quantity: 2, priceUnit: 11, expectedQuantity: 3, expectedPriceUnit: 10 });
});
test('invalid, empty and overflowing economic values are rejected', () => {
  for (const quantity of ['', ' ', null, undefined, NaN, Infinity, -1, 0]) assert.throws(() => billLineCorrectionParams(line, { quantity, priceUnit: 10 }, 1n));
  for (const priceUnit of ['', null, NaN, Infinity, -1]) assert.throws(() => billLineCorrectionParams(line, { quantity: 3, priceUnit }, 1n));
  assert.throws(() => billLineCorrectionParams(line, { quantity: 1e308, priceUnit: 1e308 }, 1n));
});

test('taxed, discounted and foreign-currency drafts retain the exact correction source', () => {
  assert.equal(billLineCorrectionSource({ ...bill, amountTax: 6, currencyId: 9 }, { ...line, discount: 10 }, [order], [source]), source);
  assert.deepEqual(billLineCorrectionParams({ ...line, discount: 10 }, { quantity: 2, priceUnit: 11 }, 1n), { companyId: 1n, quantity: 2, priceUnit: 11, expectedQuantity: 3, expectedPriceUnit: 10 });
});
