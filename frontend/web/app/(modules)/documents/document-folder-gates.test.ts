import assert from 'node:assert/strict';
import test from 'node:test';

import { documentFolderCanBeDeleted } from './document-folder-gates';

const folders = [
  { id: 1n, documentCount: 0 },
  { id: 2n, documentCount: 3 },
  { id: 3n, documentCount: 0, parentId: 1n },
  { id: 4n, document_count: 0, parent_id: null },
];

test('only an empty folder without children can be deleted', () => {
  assert.equal(documentFolderCanBeDeleted(folders[2]!, folders), true);
  assert.equal(documentFolderCanBeDeleted(folders[3]!, folders), true);
  assert.equal(documentFolderCanBeDeleted(folders[1]!, folders), false);
  assert.equal(documentFolderCanBeDeleted(folders[0]!, folders), false);
});
