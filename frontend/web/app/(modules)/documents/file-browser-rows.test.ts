import assert from 'node:assert/strict';
import test from 'node:test';

import { documentNameFromFile, toBrowserFiles, toBrowserFolders } from './file-browser-rows';

const labels = new Map([['aa11', 'Grace Hopper']]);

const documents = [
  { id: 1n, name: 'Budget', fileName: 'budget.xlsx', mimetype: 'application/octet-stream', fileSize: 2048n, folderId: 5n, writeUid: 'AA11', writeDate: { microsSinceUnixEpoch: 2_000_000_000n } },
  { id: 2n, name: '', fileName: 'scan.pdf', mimetype: 'application/pdf', fileSize: 1024n, folderId: 5n, writeDate: { microsSinceUnixEpoch: 3_000_000_000n } },
  { id: 3n, name: 'Loose', fileName: 'loose.txt', mimetype: 'text/plain', fileSize: 10n, isShared: true },
  { id: 4n, name: 'Gone', fileName: 'gone.txt', mimetype: 'text/plain', fileSize: 10n, folderId: 5n, isDeleted: true },
];

test('documents become browser files, without deleted ones', () => {
  const files = toBrowserFiles(documents, labels);
  assert.deepEqual(files.map((f) => f.id), ['1', '2', '3']);
  assert.equal(files[0]!.modifiedBy, 'Grace Hopper');
  assert.equal(files[1]!.name, 'scan.pdf');
  assert.equal(files[1]!.modifiedBy, '—');
  assert.equal(files[2]!.folderId, null);
  assert.equal(files[2]!.isShared, true);
  assert.equal(files[0]!.updatedAt, 2_000_000);
});

test('folders sum their files and skip hidden ones', () => {
  const files = toBrowserFiles(documents, labels);
  const folders = toBrowserFolders(
    [
      { id: 6n, name: 'Empty', sequence: 2 },
      { id: 5n, name: 'Finance', sequence: 1, writeDate: { microsSinceUnixEpoch: 1_000_000_000n } },
      { id: 7n, name: 'Hidden', isHidden: true },
    ],
    files,
  );
  assert.deepEqual(folders.map((f) => f.name), ['Finance', 'Empty']);
  assert.equal(folders[0]!.fileCount, 2);
  assert.equal(folders[0]!.totalSize, 3072);
  assert.equal(folders[0]!.updatedAt, 3_000_000);
  assert.equal(folders[1]!.updatedAt, null);
});

test('an uploaded file is named after its file name', () => {
  assert.equal(documentNameFromFile('Q3 report.final.pdf'), 'Q3 report.final');
  assert.equal(documentNameFromFile('.env'), '.env');
  assert.equal(documentNameFromFile('README'), 'README');
});
