import assert from 'node:assert/strict';
import test from 'node:test';

import { activeCategories, canArchiveCategory, canManageContactCategories } from './contact-category-actions';

test('a live contact can have its categories managed', () => {
  assert.equal(canManageContactCategories({ id: 1 }), true);
  assert.equal(canManageContactCategories({ deletedAt: null, mergeTargetId: { none: [] } }), true);
});

test('deleted or merged contacts cannot', () => {
  assert.equal(canManageContactCategories({ deletedAt: { some: 5n } }), false);
  assert.equal(canManageContactCategories({ merge_target_id: 7 }), false);
});

test('only active categories archive or are offered for replacement', () => {
  assert.equal(canArchiveCategory({ isActive: true }), true);
  assert.equal(canArchiveCategory({ isActive: false }), false);
  assert.equal(canArchiveCategory({ is_active: false }), false);
  assert.deepEqual(activeCategories([{ id: 1, isActive: true }, { id: 2, isActive: false }]).map((c) => c.id), [1]);
});
