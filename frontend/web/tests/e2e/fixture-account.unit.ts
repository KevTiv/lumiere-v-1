import assert from 'node:assert/strict'
import test from 'node:test'
import type { APIRequestContext } from '@playwright/test'
import { bootstrapFixtureAccountSession } from './fixture-account'

test('trusted fixtures bootstrap internally then sign in without forwarding the service credential', async () => {
  const previousToken = process.env.STDB_SERVER_TOKEN
  const previousBase = process.env.LUMIERE_API_SERVER_URL
  const originalFetch = globalThis.fetch
  process.env.STDB_SERVER_TOKEN = 'test-service-owner'
  process.env.LUMIERE_API_SERVER_URL = 'http://api.internal'
  const identity = 'a'.repeat(64)
  const requests: Array<{ url: string; headers: Headers }> = []
  let signedIn = false
  try {
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) })
      assert.equal(init?.redirect, 'error')
      assert.deepEqual(JSON.parse(init!.body as string), { email: 'actor@example.test', password: 'Password123$' })
      return Response.json({ identity, token: 'internal-database-token' })
    }
    const context = {
      post: async (path: string, options: { data: unknown; headers?: unknown }) => {
        assert.equal(path, '/api/auth/signin')
        assert.equal(options.headers, undefined)
        assert.deepEqual(options.data, { email: 'actor@example.test', password: 'Password123$' })
        signedIn = true
        return { ok: () => true }
      },
      storageState: async () => ({ cookies: [{ name: 'stdb_identity', value: identity }] }),
    } as unknown as APIRequestContext
    assert.equal(await bootstrapFixtureAccountSession(context, 'actor@example.test', 'Password123$'), identity)
    assert.ok(signedIn)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'http://api.internal/v1/auth/internal/bootstrap-credential')
    assert.equal(requests[0].headers.get('authorization'), 'Bearer test-service-owner')
    await assert.rejects(bootstrapFixtureAccountSession(context, 'actor@real-company.com', 'Password123$'), /reserved .test/)
    assert.equal(requests.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (previousToken === undefined) delete process.env.STDB_SERVER_TOKEN
    else process.env.STDB_SERVER_TOKEN = previousToken
    if (previousBase === undefined) delete process.env.LUMIERE_API_SERVER_URL
    else process.env.LUMIERE_API_SERVER_URL = previousBase
  }
})
