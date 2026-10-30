import assert from 'node:assert/strict'
import test from 'node:test'
import { requireIsolatedCi } from '../run-guide-lifecycle.mjs'

const fixture = { CI: 'true', GITHUB_ACTIONS: 'true', STDB_HOST: 'http://127.0.0.1:3000',
  STDB_MODULE: 'lumiere-v1-local-e2e', LUMIERE_API_SERVER_URL: 'http://127.0.0.1:8082',
  PG_HOST: '127.0.0.1', PG_DATABASE: 'lumiere', GITHUB_SHA: 'a'.repeat(40) }

test('real-service lifecycle admits only its hosted loopback fixture', () => {
  assert.doesNotThrow(() => requireIsolatedCi(fixture))
  for (const [key, value] of Object.entries({ CI: 'false', GITHUB_ACTIONS: '',
    STDB_HOST: 'https://maincloud.spacetimedb.com', STDB_MODULE: 'production',
    LUMIERE_API_SERVER_URL: 'https://api.example.com', PG_HOST: 'postgres.example.com',
    PG_DATABASE: 'production', GITHUB_SHA: 'main' })) {
    assert.throws(() => requireIsolatedCi({ ...fixture, [key]: value }), { name: 'AssertionError' }, key)
  }
})
