import assert from 'node:assert/strict';
import test from 'node:test';

import { canConfirmPackage, canDonePackage } from './stock-package-actions';

test('a draft package with moves confirms', () => {
  assert.equal(canConfirmPackage({ state: 'draft', moveIds: [1n] }), true);
  assert.equal(canConfirmPackage({ state: { tag: 'draft' }, move_ids: [1] }), true);
  assert.equal(canConfirmPackage({ state: 'draft' }), true);
});

test('an empty, non-draft or stateless package does not confirm', () => {
  assert.equal(canConfirmPackage({ state: 'draft', moveIds: [] }), false);
  assert.equal(canConfirmPackage({ state: 'confirmed', moveIds: [1] }), false);
  assert.equal(canConfirmPackage({ state: 'done', moveIds: [1] }), false);
  assert.equal(canConfirmPackage({}), false);
});

test('only a confirmed package completes', () => {
  assert.equal(canDonePackage({ state: 'confirmed' }), true);
  assert.equal(canDonePackage({ state: { tag: 'confirmed' } }), true);
  assert.equal(canDonePackage({ state: 'draft' }), false);
  assert.equal(canDonePackage({ state: 'done' }), false);
  assert.equal(canDonePackage({}), false);
});
