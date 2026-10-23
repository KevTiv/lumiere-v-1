import assert from 'node:assert/strict'
import test from 'node:test'
import { checkCatalog, checkEnvironment, checkIdentities, provisioningPlan, validateManifest } from '../mistral-alpha-preflight.mjs'

function manifest() {
  return {
    schemaVersion: 1, sourceCommit: 'a'.repeat(40), contractVersion: '0.3.139', runtimeHash: `sha256:${'b'.repeat(64)}`,
    deployment: { projectId: 'cc695d4b-030c-43e3-bbd6-a41095b09257', environment: 'production', region: 'europe-west4-drams3a', stdbModule: 'lumiere-v1' },
    organizationId: 9, companyId: 10, agentId: 11, skill: { key: 'report_analysis', releaseId: 12 },
    identities: { writer: '1'.repeat(64), spendReader: '2'.repeat(64), certification: '3'.repeat(64) },
    profiles: [
      { key: 'pilot-main', version: 1, model: 'mistral-pilot-2601', roles: ['decision', 'reasoning', 'generation'], maxTokens: 2048, contextWindow: 32768, timeoutMs: 30000, maxConcurrency: 1 },
      { key: 'pilot-review', version: 1, model: 'mistral-review-2601', roles: ['review'], maxTokens: 2048, contextWindow: 32768, timeoutMs: 30000, maxConcurrency: 1 },
    ],
    policy: { key: 'alpha', version: 1, decision: 'pilot-main@1', reasoning: 'pilot-main@1', generation: 'pilot-main@1', review: 'pilot-review@1' },
    budget: { billingPeriod: new Date().toISOString().slice(0, 7), currency: 'EUR', limitMicrounits: 10_000_000,
      prices: [
        { model: 'mistral-pilot-2601', inputMicrounitsPer1000Tokens: 1000, outputMicrounitsPer1000Tokens: 2000 },
        { model: 'mistral-review-2601', inputMicrounitsPer1000Tokens: 2000, outputMicrounitsPer1000Tokens: 3000 },
      ] },
  }
}
function environment() {
  return { MISTRAL_API_KEY: 'm'.repeat(40), STDB_TOKEN: 'w'.repeat(40), AI_SPEND_READ_STDB_TOKEN: 'r'.repeat(40),
    AI_CERTIFICATION_STDB_TOKEN: 'c'.repeat(40), AI_EXECUTION_ENVELOPE_KEY: 'e'.repeat(40), LUMIERE_AI_GATEWAY_INTERNAL_SECRET: 's'.repeat(40),
    STDB_HOST: 'http://spacetimedb.railway.internal:3000', STDB_MODULE: 'lumiere-v1', AI_CERTIFICATION_RUNTIME_HASH: `sha256:${'b'.repeat(64)}`,
    LUMIERE_ENV: 'production', LUMIERE_BIN: 'gateway' }
}
const sqlPayload = (rows) => [{ schema: { elements: [{ name: { some: 'currency' } }, { name: { some: 'limit_units' } }] }, rows }]

test('plan preserves per-thousand microunits and emits no automatic apply', () => {
  const plan = provisioningPlan(manifest())
  assert.equal(plan.mode, 'review-only')
  assert.equal(plan.spend[0].params.input_units_per_1k, 1000)
  assert.equal(plan.spend[0].params.limit_units, 10_000_000)
  assert.equal(plan.profiles[0].params.max_retries, 0)
  assert.deepEqual(plan.policy.params.shadow_profiles, [])
  assert.equal(plan.policy.params.fallback_profiles_json, '{}')
  assert.deepEqual(plan.bootstrap.body, { orgId: 9, intelligencePolicyRef: 'alpha@1' })
  assert.match(plan.warnings[0], /every call/)
})

test('rejects credentials and unknown fields in reviewed manifests', () => {
  for (const alter of [(m) => { m.MISTRAL_API_KEY = 'secret' }, (m) => { m.profiles[0].token = 'secret' }, (m) => { m.budget.prices[0].currency = 'EUR' }]) {
    const m = manifest(); alter(m)
    assert.throws(() => validateManifest(m), /unknown fields/)
  }
})

test('rejects duplicate identities, unsafe IDs and unpinned source', () => {
  const cases = [
    [(m) => { m.identities.spendReader = m.identities.writer }, /distinct/],
    [(m) => { m.organizationId = Number.MAX_SAFE_INTEGER + 1 }, /safe integer/],
    [(m) => { m.sourceCommit = 'main' }, /exact commit/],
    [(m) => { m.deployment.projectId = '-'.repeat(36) }, /exact UUID/],
    [(m) => { m.runtimeHash = 'sha256:placeholder' }, /exact certification/],
    [(m) => { m.profiles[0].model = 'mistral-large-latest' }, /exact model/],
  ]
  for (const [alter, expected] of cases) { const m = manifest(); alter(m); assert.throws(() => validateManifest(m), expected) }
})

test('rejects role substitution, duplicate refs, same-model review and wider concurrency', () => {
  const cases = [
    [(m) => { m.policy.review = 'pilot-main@1' }, /declared profile/],
    [(m) => { m.profiles[1].key = 'pilot-main' }, /unique/],
    [(m) => { m.profiles[1].model = m.profiles[0].model }, /different model/],
    [(m) => { m.profiles[0].maxConcurrency = 2 }, /maxConcurrency=1/],
    [(m) => { m.profiles[0].timeoutMs = 0 }, /positive u32/],
  ]
  for (const [alter, expected] of cases) { const m = manifest(); alter(m); assert.throws(() => validateManifest(m), expected) }
})

test('rejects ambiguous model prices, fractional units and excessive rates', () => {
  const cases = [
    (m) => { m.budget.prices[1].model = m.budget.prices[0].model },
    (m) => { m.budget.prices[0].inputMicrounitsPer1000Tokens = 0.01 },
    (m) => { m.budget.prices[0].inputMicrounitsPer1000Tokens = 1_000_000_000_001 },
    (m) => { m.budget.prices.pop() },
  ]
  for (const alter of cases) { const m = manifest(); alter(m); assert.throws(() => validateManifest(m), /price/) }
})

test('configuration report never exposes secrets and never claims admission', () => {
  const env = environment()
  const result = checkEnvironment(manifest(), env)
  assert.equal(result.configuration, 'passed')
  assert.equal(result.deploymentAcceptance, false)
  assert.deepEqual(result.providerDependencies, { embedding: 'ollama', vision: 'ollama' })
  for (const name of ['MISTRAL_API_KEY', 'STDB_TOKEN', 'AI_EXECUTION_ENVELOPE_KEY']) assert.equal(JSON.stringify(result).includes(env[name]), false)
})

test('configuration rejects missing keys, reused credentials, wrong runtime and proxy routing', () => {
  const expired = manifest(); expired.budget.billingPeriod = '2000-01'
  assert.throws(() => checkEnvironment(expired, environment()), /current UTC period/)
  const cases = [
    [(e) => { delete e.MISTRAL_API_KEY }, /MISTRAL_API_KEY/],
    [(e) => { e.AI_SPEND_READ_STDB_TOKEN = e.STDB_TOKEN }, /tokens must differ/],
    [(e) => { e.STDB_SERVER_TOKEN = e.STDB_TOKEN }, /tokens must differ/],
    [(e) => { e.KONG_LLM_URL = 'http://kong' }, /KONG_LLM_URL/],
    [(e) => { e.AI_CERTIFICATION_RUNTIME_HASH = `sha256:${'9'.repeat(64)}` }, /digest differs/],
    [(e) => { e.STDB_HOST = 'http://user:password@spacetimedb.railway.internal' }, /credential-free/],
    [(e) => { e.STDB_HOST = 'http://external.example.test' }, /requires HTTPS/],
  ]
  for (const [alter, expected] of cases) { const env = environment(); alter(env); assert.throws(() => checkEnvironment(manifest(), env), expected) }
})

test('catalog check uses only fixed-origin authenticated GET and checks capabilities', async () => {
  const m = manifest(), env = environment(), calls = []
  const result = await checkCatalog(m, env, async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ data: m.profiles.map(({ model }) => ({ id: model, max_context_length: 32768, capabilities: { completion_chat: true, function_calling: true } })) }))
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.mistral.ai/v1/models')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(result.generationAttempted, false)
  assert.equal(result.deploymentAcceptance, false)
})

test('catalog rejects missing capabilities, missing models and insufficient context', async () => {
  for (const alter of [(row) => { row.capabilities.function_calling = false }, (row) => { row.id = 'other' }, (row) => { row.max_context_length = 100 }]) {
    const m = manifest()
    const data = m.profiles.map(({ model }) => ({ id: model, max_context_length: 32768, capabilities: { completion_chat: true, function_calling: true } }))
    alter(data[0])
    await assert.rejects(checkCatalog(m, environment(), async () => new Response(JSON.stringify({ data }))), /model|context/)
  }
})

test('provider errors do not expose response or transport secrets', async () => {
  await assert.rejects(checkCatalog(manifest(), environment(), async () => new Response('SECRET RESPONSE', { status: 401 })), (error) => error.message === 'Mistral catalog returned HTTP 401')
  await assert.rejects(checkCatalog(manifest(), environment(), async () => { throw new Error('SECRET TOKEN') }), (error) => error.message === 'Mistral catalog request failed; response details suppressed')
})

test('identity check verifies server identities and a sender-scoped budget using SELECT only', async () => {
  const m = manifest(), calls = [], ids = Object.values(m.identities)
  const result = await checkIdentities(m, environment(), async (url, init) => {
    calls.push({ url, init })
    assert.match(init.body, /^SELECT /)
    return new Response(JSON.stringify(calls.length <= 3 ? [] : sqlPayload([['EUR', '10000000']])), {
      headers: { 'spacetime-identity': ids[(calls.length - 1) % 3] },
    })
  })
  assert.equal(calls.length, 4)
  assert.equal(calls.some(({ url }) => url.includes('/call/')), false)
  assert.equal(result.spendReaderBudget, 'passed')
  assert.equal(result.deploymentAcceptance, false)
})

test('identity check fails closed on wrong identity or empty scoped budget', async () => {
  await assert.rejects(checkIdentities(manifest(), environment(), async () => new Response('[]', { headers: { 'spacetime-identity': 'f'.repeat(64) } })), /identity differs/)
  const m = manifest(), ids = Object.values(m.identities)
  let calls = 0
  await assert.rejects(checkIdentities(m, environment(), async () => new Response('[]', { headers: { 'spacetime-identity': ids[calls++ % 3] } })), /budget is absent/)
})
