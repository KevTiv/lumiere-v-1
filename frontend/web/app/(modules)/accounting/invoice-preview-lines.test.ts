import assert from 'node:assert/strict';
import test from 'node:test';

import type { AccountMoveLineQueryRow } from '@lumiere/stdb/resource-reads';

import { invoicePreviewLines } from './invoice-preview-lines';

const row = (fields: Partial<AccountMoveLineQueryRow>) =>
  ({ id: 1n, organizationId: 1n, moveId: 5n, sequence: 10, quantity: 1, priceUnit: 10, discount: 0, ...fields }) as AccountMoveLineQueryRow;

test('only this move\'s commercial lines, in sequence order', () => {
  const lines = invoicePreviewLines(
    [
      row({ id: 1n, name: 'B', sequence: 20, priceSubtotal: 40, quantity: 4 }),
      row({ id: 2n, name: 'A', sequence: 10, priceSubtotal: 10 }),
      row({ id: 3n, name: 'VAT', displayType: 'tax' }),
      row({ id: 4n, name: 'Receivable', displayType: 'payment_term' }),
      row({ id: 5n, name: 'Other move', moveId: 6n }),
      row({ id: 6n, name: 'Untyped tax', taxLineId: 9n }),
    ],
    '5',
  );
  assert.deepEqual(lines.map((line) => line.description), ['A', 'B']);
  assert.equal(lines[1]!.total, 40);
});
