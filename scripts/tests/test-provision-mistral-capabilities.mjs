import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planCapabilities, provisionCapabilities, validateManifest } from '../provision-mistral-capabilities.mjs'
import { httpClient } from '../provision-ai-harness.mjs'

const now = new Date('2026-11-04T12:00:00Z')
const digest = `sha256:${'a'.repeat(64)}`
const manifest = () => ({ version: 1, organizationId: 9, companyId: 3, agentId: 12,
  intelligencePolicyRef: 'fixture-policy@1', currency: 'USD', pricesReviewedAt: '2026-11-01',
  surfaces: [{ skillKey: 'rag_generation', skillId: 5, sourceHash: digest },
    { skillKey: 'document_ocr', skillId: 6 }, { skillKey: 'document_embeddings', skillId: 7 },
    { skillKey: 'activity_indexing', skillId: 8 }, { skillKey: 'embedding_query', skillId: 9 }],
  meters: [{ model: 'mistral-embed', unit: 'tokens', unitsPer1k: 123 },
    { model: 'mistral-ocr-fixture-2601', unit: 'pages', unitsPer1k: 456 }] })

function fixture() {
  const config = manifest()
  const state = {
    agent: { id: 12, organization_id: 9, company_id: { none: [] }, provider: 'mistral', is_active: true,
      model: 'fixture-primary', max_tokens: 2048, context_window: 32768,
      allowed_models: ['fixture-primary', 'fixture-review', ...config.meters.map(meter => meter.model)],
      allowed_actions: ['chat', 'ocr', 'embedding_index', 'embedding_query'] },
    budgets: [{ id: 11, organization_id: 9, agent_id: 12, billing_period: '2026-11', currency: 'USD',
      limit_units: 1_000_000, settled_units: 77, outstanding_units: 23 }],
    policy: { organization_id: 9, is_active: true, default_decision_profile: 'primary@1',
      default_reasoning_profile: 'primary@1', default_generation_profile: 'primary@1', default_review_profile: 'review@1',
      shadow_profiles: [], fallback_profiles_json: '{}' },
    profiles: ['primary', 'review'].map(key => ({ organization_id: 9, profile_key: key, profile_version: 1,
      is_active: true, provider: 'mistral', model: `fixture-${key}`, max_tokens: 1024, context_window: 16000,
      max_retries: 0, allowed_roles: key === 'review' ? ['review'] : ['decision', 'reasoning', 'generation'] })),
    bindings: [], prices: [], ownerPools: [],
    writers: [{ organization_id: 9, service_name: 'ai_spend_writer', is_active: true, identity: ['b'.repeat(64)] }],
    writerIdentity: 'b'.repeat(64),
  }
  const writes = [], reads = []
  const client = {
    async verifyTarget(org) { assert.equal(org, 9) },
    async writerIdentity() { return state.writerIdentity },
    async sql(sql, role) {
      reads.push({ sql, role })
      if (sql.includes('FROM cold_tier_service_identity ')) { assert.ok(sql.includes("service_name = 'ai_spend_writer'")); return state.writers }
      if (sql.includes('FROM company ')) return [{ id: 3, organization_id: 9 }]
      if (sql.includes('FROM ai_agent ')) return [state.agent]
      if (sql.includes('FROM ai_spend_budget_read ')) { assert.equal(role, 'spend'); return state.budgets }
      if (sql.includes('FROM ai_owner_configuration_read ')) { assert.equal(role, 'spend'); return state.ownerPools }
      if (sql.includes('FROM ai_intelligence_policy ')) return [state.policy]
      if (sql.includes('FROM ai_model_profile ')) return state.profiles.filter(row => sql.includes(`'${row.profile_key}'`))
      if (sql.includes('FROM ai_skill ')) {
        const surface = config.surfaces.find(surface => sql.endsWith(`= ${surface.skillId}`))
        return surface ? [{ id: surface.skillId, organization_id: 0, skill_key: surface.skillKey, is_active: true }] : []
      }
      if (sql.includes('FROM ai_skill_config ')) return state.bindings.filter(row => sql.endsWith(`= ${row.skill_id}`))
      if (sql.includes('FROM ai_metered_price_read ')) {
        assert.equal(role, 'spend')
        assert.ok(sql.startsWith('SELECT id, organization_id, agent_id, model, unit, currency, units_per_1_k, version FROM '))
        return state.prices.filter(row => sql.includes(`model = '${row.model}'`) && sql.includes(`unit = '${row.unit}'`))
      }
      throw new Error(`unexpected SQL ${sql}`)
    },
    async call(name, args) {
      writes.push({ name, args: structuredClone(args) })
      if (name === 'configure_ai_metered_price') {
        // Names come from the generated HTTPschema reducer params product (Ref 247), not Rust identifiers.
        assert.deepEqual(Object.keys(args[2]).sort(), ['currency', 'model', 'unit', 'units_per_1_k'])
        state.prices.push({ ...args[2], organization_id: args[0], agent_id: args[1], id: state.prices.length + 1, version: 1 })
      } else if (name === 'upsert_ai_skill_config') {
        const i = state.bindings.findIndex(row => row.skill_id === args[1].skill_id)
        const row = { ...args[1], id: i >= 0 ? state.bindings[i].id : state.bindings.length + 1, organization_id: args[0] }
        if (i >= 0) state.bindings[i] = row
        else state.bindings.push(row)
      } else throw new Error(`forbidden mutation ${name}`)
    },
  }
  return { config, state, client, reads, writes }
}

test('offline plan validates exact meters and declares separate release and acceptance gates', () => {
  const plan = planCapabilities(manifest())
  assert.equal(plan.billableCalls, 0); assert.equal(plan.deploymentAcceptance, false)
  assert.equal(plan.meters[1].unit, 'pages')
  assert.ok(plan.remainingGates.some(gate => gate.includes('contract')))
})

function reviewedRepair() {
  const f = fixture()
  f.config.surfaces = f.config.surfaces.filter(s => s.skillKey !== 'document_ocr')
  f.config.meters = f.config.meters.filter(m => m.unit !== 'pages')
  f.state.agent.allowed_models = f.state.agent.allowed_models.filter(m => m !== 'mistral-embed')
  f.state.agent.allowed_actions = ['chat', 'ocr']
  f.config.agentCapabilities = { addModels: ['mistral-embed'], addActions: ['embedding_query', 'embedding_index'] }
  f.probes = []
  f.client.verifyActivationAuthority = async (...args) => { f.probes.push(args) }
  const call = f.client.call.bind(f.client)
  f.client.call = async (name, args) => {
    if (!name.startsWith('set_ai_agent_')) return call(name, args)
    f.writes.push({ name, args })
    f.state.agent[name === 'set_ai_agent_model' ? 'allowed_models' : 'allowed_actions'].push(args[2])
  }
  return f
}

test('reviewed missing-only toggles preserve agent and pool; replay is empty', async () => {
  const f = reviewedRepair(), before = structuredClone(f.state)
  await provisionCapabilities(f.config, f.client, true, now)
  assert.deepEqual(f.writes.slice(0, 3).map(w => w.name), ['set_ai_agent_model', 'set_ai_agent_action', 'set_ai_agent_action'])
  assert.deepEqual(f.state.budgets, before.budgets)
  for (const key of Object.keys(before.agent).filter(k => !k.startsWith('allowed_'))) assert.deepEqual(f.state.agent[key], before.agent[key])
  const count = f.writes.length
  await provisionCapabilities(f.config, f.client, true, now)
  assert.equal(f.writes.length, count)
})

test('default strict behavior and all structural/authority failures precede writes', async () => {
  for (const breakIt of [
    f => { delete f.config.agentCapabilities },
    f => { f.config.agentCapabilities.addModels.push('unknown') },
    f => { f.config.agentCapabilities.addActions.push('embedding_query') },
    f => { f.state.agent.company_id = { some: 99 } },
    f => { f.state.policy.is_active = false },
    f => { f.client.verifyActivationAuthority = async () => { throw new Error('authority denied') } },
    f => { f.client.verifyActivationAuthority = async () => { throw new Error('schema mismatch') } },
  ]) {
    const f = reviewedRepair()
    breakIt(f)
    await assert.rejects(provisionCapabilities(f.config, f.client, true, now))
    assert.deepEqual(f.writes, [])
  }
})

test('unknown toggle outcome stops before pricing or binding', async () => {
  const f = reviewedRepair()
  f.client.call = async name => { f.writes.push(name); throw new Error('unknown outcome') }
  await assert.rejects(provisionCapabilities(f.config, f.client, true, now), /unknown outcome/)
  assert.deepEqual(f.writes, ['set_ai_agent_model'])
})

test('HTTP capability preflight blocks stale schema without substituting credentials', async () => {
  const requests = []
  const client = httpClient({ STDB_HOST: 'http://localhost:3000', STDB_MODULE: 'fixture',
    AI_GATEWAY_URL: 'http://localhost:8787', STDB_SERVER_TOKEN: 'operator',
    AI_SPEND_READ_STDB_TOKEN: 'reader', STDB_TOKEN: 'writer', LUMIERE_AI_GATEWAY_INTERNAL_SECRET: 'secret' },
  async (url, init) => {
    requests.push({ url, init })
    return new Response(JSON.stringify([{ schema: { elements: [{ name: { some: 'id' } }] }, rows: [[9]] }]))
  })
  await assert.rejects(client.verifyActivationAuthority(9, 12, true), /invalid deployed activation schema/)
  assert.equal(requests.length, 1)
  assert.ok(requests[0].url.endsWith('/schema?version=9'))
  assert.equal(requests[0].init.headers.Authorization, 'Bearer operator')
})

test('HTTP deployed primitive signatures precede native no-write authorization probe', async () => {
  const signatures = [
    ['check_ai_agent_activation', [['organization_id', 'U64'], ['agent_id', 'U64'], ['configure_meter', 'Bool']]],
    ['set_ai_agent_model', [['organization_id', 'U64'], ['agent_id', 'U64'], ['model', 'String'], ['enabled', 'Bool']]],
    ['set_ai_agent_action', [['organization_id', 'U64'], ['agent_id', 'U64'], ['action', 'String'], ['enabled', 'Bool']]],
  ]
  for (const scenario of ['valid', 'denied', 'stale']) {
    const requests = []
    const schema = { reducers: signatures.map(([name, params]) => ({ name,
      params: { elements: params.map(([name, type]) => ({ name: { some: name }, algebraic_type: { [type]: [] } })) } })) }
    if (scenario === 'stale') schema.reducers[1].params.elements[2].algebraic_type = { U64: [] }
    const client = httpClient({ STDB_HOST: 'http://localhost:3000', STDB_MODULE: 'fixture',
      AI_GATEWAY_URL: 'http://localhost:8787', STDB_SERVER_TOKEN: 'operator',
      AI_SPEND_READ_STDB_TOKEN: 'reader', STDB_TOKEN: 'writer', LUMIERE_AI_GATEWAY_INTERNAL_SECRET: 'secret' },
    async (url, init) => {
      requests.push({ url, init })
      if (init.method === 'GET') return new Response(JSON.stringify(schema))
      assert.ok(url.endsWith('/call/check_ai_agent_activation'))
      assert.deepEqual(JSON.parse(init.body), [9, 12, true])
      assert.equal(init.headers.Authorization, 'Bearer operator')
      return new Response(scenario === 'denied' ? 'private body' : '', { status: scenario === 'denied' ? 403 : 200 })
    })
    if (scenario === 'valid') await client.verifyActivationAuthority(9, 12, true)
    else await assert.rejects(client.verifyActivationAuthority(9, 12, true),
      scenario === 'stale' ? /signature mismatch/ : /HTTP 403/)
    assert.equal(requests.length, scenario === 'stale' ? 1 : 2)
  }
})

test('read-only check finds missing prices/bindings using dedicated monetary reader', async () => {
  const { config, client, reads, writes } = fixture()
  const result = await provisionCapabilities(config, client, false, now)
  assert.equal(result.ready, false); assert.equal(result.missing.length, 7)
  assert.equal(result.billableCalls, 0); assert.deepEqual(writes, [])
  assert.ok(reads.filter(row => /_read /.test(row.sql)).every(row => row.role === 'spend'))
})

test('built-in setup works without skill releases or certificates', async () => {
  const { config, client, reads } = fixture()
  delete config.surfaces[0].sourceHash
  const result = await provisionCapabilities(config, client, true, now)
  assert.equal(result.ready, true)
  assert.ok(reads.every(({ sql }) => !/FROM ai_skill_(release|version|fixture|certification)/u.test(sql)))
})

test('explicit apply is idempotent and preserves budget, settings, instructions and overrides', async () => {
  const { config, state, client, writes } = fixture()
  state.bindings.push({ id: 2, organization_id: 9, company_id: { some: 3 }, skill_id: 5, is_enabled: true,
    config_json: '{"max_output_rows":25}', custom_instructions: { some: 'retain me' }, tool_overrides: ['reviewed'], metadata: { some: 'private' } })
  const budget = structuredClone(state.budgets), agent = structuredClone(state.agent)
  const first = await provisionCapabilities(config, client, true, now)
  assert.equal(first.ready, true); assert.equal(first.applied, true)
  assert.deepEqual(state.budgets, budget); assert.deepEqual(state.agent, agent)
  assert.deepEqual(state.bindings[0].custom_instructions, { some: 'retain me' })
  assert.deepEqual(state.bindings[0].tool_overrides, ['reviewed'])
  assert.equal(JSON.parse(state.bindings[0].config_json).max_output_rows, 25)
  assert.ok(writes.every(write => ['configure_ai_metered_price', 'upsert_ai_skill_config'].includes(write.name)))
  const after = structuredClone(state); writes.length = 0
  assert.equal((await provisionCapabilities(config, client, true, now)).ready, true)
  assert.deepEqual(state, after); assert.deepEqual(writes, [])
})

test('pool preservation ignores SQL row order but rejects concurrent monetary changes', async () => {
  for (const changed of [false, true]) {
    const { config, state, client } = fixture()
    state.budgets.push({ ...state.budgets[0], id: 22, agent_id: 99,
      limit_units: 0, settled_units: 0, outstanding_units: 0 })
    const before = structuredClone(state.budgets)
    const sql = client.sql.bind(client)
    let budgetReads = 0
    client.sql = async (statement, role) => {
      const rows = await sql(statement, role)
      if (!statement.includes('FROM ai_spend_budget_read ')) return rows
      budgetReads += 1
      if (budgetReads === 2 && changed) state.budgets[0].settled_units += 1
      return budgetReads === 2 ? [...rows].reverse() : rows
    }
    const apply = provisionCapabilities(config, client, true, now)
    if (changed) await assert.rejects(apply, /pool readback changed/)
    else {
      assert.equal((await apply).ready, true)
      assert.deepEqual(state.budgets, before)
    }
    assert.equal(budgetReads, 2)
  }
})

test('apply accepts an agent scoped to the requested company and preserves that scope', async () => {
  const { config, state, client, writes } = fixture()
  state.agent.company_id = { some: '3' }
  const agent = structuredClone(state.agent)

  const result = await provisionCapabilities(config, client, true, now)

  assert.equal(result.ready, true)
  assert.deepEqual(state.agent, agent)
  assert.ok(writes.some(write => write.name === 'upsert_ai_skill_config'))
  assert.ok(state.bindings.every(binding => binding.company_id.some === config.companyId))
})

test('structural blockers make zero writes even when setup is missing', async () => {
  const cases = {
    writerMissing: f => { f.state.writers = [] },
    writerAmbiguous: f => { f.state.writers.push({ ...f.state.writers[0] }) },
    writerForeign: f => { f.state.writers[0].organization_id = 10 },
    writerInactive: f => { f.state.writers[0].is_active = false },
    writerWrongService: f => { f.state.writers[0].service_name = 'ai_spend_reader' },
    writerWrongIdentity: f => { f.state.writers[0].identity = ['c'.repeat(64)] },
    writerUnverified: f => { f.state.writerIdentity = '' },
    companyScope: f => { const sql = f.client.sql; f.client.sql = async (query, role) => query.includes('FROM company ') ? [{ id: 3, organization_id: 10 }] : sql(query, role) },
    foreignAgentCompany: f => { f.state.agent.company_id = { some: 4 } },
    foreignAgentOrganization: f => { f.state.agent.organization_id = 10 },
    missingAgentCompany: f => { delete f.state.agent.company_id },
    malformedAgentCompany: f => { f.state.agent.company_id = { some: [3] } },
    provider: f => { f.state.agent.provider = 'ollama' },
    inactive: f => { f.state.agent.is_active = false },
    model: f => { f.state.agent.allowed_models = ['fixture-primary', 'fixture-review'] },
    action: f => { f.state.agent.allowed_actions = ['chat'] },
    budgetMissing: f => { f.state.budgets = [] },
    budgetCurrency: f => { f.state.budgets[0].currency = 'EUR' },
    budgetExhausted: f => { f.state.budgets[0].settled_units = 1_000_000 },
    secondPool: f => { f.state.budgets.push({ ...f.state.budgets[0], id: 50, agent_id: 99 }) },
    ownerPool: f => { f.state.ownerPools = [{ organization_id: 9, agent_id: 99 }] },
    policy: f => { f.state.policy.is_active = false },
    profile: f => { f.state.profiles[0].provider = 'gemini' },
    review: f => { f.state.profiles[1].model = 'fixture-primary' },
    retry: f => { f.state.profiles[0].max_retries = 1 },
    disabled: f => { f.state.bindings.push({ organization_id: 9, skill_id: 5, company_id: { some: 3 }, is_enabled: false, config_json: '{}' }) },
    disabledOrg: f => { f.state.bindings.push({ organization_id: 9, skill_id: 5, company_id: { none: [] }, is_enabled: false, config_json: '{}' }) },
    otherAgent: f => { f.state.bindings.push({ organization_id: 9, skill_id: 5, company_id: { some: 3 }, is_enabled: true, config_json: '{"defaultAgentId":99}' }) },
    lateMeterConflict: f => { f.state.prices.push({ id: 1, organization_id: 9, agent_id: 12, ...f.config.meters[1], units_per_1_k: 999, currency: 'USD', version: 1 }) },
  }
  for (const [name, alter] of Object.entries(cases)) {
    const f = fixture(); alter(f)
    await assert.rejects(provisionCapabilities(f.config, f.client, true, now), undefined, name)
    assert.deepEqual(f.writes, [], name)
  }
})

test('chat binding requires query-embedding permission even without a separate query surface', async () => {
  const { config, state, client, writes } = fixture()
  config.surfaces = [config.surfaces[0]]
  state.agent.allowed_actions = ['chat']
  await assert.rejects(provisionCapabilities(config, client, true, now), /rag_generation requires the embedding_query agent action/)
  assert.deepEqual(writes, [])
})

test('native form/action skill keys enforce their real runtime actions before any writes', async () => {
  const form = fixture()
  form.config.surfaces.push({ skillKey: 'form_suggestion', skillId: 10, sourceHash: digest })
  // skill_run alone cannot enable form_suggestion, even though it can invoke generic skills.
  form.state.agent.allowed_actions = ['chat', 'ocr', 'embedding_index', 'embedding_query', 'skill_run']
  await assert.rejects(provisionCapabilities(form.config, form.client, true, now), /agent action is not allowed for form_suggestion/)
  assert.deepEqual(form.writes, [])
  const action = fixture()
  action.config.surfaces = [{ skillKey: 'action_draft_generation', skillId: 10, sourceHash: digest }]
  action.state.agent.allowed_actions = ['skill_run']
  await assert.rejects(provisionCapabilities(action.config, action.client, true, now), /agent action is not allowed for action_draft_generation/)
  assert.deepEqual(action.writes, [])
})

test('meter setup uses canonical digit-normalized HTTP field names and detects existing prices', async () => {
  const { config, state, client, writes } = fixture()
  state.prices = config.meters.map((meter, index) => ({ id: index + 1, organization_id: 9,
    agent_id: 12, model: meter.model, unit: meter.unit, currency: 'USD', units_per_1_k: meter.unitsPer1k, version: 1 }))
  const checked = await provisionCapabilities(config, client, false, now)
  assert.ok(checked.missing.every(missing => !missing.startsWith('meter:')))
  await provisionCapabilities(config, client, true, now)
  assert.ok(writes.every(write => write.name !== 'configure_ai_metered_price'))
  const absent = fixture()
  await provisionCapabilities(absent.config, absent.client, true, now)
  const args = absent.writes.find(write => write.name === 'configure_ai_metered_price').args[2]
  assert.equal(args.units_per_1_k, absent.config.meters[0].unitsPer1k)
  assert.equal(Object.hasOwn(args, 'units_per_1k'), false)
})

test('ambiguous mutation stops without retry or later writes', async () => {
  const { config, client, writes } = fixture()
  client.call = async (name, args) => { writes.push({ name, args }); throw new Error('response lost') }
  await assert.rejects(provisionCapabilities(config, client, true, now), /response lost/)
  assert.equal(writes.length, 1); assert.equal(writes[0].name, 'configure_ai_metered_price')
})

test('manifest rejects secret fields, unsafe identity, arbitrary units and malformed legacy hashes', () => {
  for (const mutate of [
    c => { c.apiKey = 'secret' }, c => { c.organizationId = 0 }, c => { c.agentId = Number.MAX_SAFE_INTEGER + 1 },
    c => { c.intelligencePolicyRef = "x' OR true" }, c => { c.meters[0].unit = 'characters' },
    c => { c.meters[1].model = 'mistral-ocr-latest' }, c => { c.meters[0].unitsPer1k = 0 },
    c => { c.meters[0].price = 0.01 }, c => { c.surfaces[0].sourceHash = "invalid" },
    c => { c.surfaces.push(c.surfaces[0]) },
    c => { c.pricesReviewedAt = '2026-02-30' }, c => { c.meters = [] },
  ]) {
    const config = manifest(); mutate(config); assert.throws(() => validateManifest(config))
  }
})

test('writer identity probe authenticates STDB_TOKEN and requires server identity without reducer calls', async () => {
  const requests = []
  const env = { STDB_HOST: 'http://127.0.0.1:3000', STDB_MODULE: 'fixture', STDB_SERVER_TOKEN: 'owner-fixture',
    AI_SPEND_READ_STDB_TOKEN: 'reader-fixture', STDB_TOKEN: 'writer-fixture', AI_GATEWAY_URL: 'http://127.0.0.1:8090',
    LUMIERE_AI_GATEWAY_INTERNAL_SECRET: 'internal-fixture' }
  const client = httpClient(env, async (url, init) => {
    requests.push({ url, ...init })
    return new Response('[]', { headers: { 'spacetime-identity': `0x${'B'.repeat(64)}` } })
  })
  assert.equal(await client.writerIdentity(), 'b'.repeat(64))
  assert.equal(requests.length, 1)
  assert.ok(requests[0].url.endsWith('/sql'))
  assert.equal(requests[0].headers.Authorization, 'Bearer writer-fixture')
  assert.equal(requests[0].body, 'SELECT id FROM organization LIMIT 1')
  assert.equal(requests[0].redirect, 'error')
  const unavailable = httpClient(env, async () => new Response('[]'))
  await assert.rejects(unavailable.writerIdentity(), /spend writer identity not verified by server/)
})

test('CLI plan runs without credentials or network configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mistral-capabilities-'))
  try {
    const file = join(directory, 'manifest.json'); writeFileSync(file, JSON.stringify(manifest()))
    const output = execFileSync(process.execPath, [new URL('../provision-mistral-capabilities.mjs', import.meta.url).pathname, '--plan', file],
      { encoding: 'utf8', env: { PATH: process.env.PATH } })
    assert.equal(JSON.parse(output).billableCalls, 0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
