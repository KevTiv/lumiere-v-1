import assert from 'node:assert/strict'
import test from 'node:test'

import { positiveInteger } from './positive-integer'

test('positiveInteger accepts exact positive safe IDs', () => {
  assert.equal(positiveInteger(1), 1)
  assert.equal(positiveInteger(' 42 '), 42)
  assert.equal(positiveInteger(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER)
})

test('positiveInteger rejects absent, negative, fractional, junk, and unsafe IDs', () => {
  for (const value of [undefined, null, '', '   ', -1, '-1', 0, '0', 1.5, '1.5', '12suffix', Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
    assert.ok(Number.isNaN(positiveInteger(value)), `expected rejection for ${String(value)}`)
  }
})

test('HTTP IDs do not inherit form grouping or Option coercion', () => {
  for (const value of ['1 2', '1,2', '1_2', { some: '12' }, true, 12n]) {
    assert.ok(Number.isNaN(positiveInteger(value)))
  }
})
