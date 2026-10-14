import assert from 'node:assert/strict'
import test from 'node:test'
import { canInspectDemo } from './demo-access-policy.ts'

test('demo diagnostics require the explicitly configured tenant and an admin role', () => {
  assert.equal(canInspectDemo('1', 1, 'owner'), true)
  assert.equal(canInspectDemo('1', 1, 'ADMIN'), true)
  for (const args of [[undefined, 1, 'owner'], ['0', 1, 'owner'], ['bad', 1, 'owner'],
    ['1', 2, 'owner'], ['1', 1, 'member'], ['1', undefined, undefined]]) {
    assert.equal(canInspectDemo(...args), false)
  }
})
