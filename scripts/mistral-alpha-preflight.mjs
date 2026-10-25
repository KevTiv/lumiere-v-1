#!/usr/bin/env node
// Read-only pilot checks. This file never calls a reducer or a generation API.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { decodeSqlRows, normalizeIdentity } from './lib/production-identity-bootstrap.mjs'

const ROLES = ['decision', 'reasoning', 'generation', 'review']
const TOKEN_NAMES = ['STDB_TOKEN', 'AI_SPEND_READ_STDB_TOKEN', 'AI_CERTIFICATION_STDB_TOKEN']
const SECRET_NAMES = [...TOKEN_NAMES, 'MISTRAL_API_KEY', 'AI_EXECUTION_ENVELOPE_KEY', 'LUMIERE_AI_GATEWAY_INTERNAL_SECRET']
const key = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value)
const positive = (value) => Number.isSafeInteger(value) && value > 0
const requireThat = (condition, message) => { if (!condition) throw new Error(message) }
const ref = (profile) => `${profile.key}@${profile.version}`

function object(value, allowed, name) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`)
  requireThat(Object.keys(value).every((field) => allowed.includes(field)), `${name} has unknown fields; keep credentials in server environment variables`)
}

export function validateManifest(input) {
  object(input, ['schemaVersion', 'sourceCommit', 'contractVersion', 'runtimeHash', 'deployment', 'organizationId', 'companyId', 'agentId', 'skill', 'identities', 'profiles', 'policy', 'budget'], 'manifest')
  requireThat(input.schemaVersion === 1, 'unsupported manifest schemaVersion')
  requireThat(/^[0-9a-f]{40}$/u.test(input.sourceCommit ?? ''), 'sourceCommit must be an exact commit SHA')
  requireThat(/^\d+\.\d+\.\d+$/u.test(input.contractVersion ?? ''), 'contractVersion must be an exact release')
  requireThat(/^sha256:[0-9a-f]{64}$/u.test(input.runtimeHash ?? ''), 'runtimeHash must be an exact certification digest')
  object(input.deployment, ['projectId', 'environment', 'region', 'stdbModule'], 'deployment')
  requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(input.deployment.projectId ?? ''), 'deployment.projectId must be an exact UUID')
  requireThat(key(input.deployment.environment) && key(input.deployment.region) && key(input.deployment.stdbModule), 'deployment requires exact environment, region and module')
  for (const field of ['organizationId', 'companyId', 'agentId']) requireThat(positive(input[field]), `${field} must be a positive safe integer`)
  object(input.skill, ['key', 'releaseId'], 'skill')
  requireThat(input.skill.key === 'report_analysis' && positive(input.skill.releaseId), 'pilot requires report_analysis and an exact active releaseId')
  object(input.identities, ['writer', 'spendReader', 'certification'], 'identities')
  const identities = Object.values(input.identities)
  requireThat(identities.length === 3 && identities.every((identity) => /^[0-9a-f]{64}$/u.test(identity)), 'three exact server-verified identities are required')
  requireThat(new Set(identities).size === 3, 'writer, spend reader and certification identities must be distinct')
  requireThat(Array.isArray(input.profiles) && input.profiles.length >= 2 && input.profiles.length <= 8, 'pilot requires two to eight profiles')
  for (const profile of input.profiles) {
    object(profile, ['key', 'version', 'model', 'roles', 'maxTokens', 'contextWindow', 'timeoutMs', 'maxConcurrency'], 'profile')
    requireThat(key(profile.key) && positive(profile.version) && profile.version <= 0xffffffff, 'profile key or version is invalid')
    requireThat(typeof profile.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(profile.model) && !profile.model.endsWith('-latest'), 'profile requires an exact model ID; rolling latest aliases are excluded')
    requireThat(Array.isArray(profile.roles) && profile.roles.length > 0 && profile.roles.every((role) => ROLES.includes(role)) && new Set(profile.roles).size === profile.roles.length, 'profile roles are invalid')
    for (const field of ['maxTokens', 'contextWindow', 'timeoutMs', 'maxConcurrency']) requireThat(positive(profile[field]) && profile[field] <= 0xffffffff, `profile ${field} must be a positive u32`)
    requireThat(profile.maxTokens <= profile.contextWindow, 'profile output limit exceeds context window')
    requireThat(profile.maxConcurrency === 1, 'initial pilot requires maxConcurrency=1')
  }
  const profiles = new Map(input.profiles.map((profile) => [ref(profile), profile]))
  requireThat(profiles.size === input.profiles.length, 'profile references must be unique')
  object(input.policy, ['key', 'version', ...ROLES], 'policy')
  requireThat(key(input.policy.key) && positive(input.policy.version) && input.policy.version <= 0xffffffff, 'policy key or version is invalid')
  for (const role of ROLES) requireThat(profiles.get(input.policy[role])?.roles.includes(role), `policy ${role} must resolve to a declared profile with that role`)
  requireThat(['decision', 'reasoning', 'generation'].every((role) => profiles.get(input.policy.review).model !== profiles.get(input.policy[role]).model), 'review must use a different model from decision, reasoning and generation')
  object(input.budget, ['billingPeriod', 'currency', 'limitMicrounits', 'prices'], 'budget')
  requireThat(/^\d{4}-(0[1-9]|1[0-2])$/u.test(input.budget.billingPeriod ?? ''), 'billingPeriod must be YYYY-MM')
  requireThat(/^[A-Z]{3}$/u.test(input.budget.currency ?? '') && positive(input.budget.limitMicrounits), 'budget requires currency and positive integer microunits')
  const models = new Set(input.profiles.map(({ model }) => model))
  requireThat(Array.isArray(input.budget.prices) && input.budget.prices.length === models.size, 'one reviewed price entry is required per model')
  const priced = new Set()
  for (const price of input.budget.prices) {
    object(price, ['model', 'inputMicrounitsPer1000Tokens', 'outputMicrounitsPer1000Tokens'], 'price')
    requireThat(models.has(price.model) && !priced.has(price.model), 'price model is missing, duplicated or outside the pilot')
    priced.add(price.model)
    for (const field of ['inputMicrounitsPer1000Tokens', 'outputMicrounitsPer1000Tokens']) requireThat(positive(price[field]) && price[field] <= 1_000_000_000_000, 'prices must be positive integer currency microunits per 1000 tokens')
  }
  return input
}

export function provisioningPlan(input) {
  const m = validateManifest(input)
  return {
    schemaVersion: 1, mode: 'review-only', sourceCommit: m.sourceCommit, contractVersion: m.contractVersion,
    runtimeHash: m.runtimeHash, deployment: m.deployment, organizationId: m.organizationId, companyId: m.companyId,
    agentId: m.agentId, skill: m.skill, requiredAllowedModels: [...new Set(m.profiles.map(({ model }) => model))],
    // These are Rust parameter names, not generated HTTP/SATS wire encodings.
    parameterFormat: 'rust-source-fields; serialize through matching released contracts before applying',
    profiles: m.profiles.map((p) => ({ reducer: 'register_ai_model_profile', organization_id: m.organizationId, params: {
      profile_key: p.key, profile_version: p.version, provider: 'mistral', model: p.model, allowed_roles: p.roles,
      temperature: null, top_p: null, max_tokens: p.maxTokens, context_window: p.contextWindow,
      timeout_ms: p.timeoutMs, max_retries: 0, max_concurrency: p.maxConcurrency,
      supports_tool_calling: true, supports_structured_output: true, supports_parallel_requests: false,
      input_cost_per_1k_microunits: null, output_cost_per_1k_microunits: null, per_request_cost_ceiling_microunits: null,
    } })),
    policy: { reducer: 'register_ai_intelligence_policy', organization_id: m.organizationId, params: {
      policy_key: m.policy.key, policy_version: m.policy.version,
      ...Object.fromEntries(ROLES.map((role) => [`default_${role}_profile`, m.policy[role]])),
      shadow_profiles: [], decision_type_overrides_json: '{}', fallback_profiles_json: '{}',
    } },
    spend: m.budget.prices.map((price) => ({ reducer: 'configure_ai_spend', organization_id: m.organizationId,
      agent_id: m.agentId, params: { billing_period: m.budget.billingPeriod, currency: m.budget.currency,
        limit_units: m.budget.limitMicrounits, provider: 'mistral', model: price.model,
        input_units_per_1k: price.inputMicrounitsPer1000Tokens, output_units_per_1k: price.outputMicrounitsPer1000Tokens },
    })),
    bootstrap: { method: 'POST', path: '/v1/harness/governed/bootstrap',
      body: { orgId: m.organizationId, intelligencePolicyRef: `${m.policy.key}@${m.policy.version}` } },
    warnings: ['configure_ai_spend creates a new immutable price snapshot on every call; compare readback and apply only reviewed changes',
      'plan does not create an agent, grant permissions, certify a skill, or prove deployed state'],
  }
}

export function checkEnvironment(input, env) {
  const m = validateManifest(input)
  requireThat(m.budget.billingPeriod === new Date().toISOString().slice(0, 7), 'budget billingPeriod is not the current UTC period')
  for (const name of SECRET_NAMES) requireThat(typeof env[name] === 'string' && env[name].trim().length >= 32 && !/replace|placeholder|change-me|changeme/iu.test(env[name]), `${name} is missing or invalid`)
  const tokens = TOKEN_NAMES.map((name) => env[name])
  if (env.STDB_SERVER_TOKEN) tokens.push(env.STDB_SERVER_TOKEN)
  requireThat(new Set(tokens).size === tokens.length, 'gateway, spend-reader, certification and any owner tokens must differ')
  requireThat(!env.KONG_LLM_URL?.trim(), 'direct Mistral pilot requires KONG_LLM_URL to be unset')
  requireThat(env.STDB_MODULE === m.deployment.stdbModule, 'STDB_MODULE differs from manifest')
  requireThat(env.AI_CERTIFICATION_RUNTIME_HASH === m.runtimeHash, 'certification runtime digest differs from manifest')
  requireThat(env.LUMIERE_ENV === 'production' && env.LUMIERE_BIN === 'gateway', 'pilot requires the production gateway runtime')
  let url
  try { url = new URL(env.STDB_HOST) } catch { throw new Error('STDB_HOST is invalid') }
  requireThat(!url.username && !url.password && !url.search && !url.hash && (url.pathname === '/' || url.pathname === ''), 'STDB_HOST must be a credential-free origin')
  requireThat(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname.endsWith('.railway.internal')), 'STDB_HOST requires HTTPS or Railway private HTTP')
  return { configuration: 'passed', deploymentAcceptance: false,
    unverified: ['deployed commit/contracts/region', 'writer reserve/settle grants', 'active skill release and capability admission',
      'agent/company/model/policy binding', 'certification runtime registration', 'provider completion and spend settlement', 'browser denial/reconnect/recovery'],
    providerDependencies: { embedding: env.EMBEDDING_PROVIDER ?? 'ollama', vision: env.VISION_PROVIDER ?? 'ollama' } }
}

async function safeResponse(fetchImpl, url, init, label) {
  let response
  try { response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) }) }
  catch { throw new Error(`${label} request failed; response details suppressed`) }
  requireThat(response.ok, `${label} returned HTTP ${response.status}`)
  let payload
  try { payload = await response.json() } catch { throw new Error(`${label} returned invalid JSON`) }
  return { payload, response }
}

export async function checkCatalog(input, env, fetchImpl = fetch) {
  checkEnvironment(input, env)
  const { payload } = await safeResponse(fetchImpl, 'https://api.mistral.ai/v1/models',
    { method: 'GET', headers: { Authorization: `Bearer ${env.MISTRAL_API_KEY}` } }, 'Mistral catalog')
  requireThat(Array.isArray(payload?.data), 'Mistral catalog response has no model list')
  for (const profile of input.profiles) {
    const entry = payload.data.filter((model) => model.id === profile.model)
    requireThat(entry.length === 1 && entry[0].capabilities?.completion_chat === true && entry[0].capabilities?.function_calling === true,
      'a declared model is absent or lacks chat/function calling in the account catalog')
    requireThat(Number.isSafeInteger(entry[0].max_context_length) && entry[0].max_context_length >= profile.contextWindow, 'profile context exceeds account catalog model limit')
  }
  return { catalog: 'passed', generationAttempted: false, deploymentAcceptance: false }
}

export async function checkIdentities(input, env, fetchImpl = fetch) {
  checkEnvironment(input, env)
  const names = ['writer', 'spendReader', 'certification']
  for (let index = 0; index < TOKEN_NAMES.length; index += 1) {
    const { response } = await safeResponse(fetchImpl, `${env.STDB_HOST.replace(/\/$/u, '')}/v1/database/${encodeURIComponent(env.STDB_MODULE)}/sql`, {
      method: 'POST', headers: { Authorization: `Bearer ${env[TOKEN_NAMES[index]]}`, 'Content-Type': 'text/plain' },
      body: `SELECT id FROM organization WHERE id = ${input.organizationId} LIMIT 1`,
    }, 'SpacetimeDB identity check')
    requireThat(normalizeIdentity(response.headers.get('spacetime-identity')) === input.identities[names[index]], 'server-verified identity differs from manifest')
  }
  const { payload } = await safeResponse(fetchImpl, `${env.STDB_HOST.replace(/\/$/u, '')}/v1/database/${encodeURIComponent(env.STDB_MODULE)}/sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.AI_SPEND_READ_STDB_TOKEN}`, 'Content-Type': 'text/plain' },
    body: `SELECT currency, limit_units FROM ai_spend_budget_read WHERE organization_id = ${input.organizationId} AND agent_id = ${input.agentId} AND billing_period = '${input.budget.billingPeriod}' LIMIT 2`,
  }, 'SpacetimeDB spend-reader check')
  const rows = decodeSqlRows(payload)
  requireThat(rows.length === 1 && rows[0].currency === input.budget.currency && String(rows[0].limit_units) === String(input.budget.limitMicrounits), 'sender-scoped spend budget is absent, ambiguous or differs from manifest')
  return { identities: 'passed', spendReaderBudget: 'passed', deploymentAcceptance: false }
}

async function main() {
  const [mode, filename, ...flags] = process.argv.slice(2)
  requireThat(['plan', 'check'].includes(mode) && filename && flags.every((flag) => ['--catalog', '--identities'].includes(flag)) && (mode === 'check' || flags.length === 0),
    'usage: mistral-alpha-preflight.mjs plan|check manifest.json [--catalog] [--identities]')
  let manifest
  try { manifest = JSON.parse(await fs.readFile(filename, 'utf8')) } catch { throw new Error('manifest could not be read as JSON') }
  const output = mode === 'plan' ? provisioningPlan(manifest) : checkEnvironment(manifest, process.env)
  if (flags.includes('--catalog')) output.catalogCheck = await checkCatalog(manifest, process.env)
  if (flags.includes('--identities')) output.identityCheck = await checkIdentities(manifest, process.env)
  console.log(JSON.stringify(output, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`[mistral-alpha-preflight] ${error.message}`); process.exitCode = 1 })
}
