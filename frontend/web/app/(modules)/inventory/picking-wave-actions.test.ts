import assert from 'node:assert/strict';
import test from 'node:test';

import { canReleaseWave } from './picking-wave-actions';

test('a wave releases while open and holding pickings', () => {
  assert.equal(canReleaseWave({ state: 'draft', pickingIds: [1n] }), true);
  assert.equal(canReleaseWave({ state: { tag: 'in_progress' }, picking_ids: [1] }), true);
  assert.equal(canReleaseWave({ state: 'draft' }), true);
});

test('done, cancelled, empty or stateless waves do not release', () => {
  assert.equal(canReleaseWave({ state: 'done', pickingIds: [1] }), false);
  assert.equal(canReleaseWave({ state: 'cancelled', pickingIds: [1] }), false);
  assert.equal(canReleaseWave({ state: 'draft', pickingIds: [] }), false);
  assert.equal(canReleaseWave({}), false);
});
