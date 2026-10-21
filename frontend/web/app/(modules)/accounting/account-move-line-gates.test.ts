import assert from 'node:assert/strict';
import test from 'node:test';

import { accountMoveLineCanBeDeleted } from './account-move-line-gates';

const moves = [
  { id: 1n, state: { tag: 'Draft' } },
  { id: 2n, state: { tag: 'Posted' } },
];

test('a move line can be deleted only while its move is a draft', () => {
  assert.equal(accountMoveLineCanBeDeleted({ moveId: 1 }, moves), true);
  assert.equal(accountMoveLineCanBeDeleted({ move_id: '2' }, moves), false);
});

test('a line whose move is not loaded is left to the server', () => {
  assert.equal(accountMoveLineCanBeDeleted({ moveId: 9 }, moves), true);
  assert.equal(accountMoveLineCanBeDeleted({}, moves), true);
});
