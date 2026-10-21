import assert from 'node:assert/strict';
import test from 'node:test';

import { activeLegalHold, externalRefRows, rowsForDocument, signatureRequestRows, signerCount, documentRecordHref, formatFileSize, linkedRecordHref } from './document-record';

test('a document links to its own page by id', () => {
  assert.equal(documentRecordHref({ id: 7 }), '/documents/7');
  assert.equal(documentRecordHref({}), undefined);
});

test('a document attached to a record with a page links to that page', () => {
  assert.equal(linkedRecordHref({ resModel: 'sale_order', resId: 3 }), '/sales/orders/3');
  assert.equal(linkedRecordHref({ resModel: 'account_move', resId: 9 }), '/accounting/invoices/9');
  assert.equal(linkedRecordHref({ res_model: 'stock_picking', res_id: 4 }), '/inventory/transfers/4');
});

test('no link for a record without a page, or no record', () => {
  assert.equal(linkedRecordHref({ resModel: 'product', resId: 3 }), undefined);
  assert.equal(linkedRecordHref({ resModel: 'sale_order' }), undefined);
  assert.equal(linkedRecordHref({}), undefined);
});

test('file sizes read in the largest fitting unit', () => {
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatFileSize(20 * 1024 * 1024), '20 MB');
  assert.equal(formatFileSize('x'), '—');
});

import { legalHoldReason, moveDocumentParams } from './document-record';

test('a folder move needs a chosen folder', () => {
  assert.deepEqual(moveDocumentParams(' 4 '), { folderId: '4' });
  assert.equal(moveDocumentParams(''), null);
  assert.equal(moveDocumentParams(undefined), null);
});

test('a legal hold needs a reason', () => {
  assert.equal(legalHoldReason('  litigation '), 'litigation');
  assert.equal(legalHoldReason('   '), null);
});

test('the active legal hold is the active row of that document only', () => {
  const holds = [
    { id: 1, documentId: 5, isActive: false },
    { id: 2, documentId: 6, isActive: true },
    { id: 3, documentId: 5, isActive: true },
  ];
  assert.equal(activeLegalHold(holds, '5')?.id, 3);
  assert.equal(activeLegalHold(holds.slice(0, 1), 5), undefined);
  assert.equal(activeLegalHold([], 5), undefined);
});

test('signer count never exposes signer details', () => {
  assert.equal(signerCount('[{"email":"a@x.com"},{"email":"b@x.com"}]'), 2);
  assert.equal(signerCount(null), 0);
  assert.equal(signerCount('not json'), 0);
  const [row] = signatureRequestRows([{ id: 1, status: 'pending', signers_json: '[{"email":"a@x.com"}]', requested_at: 5 }]);
  assert.deepEqual(Object.keys(row).sort(), ['completedAt', 'id', 'provider', 'requestedAt', 'signerCount', 'status']);
  assert.equal(row.signerCount, 1);
  assert.equal(row.requestedAt, 5);
});

test('rows are scoped to one document, newest first, with tolerant keys', () => {
  const rows = [{ id: 1, document_id: 5 }, { id: 2, documentId: 6 }, { id: 3, documentId: 5 }];
  assert.deepEqual(rowsForDocument(rows, '5').map((r) => r.id), [3, 1]);
  assert.equal(externalRefRows([{ id: 1, external_id: 'abc' }])[0].externalId, 'abc');
});
