import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planCapabilities, provisionCapabilities, validateManifest } from '../provision-mistral-capabilities.mjs'

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
    release: { id: 20, organization_id: 9, skill_id: 5, is_active: true, skill_version_id: 30 },
    version: { id: 30, organization_id: 9, skill_id: 5, skill_key: 'rag_generation', source_hash: digest },
    evidence: [{ id: 40, fixture_id: 41, organization_id: 9, company_id: 3, skill_id: 5, skill_version_id: 30,
      source_hash: digest, status: { Passed: [] } }],
    bindings: [], prices: [], ownerPools: [],
  }
  const writes = [], reads = []
  const client = {
    async verifyTarget(org) { assert.equal(org, 9) },
    async sql(sql, role) {
      reads.push({ sql, role })
      if (sql.includes('FROM company ')) return [{ id: 3, organization_id: 9 }]
      if (sql.includes('FROM ai_agent ')) return [state.agent]
      if (sql.includes('FROM ai_spend_budget_read ')) { assert.equal(role, 'spend'); return state.budgets }
      if (sql.includes('FROM ai_owner_configuration_read ')) { assert.equal(role, 'spend'); return state.ownerPools }
      if (sql.includes('FROM ai_skill_fixture ')) return [{ id: 41, organization_id: 9, skill_id: 5 }]
      if (sql.includes('FROM ai_intelligence_policy ')) return [state.policy]
      if (sql.includes('FROM ai_model_profile ')) return state.profiles.filter(row => sql.includes(`'${row.profile_key}'`))
      if (sql.includes('FROM ai_skill ')) {
        const surface = config.surfaces.find(surface => sql.endsWith(`= ${surface.skillId}`))
        return surface ? [{ id: surface.skillId, organization_id: 0, skill_key: surface.skillKey, is_active: true }] : []
      }
      if (sql.includes('FROM ai_skill_release ')) return [state.release]
      if (sql.includes('FROM ai_skill_version ')) return [state.version]
      if (sql.includes('FROM ai_skill_certification_evidence ')) return state.evidence
      if (sql.includes('FROM ai_skill_config ')) return state.bindings.filter(row => sql.endsWith(`= ${row.skill_id}`))
      if (sql.includes('FROM ai_metered_price_read ')) {
        assert.equal(role, 'spend')
        return state.prices.filter(row => sql.includes(`model = '${row.model}'`) && sql.includes(`unit = '${row.unit}'`))
      }
      throw new Error(`unexpected SQL ${sql}`)
    },
    async call(name, args) {
      writes.push({ name, args: structuredClone(args) })
      if (name === 'configure_ai_metered_price') {
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

test('read-only check finds missing prices/bindings using dedicated monetary reader', async () => {
  const { config, client, reads, writes } = fixture()
  const result = await provisionCapabilities(config, client, false, now)
  assert.equal(result.ready, false); assert.equal(result.missing.length, 7)
  assert.equal(result.billableCalls, 0); assert.deepEqual(writes, [])
  assert.ok(reads.filter(row => /_read /.test(row.sql)).every(row => row.role === 'spend'))
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

test('structural and certification blockers make zero writes even when setup is missing', async () => {
  const cases = {
    companyScope: f => { const sql = f.client.sql; f.client.sql = async (query, role) => query.includes('FROM company ') ? [{ id: 3, organization_id: 10 }] : sql(query, role) },
    companyAgent: f => { f.state.agent.company_id = { some: 3 } },
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
    staleSource: f => { f.state.version.source_hash = `sha256:${'b'.repeat(64)}` },
    missingCert: f => { f.state.evidence = [] },
    foreignCert: f => { f.state.evidence[0].company_id = 4 },
    staleCert: f => { f.state.evidence[0].source_hash = `sha256:${'b'.repeat(64)}` },
    failedCert: f => { f.state.evidence[0].status = { Failed: [] } },
    laterFailedCert: f => { f.state.evidence.push({ ...f.state.evidence[0], id: 42, status: { Failed: [] } }) },
    disabled: f => { f.state.bindings.push({ organization_id: 9, skill_id: 5, company_id: { some: 3 }, is_enabled: false, config_json: '{}' }) },
    disabledOrg: f => { f.state.bindings.push({ organization_id: 9, skill_id: 5, company_id: { none: [] }, is_enabled: false, config_json: '{}' }) },
    otherAgent: f => { f.state.bindings.push({ organization_id: 9, skill_id: 5, company_id: { some: 3 }, is_enabled: true, config_json: '{"defaultAgentId":99}' }) },
    lateMeterConflict: f => { f.state.prices.push({ id: 1, organization_id: 9, agent_id: 12, ...f.config.meters[1], units_per_1k: 999, currency: 'USD', version: 1 }) },
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

test('ambiguous mutation stops without retry or later writes', async () => {
  const { config, client, writes } = fixture()
  client.call = async (name, args) => { writes.push({ name, args }); throw new Error('response lost') }
  await assert.rejects(provisionCapabilities(config, client, true, now), /response lost/)
  assert.equal(writes.length, 1); assert.equal(writes[0].name, 'configure_ai_metered_price')
})

test('manifest rejects secret fields, unsafe identity, arbitrary units and missing source bindings', () => {
  for (const mutate of [
    c => { c.apiKey = 'secret' }, c => { c.organizationId = 0 }, c => { c.agentId = Number.MAX_SAFE_INTEGER + 1 },
    c => { c.intelligencePolicyRef = "x' OR true" }, c => { c.meters[0].unit = 'characters' },
    c => { c.meters[1].model = 'mistral-ocr-latest' }, c => { c.meters[0].unitsPer1k = 0 },
    c => { c.meters[0].price = 0.01 }, c => { delete c.surfaces[0].sourceHash },
    c => { c.surfaces[1].sourceHash = digest }, c => { c.surfaces.push(c.surfaces[0]) },
    c => { c.pricesReviewedAt = '2026-02-30' }, c => { c.meters = [] },
  ]) {
    const config = manifest(); mutate(config); assert.throws(() => validateManifest(config))
  }
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
