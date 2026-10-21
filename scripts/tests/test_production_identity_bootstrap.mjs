import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bootstrapProductionIdentities,
  buildServiceSecrets,
  createDopplerClient,
  decodeSqlRows,
  normalizeIdentity,
  parseConfigMap,
} from '../lib/production-identity-bootstrap.mjs'

const identity = (digit) => digit.repeat(64)

test('normalizes SpacetimeDB identity encodings', () => {
  assert.equal(normalizeIdentity(`0x${identity('a')}`), identity('a'))
  assert.equal(normalizeIdentity({ __identity__: identity('b') }), identity('b'))
  assert.equal(normalizeIdentity('not-an-identity'), '')
})

test('decodes SpacetimeDB SQL rows', () => {
  assert.deepEqual(
    decodeSqlRows([
      {
        schema: { elements: [{ name: { some: 'id' } }, { name: { some: 'label' } }] },
        rows: [[1, [0, 'Acme']]],
      },
    ]),
    [{ id: 1, label: 'Acme' }],
  )
})

test('rejects malformed Doppler config maps', () => {
  assert.throws(() => parseConfigMap('[]'), /must be an object/u)
  assert.throws(() => parseConfigMap('{'), /must be valid JSON/u)
  assert.deepEqual([...parseConfigMap('{"api-server":"prd_api"}')], [['api-server', 'prd_api']])
})

test('partitions credentials by service without leaking unrelated worker tokens', () => {
  const targets = [
    { secretName: 'STDB_FINALIZATION_TOKEN', services: ['projection-worker'], bindings: [] },
    { secretName: 'STDB_WORKFLOW_WORKER_TOKEN', services: ['workflow-worker'], bindings: [] },
  ]
  const issued = new Map([
    ['STDB_FINALIZATION_TOKEN', { token: 'projection-token' }],
    ['STDB_WORKFLOW_WORKER_TOKEN', { token: 'workflow-token' }],
  ])
  const result = buildServiceSecrets({
    issued,
    targets,
    adminToken: 'owner-token',
    runtimeHash: `sha256:${identity('c')}`,
    bootstrapSecrets: {},
  })
  assert.deepEqual(result.get('projection-worker'), {
    STDB_FINALIZATION_TOKEN: 'projection-token',
    STDB_SERVER_TOKEN: 'owner-token',
  })
  assert.deepEqual(result.get('workflow-worker'), {
    STDB_WORKFLOW_WORKER_TOKEN: 'workflow-token',
    STDB_SERVER_TOKEN: 'owner-token',
  })
  assert.equal(result.get('projection-worker').STDB_WORKFLOW_WORKER_TOKEN, undefined)
})

const baseEnv = {
  STDB_HOST: 'http://spacetimedb.railway.internal:3000',
  STDB_MODULE: 'lumiere-v1',
  STDB_SERVER_TOKEN: 'owner-token',
  DOPPLER_API_TOKEN: 'doppler-token',
  DOPPLER_PROJECT: 'lumiere-v1',
  DOPPLER_CONFIG_MAP_JSON: '{"projection-worker":"prd_projection"}',
  AI_CERTIFICATION_RUNTIME_HASH: `sha256:${identity('d')}`,
  LUMIERE_IDENTITY_RUN_ID: 'release-2026-10-14',
}

test('dry-run returns a redacted plan without calling remote systems', async () => {
  let called = false
  const plan = await bootstrapProductionIdentities({
    env: baseEnv,
    fetchImpl: async () => {
      called = true
      throw new Error('unexpected request')
    },
  })
  assert.equal(called, false)
  assert.deepEqual(plan.tokenNames, ['STDB_FINALIZATION_TOKEN'])
  assert.equal(plan.initializeNonRotatingSecrets, false)
  assert.equal(JSON.stringify(plan).includes('owner-token'), false)
  assert.equal(JSON.stringify(plan).includes('doppler-token'), false)
})

test('rotation refuses to proceed without an explicit worker-drain acknowledgement', async () => {
  await assert.rejects(
    bootstrapProductionIdentities({ env: baseEnv, mode: 'rotate', apply: true }),
    /LUMIERE_ROTATION_DRAINED=1/u,
  )
})

test('Doppler failures do not echo provider response bodies that may contain secrets', async () => {
  const doppler = createDopplerClient({
    apiToken: 'write-token',
    project: 'lumiere-v1',
    fetchImpl: async () => new Response('rejected value super-secret-token', { status: 400 }),
  })
  await assert.rejects(
    doppler.writeSecrets('prd_api', { STDB_SERVER_TOKEN: 'super-secret-token' }),
    (error) => error.message === 'request failed (400)',
  )
})

test('apply mints, validates, stores, and registers a service identity without logging values', async () => {
  const calls = []
  const logs = []
  const sqlResult = (name, rows) => JSON.stringify([{
    schema: { elements: [{ name: { some: name } }] },
    rows: rows.map((value) => [value]),
  }])
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/v1/identity')) {
      return new Response(JSON.stringify({ token: 'new-projection-token' }), { status: 200 })
    }
    if (String(url).includes('api.doppler.com')) return new Response('{}', { status: 200 })
    if (String(url).includes('/call/register_cold_tier_service_identity')) {
      return new Response('', { status: 200 })
    }
    if (init.body === 'SELECT id FROM organization LIMIT 1') {
      const bearer = init.headers.Authorization
      const probeIdentity = bearer === 'Bearer owner-token' ? identity('1') : identity('2')
      return new Response(sqlResult('id', [1]), {
        status: 200,
        headers: { 'spacetime-identity': probeIdentity },
      })
    }
    if (init.body === 'SELECT id FROM organization') {
      return new Response(sqlResult('id', [7]), {
        status: 200,
        headers: { 'spacetime-identity': identity('1') },
      })
    }
    throw new Error(`unexpected request ${url}`)
  }

  const result = await bootstrapProductionIdentities({
    env: baseEnv,
    fetchImpl,
    logger: { info: (message) => logs.push(message) },
    apply: true,
  })

  assert.equal(result.organizationCount, 1)
  assert.equal(calls.filter(({ url }) => url.endsWith('/v1/identity')).length, 1)
  assert.equal(calls.filter(({ url }) => url.includes('/call/register_cold_tier_service_identity')).length, 2)
  const dopplerCall = calls.find(({ url }) => url.includes('api.doppler.com'))
  assert.deepEqual(JSON.parse(dopplerCall.init.body), {
    secrets: {
      STDB_FINALIZATION_TOKEN: 'new-projection-token',
      STDB_SERVER_TOKEN: 'owner-token',
    },
  })
  assert.equal(logs.join('\n').includes('new-projection-token'), false)
  assert.equal(logs.join('\n').includes('owner-token'), false)
})
