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
  assert.equal(folders[0]!.parentId, null);
  assert.equal(folders[0]!.totalSize, 3072);
  assert.equal(folders[0]!.updatedAt, 3_000_000);
  assert.equal(folders[1]!.updatedAt, null);
});

test('folder ancestry contains only actor-visible parents, including visible branches below hidden ancestors', () => {
  const folders = toBrowserFolders(
    [
      { id: 5n, name: 'Finance' },
      { id: 6n, name: 'Invoices', parentId: 5n },
      { id: 7n, name: 'Confidential', parentId: 5n, isHidden: true },
      { id: 8n, name: 'Shared child', parentId: 7n },
      { id: 9n, name: 'Other branch', parentId: 999n },
      { id: 10n, name: 'Self reference', parentId: 10n },
    ],
    [],
  );
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  assert.equal(byId.get('6')!.parentId, '5');
  assert.equal(byId.get('8')!.parentId, null);
  assert.equal(byId.get('9')!.parentId, null);
  assert.equal(byId.get('10')!.parentId, null);
  assert.equal(byId.has('7'), false);
  assert.doesNotMatch(JSON.stringify(folders), /Confidential|999/);
});

test('folder counts and size use only the actor-visible file projection', () => {
  const visibleFiles = toBrowserFiles([documents[0]!], labels);
  const rows = [{ id: 5n, name: 'Finance', documentCount: 100, parentId: null }];
  const [folder] = toBrowserFolders(rows, visibleFiles);
  assert.equal(folder!.fileCount, 1);
  assert.equal(folder!.totalSize, 2048);
  assert.equal(folder!.updatedAt, 2_000_000);
});

test('missing or invalid file sizes stay unavailable and do not become zero totals', () => {
  const files = toBrowserFiles([
    { ...documents[0]!, fileSize: null },
    { ...documents[1]!, fileSize: 'not-a-size' },
    { ...documents[2]!, fileSize: 0 },
  ], labels);
  assert.deepEqual(files.map((file) => file.size), [null, null, 0]);
  const [folder] = toBrowserFolders([{ id: 5n, name: 'Finance' }], files);
  assert.equal(folder!.totalSize, null);
  assert.equal(folder!.fileCount, 2);
});

test('an uploaded file is named after its file name', () => {
  assert.equal(documentNameFromFile('Q3 report.final.pdf'), 'Q3 report.final');
  assert.equal(documentNameFromFile('.env'), '.env');
  assert.equal(documentNameFromFile('README'), 'README');
});
