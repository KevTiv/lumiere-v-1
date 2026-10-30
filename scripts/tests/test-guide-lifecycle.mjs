import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { guideRoleUpdateParams, requireIsolatedCi } from '../run-guide-lifecycle.mjs'

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

test('ordinary guide access fixture supplies every native SATS role field', async () => {
  const native = await readFile(new URL('../../spacetimedb/src/core/permissions.rs', import.meta.url), 'utf8')
  const params = native.match(/pub struct UpdateRoleParams\s*\{([^}]+)\}/)?.[1]
  assert.ok(params, 'The authoritative native role wire schema must be available')
  const fields = [...params.matchAll(/pub\s+(\w+)\s*:/g)].map((match) => match[1])
  assert.ok(fields.length > 0, 'Native role fields must be resolved')
  const permissions = ['organization:read', 'knowledge_article:*']
  const fixtureParams = guideRoleUpdateParams(permissions)
  assert.deepEqual(Object.keys(fixtureParams).sort(), fields.sort(),
    'SATS requires explicit fields even when the native field is optional')
  for (const [, name, type] of params.matchAll(/pub\s+(\w+)\s*:\s*([^\n]+),/g)) {
    if (type.startsWith('Option<')) {
      const value = fixtureParams[name]
      assert.ok(value && typeof value === 'object' && Object.keys(value).length === 1 &&
        ('some' in value || Array.isArray(value.none)), `${name} must retain generated SATS option encoding`)
    }
  }
  assert.deepEqual(fixtureParams.permissions, { some: permissions })
  assert.deepEqual(fixtureParams.metadata, { none: [] })
})
