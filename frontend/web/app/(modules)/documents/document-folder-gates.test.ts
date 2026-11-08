import assert from 'node:assert/strict';
import test from 'node:test';

import { documentFolderCanBeDeleted, documentFolderDestinations } from './document-folder-gates';

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

test('move destinations exclude descendants, cycles and unavailable ancestry', () => {
  const rows = [
    { id: 1n, name: 'Parent', parentId: null },
    { id: 2n, name: 'Child', parentId: 1n },
    { id: 3n, name: 'Grandchild', parentId: 2n },
    { id: 4n, name: 'Other', parentId: null },
    { id: 5n, name: 'Unavailable parent', parentId: 99n },
    { id: 6n, name: 'Cycle', parentId: 7n },
    { id: 7n, name: 'Cycle', parentId: 6n },
  ];
  assert.deepEqual(documentFolderDestinations(rows, '1'), [{ value: '4', label: 'Other' }]);
  assert.deepEqual(documentFolderDestinations(rows, '2').map((row) => row.value), ['1', '4']);
});
