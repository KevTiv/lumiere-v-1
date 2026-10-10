import assert from 'node:assert/strict';
import test from 'node:test';

import { transferStatusBar } from './transfer-status';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);
const stateOf = (state: string) => ({ state: { tag: state } });

test('stages run draft, waiting, ready, done', () => {
  const bar = transferStatusBar(stateOf('Draft'), t);

  assert.deepEqual(bar.steps.map((s) => s.id), ['draft', 'confirmed', 'assigned', 'done']);
  assert.equal(bar.current, 'draft');
});

test('confirmed and waiting transfers share the waiting stage', () => {
  assert.equal(transferStatusBar(stateOf('Confirmed'), t).current, 'confirmed');
  assert.equal(transferStatusBar(stateOf('Waiting'), t).current, 'confirmed');
});

test('ready and done transfers are on their own stages', () => {
  assert.equal(transferStatusBar(stateOf('Assigned'), t).current, 'assigned');
  assert.equal(transferStatusBar(stateOf('Done'), t).current, 'done');
});

test('a cancelled transfer is outside the flow', () => {
  const bar = transferStatusBar(stateOf('Cancelled'), t);

  assert.equal(bar.current, '');
  assert.equal(bar.terminal?.label, 'Cancelled');
});
