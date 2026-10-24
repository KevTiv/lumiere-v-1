#!/usr/bin/env node
// Explicit Mistral pilot provisioning. Credentials stay in server environment
// variables; this manifest contains only reviewed tenant/model/budget policy.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

function positive(value, name, max = Number.MAX_SAFE_INTEGER) {
  requireValue(Number.isSafeInteger(value) && value > 0 && value <= max, `invalid ${name}`)
  return value
}

function label(value, name) {
  requireValue(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(value), `invalid ${name}`)
  return value
}

export function validateManifest(config) {
  const allowed = ['version', 'organizationId', 'companyId', 'agentName', 'policyKey', 'policyVersion',
    'currency', 'monthlyLimitUnits', 'priceReviewedAt', 'primary', 'review']
  requireValue(config && typeof config === 'object' && Object.keys(config).every(key => allowed.includes(key)), 'unknown manifest field')
  requireValue(config.version === 1, 'unsupported manifest version')
  positive(config.organizationId, 'organizationId')
  positive(config.companyId, 'companyId')
  label(config.agentName, 'agentName')
  label(config.policyKey, 'policyKey')
  positive(config.policyVersion, 'policyVersion', 0xffffffff)
  positive(config.monthlyLimitUnits, 'monthlyLimitUnits')
  requireValue(/^[A-Z]{3}$/.test(config.currency), 'currency must be an ISO code')
  requireValue(typeof config.priceReviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(config.priceReviewedAt)
    && Number.isFinite(Date.parse(config.priceReviewedAt)), 'reviewed pricing date is required')
  const fields = ['model', 'maxTokens', 'contextWindow', 'timeoutMs', 'maxConcurrency', 'inputUnitsPer1k', 'outputUnitsPer1k']
  for (const role of ['primary', 'review']) {
    const profile = config[role]
    requireValue(profile && typeof profile === 'object' && Object.keys(profile).every(key => fields.includes(key)), `invalid ${role} profile`)
    label(profile.model, `${role}.model`)
    requireValue(!/^(ACCOUNT_VISIBLE|REPLACE|PLACEHOLDER)/i.test(profile.model) && !/-latest$/i.test(profile.model), `${role} requires an exact reviewed model id`)
    for (const key of fields.slice(1)) positive(profile[key], `${role}.${key}`, key.includes('Units') ? Number.MAX_SAFE_INTEGER : 0xffffffff)
    requireValue(profile.maxTokens < profile.contextWindow, `${role} output ceiling must leave input capacity`)
  }
  requireValue(config.primary.model !== config.review.model, 'review requires a distinct model')
  return config
}

const none = () => ({ none: [] })
const some = value => ({ some: value })
export function unwrap(value) {
  if (Array.isArray(value) && value.length === 2 && (value[0] === 0 || value[0] === 1)) return value[0] === 0 ? value[1] : null
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('some' in value) return value.some
    if ('none' in value) return null
  }
  return value
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function profilesFor(config) {
  return ['primary', 'review'].map(role => {
    const profile = config[role]
    return {
      profile_key: `${config.policyKey}-${role}`, profile_version: config.policyVersion,
      provider: 'mistral', model: profile.model,
      allowed_roles: role === 'primary' ? ['decision', 'reasoning', 'generation'] : ['review'],
      temperature: some(0), top_p: none(), max_tokens: profile.maxTokens,
      context_window: profile.contextWindow, timeout_ms: profile.timeoutMs,
      max_retries: 0, max_concurrency: profile.maxConcurrency,
      supports_tool_calling: true, supports_structured_output: true, supports_parallel_requests: false,
      input_cost_per_1_k_microunits: some(profile.inputUnitsPer1k),
      output_cost_per_1_k_microunits: some(profile.outputUnitsPer1k),
      per_request_cost_ceiling_microunits: none(),
    }
  })
}

export function policyFor(config) {
  const primary = `${config.policyKey}-primary@${config.policyVersion}`
  return {
    policy_key: config.policyKey, policy_version: config.policyVersion,
    default_decision_profile: primary, default_reasoning_profile: primary,
    default_generation_profile: primary,
    default_review_profile: `${config.policyKey}-review@${config.policyVersion}`,
    shadow_profiles: [], decision_type_overrides_json: '{}', fallback_profiles_json: '{}',
  }
}

function matches(row, expected, kind) {
  for (const [key, value] of Object.entries(expected)) {
    requireValue(equal(unwrap(row[key]), unwrap(value)), `${kind} conflict at ${key}; use a new immutable version`)
  }
  requireValue(row.is_active === true, `${kind} is inactive`)
}

function exactlyOne(rows, kind) {
  requireValue(rows.length === 1, `${kind} must resolve exactly once`)
  return rows[0]
}

async function responseJson(response) {
  return response.json().catch(() => { throw new Error('server returned invalid JSON') })
}

// Check all immutable and scope prerequisites before the first write. An apply
// may stop after an ambiguous write; rerun check rather than blindly retrying it.
export async function provision(config, client, apply = false) {
  validateManifest(config)
  const org = config.organizationId
  await client.verifyTarget(org)
  const company = exactlyOne(await client.sql(`SELECT id, organization_id FROM company WHERE id = ${config.companyId}`), 'company')
  requireValue(Number(company.organization_id) === org, 'company belongs to another organization')
  const skills = await client.sql(`SELECT * FROM ai_skill WHERE skill_key = 'report_analysis' AND is_active = true`)
  const local = skills.filter(row => Number(row.organization_id) === org)
  const skill = exactlyOne(local.length ? local : skills.filter(row => Number(row.organization_id) === 0), 'report_analysis skill')
  const release = exactlyOne(await client.sql(`SELECT * FROM ai_skill_release WHERE organization_id = ${org} AND skill_id = ${positive(Number(skill.id), 'skill id')} AND is_active = true`), 'certified report_analysis release')
  requireValue(Number(release.skill_version_id) > 0, 'release lacks a version')
  // Promotion stays owned by the existing certification path. Provisioning
  // cannot invent a passed certificate or activate an unreviewed skill.
  const expectedProfiles = profilesFor(config)
  const missing = []
  for (const expected of expectedProfiles) {
    const existing = await client.sql(`SELECT * FROM ai_model_profile WHERE organization_id = ${org} AND profile_key = '${expected.profile_key}' AND profile_version = ${expected.profile_version}`)
    requireValue(existing.length <= 1, 'duplicate immutable model profile')
    if (existing.length) matches(existing[0], expected, 'model profile')
    else missing.push(`profile:${expected.profile_key}`)
  }
  const policy = policyFor(config)
  const existingPolicy = await client.sql(`SELECT * FROM ai_intelligence_policy WHERE organization_id = ${org} AND policy_key = '${policy.policy_key}' AND policy_version = ${policy.policy_version}`)
  requireValue(existingPolicy.length <= 1, 'duplicate intelligence policy')
  if (existingPolicy.length) matches(existingPolicy[0], policy, 'intelligence policy')
  else missing.push('intelligence policy')
  const agents = await client.sql(`SELECT * FROM ai_agent WHERE organization_id = ${org} AND name = '${config.agentName}'`)
  requireValue(agents.length <= 1, 'agent name is ambiguous')
  const models = [config.primary.model, config.review.model]
  const agent = {
    name: config.agentName, model: config.primary.model, provider: 'mistral',
    temperature: 0, max_tokens: Math.max(config.primary.maxTokens, config.review.maxTokens),
    context_window: Math.max(config.primary.contextWindow, config.review.contextWindow),
    rate_limit_per_minute: 10, cost_per_1_k_tokens: 0, top_p: 1,
    frequency_penalty: 0, presence_penalty: 0, is_active: true, is_default: false,
    allowed_models: models, allowed_actions: ['skill_run'], description: none(),
    api_key_reference: some('MISTRAL_API_KEY'), system_prompt: none(), monthly_budget: none(),
    metadata: some(JSON.stringify({ provisioner: 'mistral-pilot-v1' })),
  }
  if (agents.length) matches(agents[0], { ...agent, company_id: some(config.companyId) }, 'pilot agent')
  else missing.push('pilot agent')
  const configs = await client.sql(`SELECT * FROM ai_skill_config WHERE organization_id = ${org} AND skill_id = ${skill.id}`)
  const scoped = configs.filter(row => Number(unwrap(row.company_id)) === config.companyId)
  requireValue(scoped.length <= 1, 'duplicate company skill config')
  const previous = scoped[0]
  const settings = previous ? JSON.parse(previous.config_json) : {}
  requireValue(settings && typeof settings === 'object' && !Array.isArray(settings), 'invalid skill settings')
  const ref = `${config.policyKey}@${config.policyVersion}`
  const previousRef = settings.intelligencePolicyRef ?? settings.intelligence_policy_ref
  requireValue(!previousRef || previousRef === ref, 'skill is bound to another intelligence policy')
  requireValue(!previous || previous.is_enabled === true, 'pilot skill is explicitly disabled')
  // Preserve all existing non-policy settings and overrides.
  settings.intelligencePolicyRef = ref
  if (!previous || previousRef !== ref) missing.push('company skill policy binding')
  const period = new Date().toISOString().slice(0, 7)
  async function budgetFor(agentId) {
    const rows = await client.sql(`SELECT * FROM ai_spend_budget_read WHERE organization_id = ${org} AND agent_id = ${agentId} AND billing_period = '${period}'`, 'spend')
    requireValue(rows.length <= 1, 'duplicate spend budget')
    if (rows.length) {
      requireValue(rows[0].currency === config.currency && Number(rows[0].limit_units) === config.monthlyLimitUnits, 'existing budget differs from reviewed manifest')
    }
    return rows[0]
  }
  let agentId = agents.length ? positive(Number(agents[0].id), 'agent id') : null
  const previousAgent = settings.defaultAgentId ?? settings.default_agent_id
  requireValue(previousAgent == null || previousAgent === agentId, 'skill is bound to another default agent')
  if (previousAgent !== agentId || !agentId) missing.push('company skill agent binding')
  if (!agentId || !await budgetFor(agentId)) missing.push('current-period spend budget')
  async function priceFor(profile) {
    if (!agentId) return null
    const prices = await client.sql(`SELECT * FROM ai_spend_price_snapshot_read WHERE organization_id = ${org} AND agent_id = ${agentId} AND provider = 'mistral' AND model = '${profile.model}'`, 'spend')
    const latest = prices.reduce((a, b) => !a || Number(b.version) > Number(a.version) ? b : a, null)
    requireValue(!latest || (latest.currency === config.currency
      && Number(latest.input_units_per_1_k) === profile.inputUnitsPer1k
      && Number(latest.output_units_per_1_k) === profile.outputUnitsPer1k), 'existing price differs; review a separate pricing update')
    return latest
  }
  for (const role of ['primary', 'review']) if (!await priceFor(config[role])) missing.push(`price:${role}`)
  const calibration = await client.sql(`SELECT id FROM ai_calibration_profile WHERE organization_id = ${org} AND profile_name = 'report-attention' AND profile_version = 1`)
  if (calibration.length !== 1) missing.push('governed bootstrap')
  const plan = { organizationId: org, companyId: config.companyId, agentId, skillId: Number(skill.id), policyRef: ref, billingPeriod: period, provider: 'mistral', models, apiKeyRequired: true }
  if (!apply) {
    if (!missing.length) await client.runtime({ orgId: org, companyId: config.companyId, agentId, intelligencePolicyRef: ref }, models)
    return { ...plan, applied: false, readyForKey: missing.length === 0, missing }
  }
  if (!agentId) {
    await client.call('create_ai_agent', [org, some(config.companyId), agent])
    const created = exactlyOne(await client.sql(`SELECT * FROM ai_agent WHERE organization_id = ${org} AND name = '${config.agentName}'`), 'created pilot agent')
    matches(created, { ...agent, company_id: some(config.companyId) }, 'created pilot agent')
    agentId = positive(Number(created.id), 'agent id')
  }
  for (const expected of expectedProfiles) await client.call('register_ai_model_profile', [org, expected])
  await client.call('register_ai_intelligence_policy', [org, policy])
  // configure_ai_spend appends immutable snapshots. Avoid appending identical
  // prices on retries, and never reset settled/outstanding budget counters.
  for (const role of ['primary', 'review']) {
    const profile = config[role]
    if (!await priceFor(profile) || !await budgetFor(agentId)) await client.call('configure_ai_spend', [org, agentId, {
      billing_period: period, currency: config.currency, limit_units: config.monthlyLimitUnits,
      provider: 'mistral', model: profile.model,
      input_units_per_1_k: profile.inputUnitsPer1k, output_units_per_1_k: profile.outputUnitsPer1k,
    }])
  }
  await client.bootstrap({ orgId: org, intelligencePolicyRef: ref })
  settings.defaultAgentId = agentId
  await client.call('upsert_ai_skill_config', [org, {
    company_id: some(config.companyId), skill_id: Number(skill.id), is_enabled: true,
    config_json: JSON.stringify(settings), custom_instructions: previous?.custom_instructions ?? none(),
    tool_overrides: previous?.tool_overrides ?? [], metadata: previous?.metadata ?? none(),
  }])
  const verified = await provision(config, client, false)
  requireValue(verified.readyForKey, `provisioning read-back incomplete: ${verified.missing.join(', ')}`)
  return { ...verified, applied: true }
}

function origin(value, name) {
  const url = new URL(value)
  requireValue(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', `${name} must be an origin`)
  requireValue(url.protocol === 'https:' || (url.protocol === 'http:' &&
    (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.railway.internal'))), `${name} must use HTTPS or private/loopback HTTP`)
  return url.origin
}

export function httpClient(env, fetcher = fetch) {
  const required = key => { requireValue(env[key]?.trim(), `missing ${key}`); return env[key].trim() }
  const base = origin(required('STDB_HOST'), 'STDB_HOST')
  const gateway = origin(required('AI_GATEWAY_URL'), 'AI_GATEWAY_URL')
  const database = encodeURIComponent(required('STDB_MODULE'))
  const owner = required('STDB_SERVER_TOKEN')
  const reader = required('AI_SPEND_READ_STDB_TOKEN')
  requireValue(reader !== owner && reader !== env.STDB_TOKEN, 'spend reader must be a dedicated identity')
  const secret = required('LUMIERE_AI_GATEWAY_INTERNAL_SECRET')
  let lastReaderIdentity
  async function request(url, token, body, contentType, headers = {}) {
    // No automatic mutation retry and no redirects carrying credentials.
    const response = await fetcher(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': contentType, ...headers }, body,
    }).catch(() => { throw new Error('provisioning transport failed; check durable state before retry') })
    requireValue(response.ok, `provisioning request failed: HTTP ${response.status}`)
    return response
  }
  return {
    async sql(statement, role) {
      const response = await request(`${base}/v1/database/${database}/sql`, role === 'spend' ? reader : owner, statement, 'text/plain')
      if (role === 'spend') lastReaderIdentity = response.headers.get('spacetime-identity')?.replace(/^0x/, '').toLowerCase()
      const result = exactlyOne(await responseJson(response), 'SQL result')
      requireValue(Array.isArray(result.schema?.elements) && Array.isArray(result.rows), 'invalid SQL response')
      const names = result.schema.elements.map(element => element.name?.some)
      requireValue(names.every(name => typeof name === 'string'), 'invalid SQL column schema')
      return result.rows.map(row => {
        requireValue(Array.isArray(row) && row.length === names.length, 'invalid SQL row')
        return Object.fromEntries(names.map((name, i) => [name, row[i]]))
      })
    },
    async call(name, args) {
      await request(`${base}/v1/database/${database}/call/${name}`, owner, JSON.stringify(args), 'application/json')
    },
    async verifyTarget(organizationId) {
      await this.sql('SELECT id FROM organization LIMIT 1', 'spend')
      requireValue(/^[a-f0-9]{64}$/.test(lastReaderIdentity ?? ''), 'spend reader identity not verified by server')
      const bindings = await this.sql(`SELECT identity FROM cold_tier_service_identity WHERE organization_id = ${organizationId} AND service_name = 'ai_spend_reader' AND is_active = true`)
      const binding = exactlyOne(bindings, 'active spend reader service binding')
      const identity = unwrap(binding.identity)
      const normalized = (typeof identity === 'string' ? identity : identity?.__identity__)?.replace(/^0x/, '').toLowerCase()
      requireValue(normalized === lastReaderIdentity, 'spend reader is not registered for this organization')
    },
    async bootstrap(body) {
      const response = await request(`${gateway}/v1/harness/governed/bootstrap`, null, JSON.stringify(body), 'application/json', { 'X-Lumiere-Gateway-Secret': secret })
      const result = await responseJson(response)
      requireValue(result.organizationId === body.orgId && result.intelligencePolicyRef === body.intelligencePolicyRef && result.decisionTypesRegistered === true, 'bootstrap read-back mismatch')
    },
    async runtime(body, models) {
      const response = await request(`${gateway}/v1/harness/governed/readiness`, null, JSON.stringify(body), 'application/json', { 'X-Lumiere-Gateway-Secret': secret })
      const result = await responseJson(response)
      const resolved = result.configuration
      requireValue(result.database === env.STDB_MODULE && result.billableCalls === 0
        && resolved?.organizationId === body.orgId && resolved.companyId === body.companyId
        && resolved.agentId === body.agentId && resolved.intelligencePolicyRef === body.intelligencePolicyRef
        && Array.isArray(resolved.models) && equal([...resolved.models].sort(), [...models].sort()), 'gateway runtime read-back mismatch')
    },
  }
}

/** Read-only, non-billable account validation; catalog metadata grants no ERP authority. */
export async function verifyMistralCatalog(config, key, fetcher = fetch) {
  validateManifest(config)
  requireValue(typeof key === 'string' && key.trim(), 'missing MISTRAL_API_KEY')
  const response = await fetcher('https://api.mistral.ai/v1/models', {
    headers: { Authorization: `Bearer ${key.trim()}` }, redirect: 'error', signal: AbortSignal.timeout(30_000),
  }).catch(() => { throw new Error('Mistral catalog transport failed') })
  requireValue(response.ok, `Mistral catalog access failed: HTTP ${response.status}`)
  const catalog = await responseJson(response)
  requireValue(Array.isArray(catalog.data), 'invalid Mistral catalog')
  for (const role of ['primary', 'review']) {
    const profile = config[role]
    const model = catalog.data.find(model => model.id === profile.model || model.aliases?.includes(profile.model))
    requireValue(model && model.capabilities?.completion_chat === true && model.capabilities?.function_calling === true,
      `${role} model is unavailable or lacks chat/function calling`)
    requireValue(Number.isSafeInteger(model.max_context_length) && model.max_context_length >= profile.contextWindow,
      `${role} model catalog context is below the reviewed profile`)
  }
  return { catalogVerified: true, billableCalls: 0 }
}

/** One explicit billable call through the ordinary authenticated BFF, followed
 * by durable run, trace and spend read-back. Never retries an ambiguous request. */
export async function smokePilot(config, client, env, fetcher = fetch) {
  const readiness = await provision(config, client)
  requireValue(readiness.readyForKey, `pilot setup incomplete: ${readiness.missing.join(', ')}`)
  const web = origin(env.AI_HARNESS_WEB_URL, 'AI_HARNESS_WEB_URL')
  const cookie = env.AI_HARNESS_SESSION_COOKIE?.trim()
  requireValue(cookie && !/[\r\n]/.test(cookie), 'missing or invalid AI_HARNESS_SESSION_COOKIE')
  const response = await fetcher(`${web}/api/ai/skills/report-analysis`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180_000),
    headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: web },
    body: JSON.stringify({ companyId: config.companyId, agentId: readiness.agentId,
      inputs: { query: 'Summarize current inventory using only authorized ERP evidence. State any missing evidence.' } }),
  }).catch(() => { throw new Error('pilot transport failed; inspect run history and reconcile before retry') })
  requireValue(response.ok, `pilot BFF failed: HTTP ${response.status}; inspect run history before retry`)
  const result = await responseJson(response)
  const runId = positive(Number(result.run?.run_id), 'pilot run id')
  requireValue(result.run.status === 'completed', 'pilot did not fully settle; inspect run history')
  const run = exactlyOne(await client.sql(`SELECT * FROM ai_agent_run WHERE id = ${runId} AND organization_id = ${config.organizationId}`), 'durable pilot run')
  requireValue(Number(run.company_id) === config.companyId && Number(run.agent_id) === readiness.agentId
    && run.status === 'completed', 'durable run scope or settlement mismatch')
  const steps = await client.sql(`SELECT step_no FROM ai_agent_run_step WHERE run_id = ${runId} AND organization_id = ${config.organizationId}`)
  const orderedSteps = steps.map(step => positive(Number(step.step_no), 'pilot step number')).sort((a, b) => a - b)
  requireValue(steps.length >= 2 && orderedSteps.every((number, index) => number === index + 1), 'pilot lacks ordered durable trace')
  const attempts = await client.sql(`SELECT * FROM ai_provider_attempt_read WHERE run_id = ${runId} AND organization_id = ${config.organizationId}`, 'spend')
  const reservations = await client.sql(`SELECT * FROM ai_spend_reservation_read WHERE run_id = ${runId} AND organization_id = ${config.organizationId}`, 'spend')
  requireValue(attempts.length > 0 && reservations.length === attempts.length, 'pilot lacks durable provider/spend evidence')
  requireValue(new Set(attempts.map(row => row.reservation_id)).size === attempts.length
    && new Set(reservations.map(row => row.id)).size === reservations.length, 'pilot has duplicate provider/spend bindings')
  for (const attempt of attempts) {
    requireValue(attempt.status === 'succeeded' && attempt.provider === 'mistral'
      && readiness.models.includes(attempt.model) && Number(attempt.agent_id) === readiness.agentId
      && Number(attempt.company_id) === config.companyId, 'pilot attempt is unresolved or has the wrong binding')
    const reservation = reservations.find(row => Number(row.id) === Number(attempt.reservation_id))
    requireValue(reservation?.status === 'settled' && reservation.request_key === attempt.request_key
      && Number(reservation.company_id) === config.companyId && Number(reservation.agent_id) === readiness.agentId
      && reservation.provider === attempt.provider && reservation.model === attempt.model
      && Number(reservation.settled_input_tokens) === Number(attempt.input_tokens)
      && Number(reservation.settled_output_tokens) === Number(attempt.output_tokens), 'pilot spend settlement mismatch')
  }
  // Do not print provider prose, evidence content, cookies, or private payloads.
  return { runId, organizationId: config.organizationId, companyId: config.companyId,
    providerAttempts: attempts.length, durableSteps: steps.length, settled: true }
}

async function main() {
  const [mode, filename, ...extra] = process.argv.slice(2)
  requireValue(['--plan', '--check', '--apply', '--verify-key', '--smoke'].includes(mode) && filename && !extra.length,
    'usage: node scripts/provision-ai-harness.mjs --plan|--check|--apply|--verify-key|--smoke manifest.json|--env')
  const raw = filename === '--env' ? process.env.AI_HARNESS_MANIFEST_JSON : await readFile(filename, 'utf8')
  requireValue(typeof raw === 'string' && raw.trim(), 'missing AI_HARNESS_MANIFEST_JSON')
  let config
  try { config = JSON.parse(raw) } catch { throw new Error('manifest contains invalid JSON') }
  validateManifest(config)
  const result = mode === '--plan'
    ? { profiles: profilesFor(config), policy: policyFor(config), monthlyLimitUnits: config.monthlyLimitUnits,
      currency: config.currency, priceReviewedAt: config.priceReviewedAt, billableCalls: 0 }
    : mode === '--verify-key' ? await verifyMistralCatalog(config, process.env.MISTRAL_API_KEY)
    : mode === '--smoke' ? await smokePilot(config, httpClient(process.env), process.env)
    : await provision(config, httpClient(process.env), mode === '--apply')
  console.log(JSON.stringify(result, null, 2))
  if (mode === '--check' && !result.readyForKey) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
