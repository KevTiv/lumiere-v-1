import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePreviewOptions, decodePreviewResponse } from './preview-decoder';

test('options reject unexpected authority fields and malformed field lists', () => {
  assert.deepEqual(decodePreviewOptions({ applicationContract: 'pin', fields: ['id'] }).fields, ['id']);
  assert.throws(() => decodePreviewOptions({ applicationContract: 'pin', fields: ['id'], organizationId: 1 }));
  assert.throws(() => decodePreviewOptions({ applicationContract: 'pin', fields: [7] }));
});

test('response preserves decimal ids and rejects malformed display values', () => {
  const response = {
    definition: { schemaVersion: 1, applicationContract: 'pin', componentCatalogVersion: 1, moduleId: 'sample', title: 'Sample', pages: [] },
    collections: [{ pageId: 'entries', nodeId: 'entries', truncated: false,
      rows: [{ id: '18446744073709551615', fields: [{ field: 'name', value: 'Entry' }] }] }],
  };
  assert.equal(decodePreviewResponse(response).collections[0].rows[0].id, '18446744073709551615');
  assert.throws(() => decodePreviewResponse({ ...response, executable: 'code' }));
  response.collections[0].rows[0].fields[0].value = 7 as never;
  assert.throws(() => decodePreviewResponse(response));
});
