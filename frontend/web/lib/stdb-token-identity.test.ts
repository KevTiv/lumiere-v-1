import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeIdentityHexFromStdbToken } from './stdb-token-identity'

function token(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

test('uses the canonical hex_identity claim before a UUID subject', () => {
  const identity = 'ab'.repeat(32)

  assert.equal(
    decodeIdentityHexFromStdbToken(
      token({ sub: 'e30fab27-2296-469d-bc7a-dbcb24b4b56e', hex_identity: identity }),
    ),
    identity,
  )
})

test('rejects non-identity subject claims', () => {
  assert.equal(
    decodeIdentityHexFromStdbToken(token({ sub: 'e30fab27-2296-469d-bc7a-dbcb24b4b56e' })),
    undefined,
  )
})

test('accepts legacy canonical identity claims', () => {
  const identity = 'CD'.repeat(32)

  assert.equal(
    decodeIdentityHexFromStdbToken(token({ identity: `0x${identity}` })),
    identity.toLowerCase(),
  )
})
