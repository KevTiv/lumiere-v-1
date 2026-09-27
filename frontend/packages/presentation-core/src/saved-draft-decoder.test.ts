import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSavedDraft, decodeSavedDraftList } from './saved-draft-decoder';

const revision = '18446744073709551615';
const saved = {
  moduleKey: 'personal', revision, definitionHash: 'a'.repeat(64),
  definition: { schemaVersion: 1, componentCatalogVersion: 1, applicationContract: 'pin',
    moduleId: 'personal', title: 'Personal', baseRevision: revision, pages: [] },
};

test('saved snapshot preserves full integer revision precision and input', () => {
  assert.deepEqual(decodeSavedDraft(saved), saved);
});

test('saved snapshot rejects inconsistent envelope and definition metadata', () => {
  for (const change of [{ revision: '01' }, { revision: '18446744073709551616' },
    { revision: '2' }, { moduleKey: 'other' }, { definitionHash: 'invalid' }, { ownerIdentity: 'forged' }]) {
    assert.throws(() => decodeSavedDraft({ ...saved, ...change }));
  }
});

test('saved list rejects duplicate heads, excessive rows and malformed revisions', () => {
  const head = { moduleKey: 'personal', title: 'Personal', revision };
  assert.deepEqual(decodeSavedDraftList({ drafts: [head] }).drafts, [head]);
  assert.throws(() => decodeSavedDraftList({ drafts: [head, head] }));
  assert.throws(() => decodeSavedDraftList({ drafts: [{ ...head, revision: '0' }] }));
  assert.throws(() => decodeSavedDraftList({ drafts: Array.from({ length: 101 }, (_, i) => ({ ...head, moduleKey: `module-${i}` })) }));
});
