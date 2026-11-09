import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configurePlatform, platformClient, templateParams } from '../configure-ai-platform.mjs'

const profile = model => ({ provider: 'mistral', model, maxTokens: 1000, contextWindow: 32000,
  timeoutMs: 30000, maxConcurrency: 1, inputUnitsPer1k: 10, outputUnitsPer1k: 20 })
const manifest = () => ({ templateKey: 'alpha', templateVersion: 1, generation: profile('fixture-generation'),
  review: profile('fixture-review'), skillIds: [1, 2, 3], currency: 'USD', monthlyLimitUnits: 1_000_000,
  rateLimitPerMinute: 10, maxEnrolledOrganizations: 5 })
function fixture() {
  let registered = false
  let active = null
  const calls = []
  const client = {
    async call(name, args) {
      calls.push({ name, args })
      if (name === 'register_ai_platform_template') registered = true
      else if (name === 'set_ai_platform_default') active = args[0]
      else throw new Error('unexpected mutation')
    },
    async sql(statement) {
      if (statement.includes('FROM ai_platform_template')) return registered ? [{ id: 7, ...templateParams(manifest()) }] : []
      if (statement.includes('FROM ai_platform_default')) return [{ template_id: active }]
      throw new Error('unexpected query')
    },
  }
  return { client, calls }
}
test('platform template is tenant independent and contains bounded approved policy', () => {
  const params = templateParams(manifest())
  assert.equal(params.monthly_limit_units, 1_000_000)
  assert.equal(params.max_enrolled_organizations, 5)
  assert.deepEqual(params.generation_profile.allowed_roles, ['decision', 'reasoning', 'generation'])
  assert.equal(Object.keys(params).some(key => /organization|company|agent/.test(key) && key !== 'max_enrolled_organizations'), false)
})
test('register does not activate; activate verifies and is repeatable', async () => {
  const { client, calls } = fixture()
  assert.deepEqual(await configurePlatform(manifest(), client), { registered: false, active: false, billableCalls: 0 })
  assert.deepEqual(calls, [])
  assert.equal((await configurePlatform(manifest(), client, '--register')).active, false)
  assert.deepEqual(calls.map(call => call.name), ['register_ai_platform_template'])
  assert.equal((await configurePlatform(manifest(), client, '--activate')).active, true)
  assert.equal((await configurePlatform(manifest(), client, '--activate')).active, true)
  assert.deepEqual(calls.at(-1), { name: 'set_ai_platform_default', args: [{ some: 7 }] })
  assert.equal(calls.filter(call => call.name === 'register_ai_platform_template').length, 1)
})
test('unknown registration outcome prevents activation and is never retried', async () => {
  const { client, calls } = fixture()
  client.call = async (name, args) => { calls.push({ name, args }); throw new Error('ambiguous outcome') }
  await assert.rejects(configurePlatform(manifest(), client, '--activate'), /ambiguous outcome/)
  assert.equal(calls.length, 1)
})
test('missing registration readback and activation readback fail closed', async () => {
  const { client, calls } = fixture()
  client.sql = async () => []
  await assert.rejects(configurePlatform(manifest(), client, '--activate'), /registration is unconfirmed/)
  assert.equal(calls.length, 1)
  const second = fixture()
  const sql = second.client.sql
  second.client.sql = async statement => statement.includes('FROM ai_platform_default') ? [] : sql(statement)
  await assert.rejects(configurePlatform(manifest(), second.client, '--activate'), /activation is unconfirmed/)
})
test('invalid limits, duplicate skills, credentials, injections and rolling models are rejected', () => {
  for (const change of [
    { apiKey: 'secret' }, { templateKey: "x' OR true" }, { templateVersion: 0 },
    { monthlyLimitUnits: 0 }, { maxEnrolledOrganizations: -1 }, { skillIds: [1, 1, 3] },
    { generation: profile('mistral-latest') }, { review: profile('fixture-generation') },
    { generation: { ...profile('fixture'), apiKey: 'secret' } },
    { review: { ...profile('fixture-review'), provider: 'gemini' } },
  ]) assert.throws(() => templateParams({ ...manifest(), ...change }))
})
test('transport protects credentials and never exposes upstream response bodies', async () => {
  const calls = []
  const env = { STDB_HOST: 'http://127.0.0.1:3000', STDB_MODULE: 'fixture', STDB_SERVER_TOKEN: 'private-token' }
  const client = platformClient(env, async (url, init) => {
    calls.push({ url, init })
    return new Response('private-upstream-detail', { status: 403 })
  })
  await assert.rejects(client.call('register_ai_platform_template', [{}]), error => error.message === 'platform setup failed: HTTP 403')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls.length, 1)
  assert.throws(() => platformClient({ ...env, STDB_HOST: 'http://external.example' }), /HTTPS/)
  assert.throws(() => platformClient({ ...env, STDB_HOST: 'https://user:secret@example.com' }), /origin/)
})


test('check rejects immutable content drift without writes', async () => {
  const { client, calls } = fixture()
  client.sql = async () => [{ id: 7, ...templateParams(manifest()), monthly_limit_units: 999 }]
  await assert.rejects(configurePlatform(manifest(), client), /differs at monthly_limit_units/)
  assert.deepEqual(calls, [])
})

test('check verifies nested SQL tuple profile and SATS option encodings', async () => {
  const expected = templateParams(manifest())
  const wireProfile = profile => Object.values(profile).map(value => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('some' in value) return [0, value.some]
      if ('none' in value) return [1, []]
    }
    return value
  })
  const client = {
    async call() { throw new Error('read-only check must not write') },
    async sql(statement) {
      if (statement.includes('FROM ai_platform_template')) return [{ id: 7, ...expected,
        generation_profile: wireProfile(expected.generation_profile), review_profile: wireProfile(expected.review_profile) }]
      return [{ template_id: [0, 7] }]
    },
  }
  assert.deepEqual(await configurePlatform(manifest(), client), { templateId: 7, registered: true, active: true, billableCalls: 0 })
})
