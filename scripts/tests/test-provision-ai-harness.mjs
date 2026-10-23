import assert from 'node:assert/strict'
import { test } from 'node:test'
import { httpClient, policyFor, profilesFor, provision, smokePilot, unwrap, validateManifest, verifyMistralCatalog } from '../provision-ai-harness.mjs'

const manifest = () => ({
  version: 1, organizationId: 9, companyId: 3, agentName: 'mistral-pilot',
  policyKey: 'mistral-pilot', policyVersion: 1, currency: 'USD', monthlyLimitUnits: 1_000_000,
  priceReviewedAt: '2026-10-23',
  // Synthetic rates, deliberately unrelated to any provider price list.
  primary: { model: 'fixture-primary', maxTokens: 1024, contextWindow: 32000, timeoutMs: 1000,
    maxConcurrency: 1, inputUnitsPer1k: 100, outputUnitsPer1k: 200 },
  review: { model: 'fixture-review', maxTokens: 1024, contextWindow: 32000, timeoutMs: 1000,
    maxConcurrency: 1, inputUnitsPer1k: 300, outputUnitsPer1k: 400 },
})

function fixture() {
  const tables = { profiles: [], policies: [], agents: [], configs: [], prices: [], budgets: [], calibration: [] }
  const writes = []
  const client = {
    async verifyTarget(org) { assert.equal(org, 9) },
    async sql(sql, role) {
      if (sql.includes('FROM company ')) return [{ id: 3, organization_id: 9 }]
      if (sql.includes('FROM ai_skill ')) return [{ id: 8, organization_id: 0, is_active: true }]
      if (sql.includes('FROM ai_skill_release ')) return [{ id: 5, skill_version_id: 6 }]
      if (sql.includes('FROM ai_model_profile ')) return tables.profiles.filter(row => sql.includes(`'${row.profile_key}'`))
      if (sql.includes('FROM ai_intelligence_policy ')) return tables.policies
      if (sql.includes('FROM ai_agent ')) return tables.agents
      if (sql.includes('FROM ai_skill_config ')) return tables.configs
      if (sql.includes('FROM ai_spend_price_snapshot_read ')) {
        assert.equal(role, 'spend')
        return tables.prices.filter(row => sql.includes(`'${row.model}'`))
      }
      if (sql.includes('FROM ai_spend_budget_read ')) { assert.equal(role, 'spend'); return tables.budgets }
      if (sql.includes('FROM ai_calibration_profile ')) return tables.calibration
      throw new Error(`unexpected query: ${sql}`)
    },
    async call(name, args) {
      writes.push(name)
      if (name === 'create_ai_agent') tables.agents.push({ ...args[2], company_id: args[1], id: 12 })
      else if (name === 'register_ai_model_profile') {
        if (!tables.profiles.some(row => row.profile_key === args[1].profile_key)) tables.profiles.push({ ...args[1], is_active: true })
      } else if (name === 'register_ai_intelligence_policy') {
        if (!tables.policies.length) tables.policies.push({ ...args[1], is_active: true })
      } else if (name === 'configure_ai_spend') {
        const params = args[2]
        tables.prices.push({ ...params, version: tables.prices.length + 1 })
        if (!tables.budgets.length) tables.budgets.push({ ...params, settled_units: 77, outstanding_units: 23 })
      } else if (name === 'upsert_ai_skill_config') tables.configs.splice(0, 1, { ...args[1] })
      else throw new Error(`unexpected reducer ${name}`)
    },
    async bootstrap(body) {
      writes.push('bootstrap')
      assert.deepEqual(body, { orgId: 9, intelligencePolicyRef: 'mistral-pilot@1' })
      tables.calibration = [{ id: 1 }]
    },
  }
  return { tables, writes, client }
}

test('check reports missing prerequisites without making writes', async () => {
  const { client, writes } = fixture()
  const result = await provision(manifest(), client)
  assert.equal(result.readyForKey, false)
  assert.ok(result.missing.includes('current-period spend budget'))
  assert.ok(result.missing.includes('governed bootstrap'))
  assert.deepEqual(writes, [])
})

test('apply is idempotent, preserves counters and scoped settings, and verifies read-back', async () => {
  const { client, tables, writes } = fixture()
  tables.configs.push({ company_id: { some: 3 }, is_enabled: true, config_json: '{"max_output_rows":25}',
    tool_overrides: ['existing-reviewed-override'], custom_instructions: { some: 'preserve this' }, metadata: { none: [] } })
  const first = await provision(manifest(), client, true)
  assert.equal(first.applied, true)
  assert.equal(first.readyForKey, true)
  assert.equal(first.agentId, 12)
  const state = structuredClone(tables)
  writes.length = 0
  assert.equal((await provision(manifest(), client, true)).readyForKey, true)
  assert.deepEqual(tables, state)
  assert.ok(!writes.includes('create_ai_agent'))
  assert.ok(!writes.includes('configure_ai_spend'))
  assert.equal(tables.budgets[0].settled_units, 77)
  assert.equal(tables.budgets[0].outstanding_units, 23)
  assert.equal(JSON.parse(tables.configs[0].config_json).max_output_rows, 25)
  assert.deepEqual(tables.configs[0].tool_overrides, ['existing-reviewed-override'])
})

test('wrong company, immutable drift, disabled skill and unregistered reader fail before writes', async () => {
  for (const kind of ['company', 'profile', 'policy', 'disabled', 'reader', 'release', 'price', 'budget']) {
    const { client, tables, writes } = fixture()
    if (kind === 'company') { const base = client.sql; client.sql = async (...args) => args[0].includes('FROM company ') ? [{ id: 3, organization_id: 10 }] : base(...args) }
    if (kind === 'profile') tables.profiles.push({ ...profilesFor(manifest())[0], model: 'different', is_active: true })
    if (kind === 'policy') tables.policies.push({ ...policyFor(manifest()), default_review_profile: 'unreviewed@1', is_active: true })
    if (kind === 'disabled') tables.configs.push({ company_id: [0, 3], is_enabled: false, config_json: '{}' })
    if (kind === 'reader') client.verifyTarget = async () => { throw new Error('reader not registered') }
    if (kind === 'release') { const base = client.sql; client.sql = async (...args) => args[0].includes('FROM ai_skill_release ') ? [] : base(...args) }
    if (kind === 'price' || kind === 'budget') {
      await provision(manifest(), client, true)
      writes.length = 0
      if (kind === 'price') tables.prices[0].input_units_per_1k = 999
      else tables.budgets[0].limit_units = 999
    }
    await assert.rejects(provision(manifest(), client, true), undefined, kind)
    assert.deepEqual(writes, [], kind)
  }
})

test('ambiguous create is not retried or followed by another mutation', async () => {
  const { client, writes } = fixture()
  client.call = async name => { writes.push(name); throw new Error('response lost') }
  await assert.rejects(provision(manifest(), client, true), /response lost/)
  assert.deepEqual(writes, ['create_ai_agent'])
})

test('manifest rejects secrets, SQL injection, unsafe amounts and non-independent review', () => {
  const bad = [
    { ...manifest(), apiKey: 'never-in-manifest' }, { ...manifest(), organizationId: 0 },
    { ...manifest(), agentName: "x' OR true" }, { ...manifest(), monthlyLimitUnits: 1.5 },
    { ...manifest(), primary: { ...manifest().primary, timeoutMs: 0 } },
    { ...manifest(), review: { ...manifest().review, model: manifest().primary.model } },
  ]
  for (const config of bad) assert.throws(() => validateManifest(config))
  assert.equal(unwrap([0, 42]), 42)
  assert.equal(unwrap([1, []]), null)
  assert.equal(unwrap({ some: 42 }), 42)
})

test('HTTP transport routes private spend reads correctly and never follows redirects or leaks bodies', async () => {
  const requests = []
  const env = { STDB_HOST: 'http://127.0.0.1:3000', STDB_MODULE: 'fixture', STDB_SERVER_TOKEN: 'owner-secret',
    AI_SPEND_READ_STDB_TOKEN: 'reader-secret', STDB_TOKEN: 'gateway-secret', AI_GATEWAY_URL: 'http://127.0.0.1:8090',
    LUMIERE_AI_GATEWAY_INTERNAL_SECRET: 'internal-secret' }
  const client = httpClient(env, async (url, init) => {
    requests.push({ url, ...init })
    if (url.endsWith('/sql')) return Response.json([{ schema: { elements: [{ name: { some: 'id' } }] }, rows: [[42]] }])
    return new Response('private-token-in-error-body', { status: 403 })
  })
  assert.deepEqual(await client.sql('SELECT id FROM ai_spend_budget_read', 'spend'), [{ id: 42 }])
  assert.equal(requests[0].headers.Authorization, 'Bearer reader-secret')
  assert.equal(requests[0].redirect, 'error')
  await assert.rejects(client.call('create_ai_agent', []), error => error.message === 'provisioning request failed: HTTP 403')
  assert.throws(() => httpClient({ ...env, AI_SPEND_READ_STDB_TOKEN: env.STDB_SERVER_TOKEN }), /dedicated/)
  assert.throws(() => httpClient({ ...env, STDB_HOST: 'http://untrusted.example' }), /HTTPS/)
})

test('catalog verification requires account-visible tool support and sufficient context without generation', async () => {
  const config = manifest()
  const catalog = { data: [config.primary, config.review].map(profile => ({
    id: profile.model, max_context_length: 32000,
    capabilities: { completion_chat: true, function_calling: true },
  })) }
  const requests = []
  const fetcher = async (url, options) => { requests.push({ url, options }); return Response.json(catalog) }
  assert.deepEqual(await verifyMistralCatalog(config, 'private-key', fetcher), { catalogVerified: true, billableCalls: 0 })
  assert.equal(requests[0].url, 'https://api.mistral.ai/v1/models')
  assert.equal(requests[0].options.body, undefined)
  assert.equal(requests[0].options.redirect, 'error')
  await assert.rejects(verifyMistralCatalog(config, '', fetcher), /missing MISTRAL_API_KEY/)
  catalog.data[1].capabilities.function_calling = false
  await assert.rejects(verifyMistralCatalog(config, 'key', fetcher), /function calling/)
  catalog.data[1].capabilities.function_calling = true
  catalog.data[1].max_context_length = 1000
  await assert.rejects(verifyMistralCatalog(config, 'key', fetcher), /context/)
})

test('BFF smoke requires durable matching settlement, never retries and redacts content', async () => {
  const { client } = fixture()
  const config = manifest()
  await provision(config, client, true)
  const sql = client.sql
  let state = 'settled'
  client.sql = async (statement, role) => {
    if (statement.includes('FROM ai_agent_run ')) return [{ id: 42, company_id: 3, agent_id: 12 }]
    if (statement.includes('FROM ai_agent_run_step ')) return [{ step_no: 1 }, { step_no: 2 }]
    if (statement.includes('FROM ai_provider_attempt_read ')) return [{ reservation_id: 8, request_key: 'exact',
      company_id: 3, agent_id: 12, provider: 'mistral', model: 'fixture-primary', status: 'succeeded', input_tokens: 11, output_tokens: 12 }]
    if (statement.includes('FROM ai_spend_reservation_read ')) return [{ id: 8, request_key: 'exact', status: state,
      settled_input_tokens: 11, settled_output_tokens: 12 }]
    return sql(statement, role)
  }
  let calls = 0
  const fetcher = async (url, options) => {
    calls++
    assert.equal(url, 'http://127.0.0.1:3100/api/ai/skills/report-analysis')
    assert.equal(JSON.parse(options.body).agentId, 12)
    assert.equal(options.headers.Cookie, 'private-cookie')
    assert.equal(options.redirect, 'error')
    return Response.json({ run: { run_id: 42, status: 'completed', summary: 'private-prose' } })
  }
  const env = { AI_HARNESS_WEB_URL: 'http://127.0.0.1:3100', AI_HARNESS_SESSION_COOKIE: 'private-cookie' }
  assert.deepEqual(await smokePilot(config, client, env, fetcher), {
    runId: 42, organizationId: 9, companyId: 3, providerAttempts: 1, durableSteps: 2, settled: true,
  })
  assert.equal(calls, 1)
  state = 'reserved'
  await assert.rejects(smokePilot(config, client, env, fetcher), /settlement mismatch/)
  const before = calls
  await assert.rejects(smokePilot(config, client, env, async () => { calls++; throw new Error('private failure') }), /inspect run history/)
  assert.equal(calls, before + 1)
})
