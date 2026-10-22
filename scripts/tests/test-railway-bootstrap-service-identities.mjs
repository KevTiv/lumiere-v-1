import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bootstrapServiceIdentities,
  reviewedMailSelected,
} from '../railway-bootstrap-service-identities.mjs'

const ownerIdentity = '1'.repeat(64)
const reviewedIdentity = '2'.repeat(64)
const base = {
  STDB_HOST: 'http://spacetimedb.railway.internal:3000',
  STDB_MODULE: 'fixture-module',
  STDB_SERVER_TOKEN: 'synthetic-owner-credential',
  LUMIERE_REVIEWED_MAIL_STDB_TOKEN: 'synthetic-reviewed-credential',
}

function database({ organizations = [101, 202], mismatch = false, missing = false, reused = false, bindingCount = 1 } = {}) {
  const calls = []
  const bindings = new Map(organizations.map(id => [id,
    missing ? [] : [{ identity: { __identity__: `0x${mismatch ? '3'.repeat(64) : reviewedIdentity}` }, is_active: true }],
  ]))
  const fetchFn = async (url, options) => {
    const path = new URL(url).pathname
    const token = options.headers.Authorization?.replace(/^Bearer /, '')
    calls.push({ path, body: options.body })
    assert.equal(path, '/v1/database/fixture-module/sql', 'verification must never mint or mutate')
    let rows
    if (options.body.includes('FROM cold_tier_service_identity')) {
      assert.equal(token, base.STDB_SERVER_TOKEN)
      const org = Number(/organization_id = ([0-9]+)/.exec(options.body)[1])
      if (options.body.includes('SELECT service_name, identity')) {
        assert.match(options.body, /LIMIT 257$/)
        rows = Array.from({ length: bindingCount }, (_, index) => ({
          service_name: reused ? 'workflow_worker' : 'reviewed_mail_dispatcher',
          identity: { __identity__: `0x${reviewedIdentity}` },
        }))
      } else {
        assert.match(options.body, /service_name = 'reviewed_mail_dispatcher'/)
        rows = bindings.get(org)
      }
    } else {
      rows = organizations.map(id => ({ id }))
    }
    const names = rows.length ? Object.keys(rows[0]) : []
    return new Response(JSON.stringify([{
      schema: { elements: names.map(name => ({ name: { some: name } })) },
      rows: rows.map(row => names.map(name => row[name])),
    }]), {
      status: 200,
      headers: { 'spacetime-identity': `0x${token === base.STDB_SERVER_TOKEN ? ownerIdentity : reviewedIdentity}` },
    })
  }
  return { calls, fetchFn }
}

test('reviewed mail is optional until selected or its credential is configured', () => {
  assert.equal(reviewedMailSelected({}), false)
  assert.equal(reviewedMailSelected({ RAILWAY_ENABLE_REVIEWED_MAIL: 'false' }), false)
  assert.equal(reviewedMailSelected({ RAILWAY_ENABLE_REVIEWED_MAIL: 'true' }), true)
  assert.equal(reviewedMailSelected(base), true)
  assert.throws(() => reviewedMailSelected({ RAILWAY_ENABLE_REVIEWED_MAIL: 'yes' }), /true or false/)
})

test('read-only verification checks every actual organization without exposing credentials', async () => {
  const db = database()
  const output = []
  await bootstrapServiceIdentities({ env: base, fetchFn: db.fetchFn, log: value => output.push(value), verifyReviewedMail: true })
  assert.equal(db.calls.filter(call => call.body.includes("service_name = 'reviewed_mail_dispatcher'")).length, 2)
  assert.equal(db.calls.filter(call => call.body.includes('SELECT service_name, identity')).length, 2)
  assert.deepEqual(output, ['REVIEWED_MAIL_VERIFIED organizations=2'])
  assert.ok(!output.join('\n').includes(base.LUMIERE_REVIEWED_MAIL_STDB_TOKEN))
})

test('a missing organization binding fails without registering or minting', async () => {
  const db = database({ missing: true })
  await assert.rejects(bootstrapServiceIdentities({ env: base, fetchFn: db.fetchFn, verifyReviewedMail: true }), /active reviewed_mail_dispatcher binding missing or different/)
})

test('a different registered identity fails without replacing its binding', async () => {
  const db = database({ mismatch: true })
  await assert.rejects(bootstrapServiceIdentities({ env: base, fetchFn: db.fetchFn, verifyReviewedMail: true }), /operator review required/)
})

test('selected reviewed-mail credential must exist before any network operation', async () => {
  let calls = 0
  const env = { ...base, RAILWAY_ENABLE_REVIEWED_MAIL: 'true', LUMIERE_REVIEWED_MAIL_STDB_TOKEN: '' }
  await assert.rejects(bootstrapServiceIdentities({ env, fetchFn: async () => { calls += 1 } }), /missing LUMIERE_REVIEWED_MAIL_STDB_TOKEN/)
  assert.equal(calls, 0)
})

test('owner token reuse fails before any network operation', async () => {
  let calls = 0
  const env = { ...base, LUMIERE_REVIEWED_MAIL_STDB_TOKEN: base.STDB_SERVER_TOKEN }
  await assert.rejects(bootstrapServiceIdentities({ env, fetchFn: async () => { calls += 1 }, verifyReviewedMail: true }), /must differ/)
  assert.equal(calls, 0)
})

test('different tokens resolving to the owner identity still fail closed', async () => {
  const db = database()
  const fetchFn = async (...args) => {
    const response = await db.fetchFn(...args)
    response.headers.set('spacetime-identity', ownerIdentity)
    return response
  }
  await assert.rejects(bootstrapServiceIdentities({ env: base, fetchFn, verifyReviewedMail: true }), /distinct from one another and owner/)
})

test('an empty database cannot establish readiness for an organization binding', async () => {
  const db = database({ organizations: [] })
  await assert.rejects(bootstrapServiceIdentities({ env: base, fetchFn: db.fetchFn, verifyReviewedMail: true }), /requires an existing organization/)
})

test('reviewed identity reused by another active service fails without mutation or mint', async () => {
  const db = database({ reused: true })
  await assert.rejects(bootstrapServiceIdentities({ env: base, fetchFn: db.fetchFn, verifyReviewedMail: true }), /shared with another active service/)
  assert.ok(db.calls.every(call => call.path.endsWith('/sql')))
})

test('bounded active binding scan fails closed at its result limit', async () => {
  const db = database({ bindingCount: 257 })
  await assert.rejects(bootstrapServiceIdentities({ env: base, fetchFn: db.fetchFn, verifyReviewedMail: true }), /verification limit exceeded/)
  assert.ok(db.calls.every(call => call.path.endsWith('/sql')))
})

test('network and response decoding errors never expose provider or credential details', async () => {
  const sensitive = 'synthetic-sensitive-response-credential'
  let failure
  try {
    await bootstrapServiceIdentities({ env: base, fetchFn: async () => { throw new Error(sensitive) }, verifyReviewedMail: true })
  } catch (error) { failure = error }
  assert.match(failure.message, /failed before a response/)
  assert.ok(!failure.message.includes(sensitive))
  await assert.rejects(bootstrapServiceIdentities({ env: base, fetchFn: async () => new Response(sensitive, {
    headers: { 'spacetime-identity': ownerIdentity },
  }), verifyReviewedMail: true }), error => error.message === 'bootstrap response contained invalid JSON')
})

function provisioningDatabase({ reviewedMismatch = false } = {}) {
  const calls = []
  const env = {
    ...base,
    LUMIERE_BOOTSTRAP_PUBLIC_KEY: 'synthetic-public-key-unused-by-seal-fixture',
    STDB_FINALIZATION_TOKEN: 'synthetic-finalization',
    STDB_OWNER_REPORT_WORKER_TOKEN: 'synthetic-owner-report',
    STDB_WORKFLOW_WORKER_TOKEN: 'synthetic-workflow',
  }
  const serviceTokens = new Map([
    ['projection_worker', env.STDB_FINALIZATION_TOKEN],
    ['pos_order_hydrator', env.STDB_FINALIZATION_TOKEN],
    ['owner_report_worker', env.STDB_OWNER_REPORT_WORKER_TOKEN],
    ['workflow_worker', env.STDB_WORKFLOW_WORKER_TOKEN],
    ['expense_integration_worker', 'synthetic-expense'],
    ['hr_integration_worker', 'synthetic-hr'],
    ['project_integration_worker', 'synthetic-project'],
  ])
  const tokens = [...new Set(serviceTokens.values())]
  const identity = token => token === base.STDB_SERVER_TOKEN ? ownerIdentity
    : token === base.LUMIERE_REVIEWED_MAIL_STDB_TOKEN ? reviewedIdentity
      : String(tokens.indexOf(token) + 3).repeat(64)
  const bindings = new Map([101, 202].map(org => [org, new Map([
    ...[...serviceTokens].map(([service, token]) => [service, identity(token)]),
    ...(reviewedMismatch ? [['reviewed_mail_dispatcher', 'f'.repeat(64)]] : []),
  ])]))
  let minted = 0
  const fetchFn = async (url, options) => {
    const path = new URL(url).pathname
    calls.push({ path, body: options.body })
    if (path === '/v1/identity') {
      return Response.json({ token: ['synthetic-expense', 'synthetic-hr', 'synthetic-project'][minted++] })
    }
    if (path.endsWith('/call/register_cold_tier_service_identity')) {
      const [org, , service, bound] = JSON.parse(options.body)
      assert.equal(service, 'reviewed_mail_dispatcher')
      bindings.get(org).set(service, bound.__identity__.replace(/^0x/, ''))
      return new Response(null, { status: 200 })
    }
    assert.ok(path.endsWith('/sql'))
    const token = options.headers.Authorization.replace(/^Bearer /, '')
    let rows = [{ id: 101 }, { id: 202 }]
    if (options.body.includes('FROM cold_tier_service_identity')) {
      const org = Number(/organization_id = ([0-9]+)/.exec(options.body)[1])
      if (options.body.startsWith('SELECT service_name')) {
        rows = [...bindings.get(org)].map(([service_name, bound]) => ({ service_name, identity: `0x${bound}` }))
      } else {
        const service = /service_name = '([^']+)'/.exec(options.body)[1]
        const bound = bindings.get(org).get(service)
        rows = bound ? [{ identity: `0x${bound}`, is_active: true }] : []
      }
    }
    const names = rows.length ? Object.keys(rows[0]) : []
    return new Response(JSON.stringify([{
      schema: { elements: names.map(name => ({ name: { some: name } })) },
      rows: rows.map(row => names.map(name => row[name])),
    }]), { headers: { 'spacetime-identity': identity(token) } })
  }
  return { env, fetchFn, calls }
}

test('provisioning binds the supplied reviewed identity per real org and verifies each result', async () => {
  const db = provisioningDatabase()
  const output = []
  let payload
  await bootstrapServiceIdentities({ ...db, log: value => output.push(value), sealEnvelope: value => {
    payload = value
    return { syntheticEnvelope: true }
  } })
  const writes = db.calls.filter(call => call.path.endsWith('/call/register_cold_tier_service_identity'))
  assert.deepEqual(writes.map(call => JSON.parse(call.body)[0]), [101, 202])
  assert.equal(payload.tokens.LUMIERE_REVIEWED_MAIL_STDB_TOKEN, undefined)
  assert.deepEqual(Object.keys(payload.tokens), ['STDB_EXPENSE_WORKER_TOKEN', 'STDB_HR_WORKER_TOKEN', 'STDB_PROJECT_WORKER_TOKEN'])
  assert.ok(output.every(line => !line.includes('credential') && !line.includes('synthetic-expense')))
  assert.equal(db.calls.filter(call => call.path === '/v1/identity').length, 3, 'reviewed credential is never minted')
})

test('provisioning refuses to replace a different existing reviewed identity', async () => {
  const db = provisioningDatabase({ reviewedMismatch: true })
  await assert.rejects(bootstrapServiceIdentities({ ...db, sealEnvelope: () => { throw new Error('unreachable') } }), /operator review required/)
  assert.equal(db.calls.filter(call => call.path.includes('/call/')).length, 0)
})
