import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceDocumentLines, invoiceRecordAmount, invoiceRecordCurrency, invoiceRecordLines, resolveInvoiceRecord } from './invoice-record';

test('unavailable financial fields remain unknown while actual zero is preserved', () => {
  for (const value of [undefined, null, '', ' ', NaN, Infinity, true, {}]) assert.equal(invoiceRecordAmount(value), null);
  assert.equal(invoiceRecordAmount(0), 0);
  assert.equal(invoiceRecordAmount('12.50'), 12.5);
  const [line] = invoiceDocumentLines([{ id: 1, excludeFromInvoiceTab: false, quantity: 2, priceUnit: 100 }]);
  assert.equal(line?.amount, null);
  assert.equal(line?.discount, null);
});

test('record and ledger lines resolve only the exact company and document, and duplicate records fail closed', () => {
  const rows = [{ id: 1, companyId: 7 }, { id: 1, companyId: 8 }];
  assert.equal(resolveInvoiceRecord(rows, '1', 7n), rows[0]);
  assert.equal(resolveInvoiceRecord(rows, '1', 9n), undefined);
  assert.equal(resolveInvoiceRecord([...rows, rows[0]!], '1', 7n), undefined);
  assert.deepEqual(invoiceRecordLines([
    { id: 10, moveId: 1, companyId: 7 }, { id: 11, moveId: 2, companyId: 7 },
    { id: 12, moveId: 1, companyId: 8 }, { id: 13, moveId: 1 },
  ], '1', 7n).map((row) => row.id), [10]);
});

test('paper projection excludes tax and ledger lines and preserves canonical subtotal and sequence', () => {
  const commercial = { excludeFromInvoiceTab: false, quantity: 3, priceUnit: 0.3333, discount: 0 };
  assert.deepEqual(invoiceDocumentLines([
    { ...commercial, id: 2, name: 'Second', sequence: 20, priceSubtotal: 1 },
    { ...commercial, id: 1, name: 'First', sequence: 10, priceSubtotal: 0.99 },
    { ...commercial, id: 3, excludeFromInvoiceTab: true },
    { ...commercial, id: 4, taxLineId: 3 },
    { ...commercial, id: 5, displayType: 'line_section' },
  ]).map(({ id, amount }) => ({ id, amount })), [{ id: '1', amount: 0.99 }, { id: '2', amount: 1 }]);
});

test('currency comes from the matching catalog row and never from another currency or ID convention', () => {
  assert.deepEqual(invoiceRecordCurrency({ currencyId: 7 }, [{ id: 1, code: 'USD' }, { id: 7, code: 'eur' }]), { id: '7', code: 'EUR' });
  assert.deepEqual(invoiceRecordCurrency({ currency_id: 7 }, [{ id: 1, code: 'USD' }]), { id: '7', code: undefined });
});


test('saved bill paper uses explicit commercial classification and keeps masked fields unavailable', () => {
  const saved = { id: 26, companyId: 1, moveId: 12, name: 'Vendor bill work', quantity: 2, priceUnit: 37.5 };
  // The former default query projection had no classification fields. Never infer them from price or account type.
  assert.deepEqual(invoiceDocumentLines([saved]), []);
  assert.deepEqual(invoiceDocumentLines([{ ...saved, excludeFromInvoiceTab: false, taxLineId: null, displayType: null, sequence: 10, discount: 0, priceSubtotal: 75 }]), [
    { id: '26', description: 'Vendor bill work', quantity: 2, unitPrice: 37.5, discount: 0, amount: 75 },
  ]);
  const [maskedAmounts] = invoiceDocumentLines([{ ...saved, excludeFromInvoiceTab: false, taxLineId: null, displayType: null }]);
  assert.equal(maskedAmounts?.amount, null);
  assert.equal(maskedAmounts?.discount, null);
});
