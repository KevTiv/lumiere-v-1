#!/usr/bin/env node
// Deployment-owned platform defaults. This manifest contains no credentials.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const ensure = (condition, message) => { if (!condition) throw new Error(message) }
const integer = (value, max = 0xffffffff) => Number.isSafeInteger(value) && value > 0 && value <= max
const label = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(value)
const option = value => value == null ? { none: [] } : { some: value }
const fields = ['templateKey', 'templateVersion', 'generation', 'review', 'skillIds', 'currency',
  'monthlyLimitUnits', 'rateLimitPerMinute', 'maxEnrolledOrganizations']
const profileFields = ['provider', 'model', 'maxTokens', 'contextWindow', 'timeoutMs', 'maxConcurrency',
  'inputUnitsPer1k', 'outputUnitsPer1k']

export function templateParams(config) {
  ensure(config && typeof config === 'object' && !Array.isArray(config)
    && Object.keys(config).every(key => fields.includes(key)), 'unknown platform template field')
  ensure(typeof config.templateKey === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(config.templateKey) && integer(config.templateVersion), 'invalid template identity')
  ensure(/^[A-Z]{3}$/.test(config.currency), 'currency must be an ISO code')
  ensure(integer(config.monthlyLimitUnits, Number.MAX_SAFE_INTEGER), 'invalid monthly allowance')
  ensure(integer(config.rateLimitPerMinute) && integer(config.maxEnrolledOrganizations), 'invalid platform limits')
  ensure(BigInt(config.monthlyLimitUnits) * BigInt(config.maxEnrolledOrganizations) <= 18_446_744_073_709_551_615n, 'platform allowance ceiling overflows')
  ensure(Array.isArray(config.skillIds) && config.skillIds.length === 3
    && config.skillIds.every(id => integer(id, Number.MAX_SAFE_INTEGER))
    && new Set(config.skillIds).size === 3, 'three distinct validated system skill IDs are required')
  const profile = role => {
    const input = config[role]
    ensure(input && typeof input === 'object' && !Array.isArray(input)
      && Object.keys(input).every(key => profileFields.includes(key)), `invalid ${role} profile`)
    ensure(['mistral', 'gemini', 'ollama'].includes(input.provider), `unsupported ${role} provider`)
    ensure(label(input.model) && !/-latest$/i.test(input.model)
      && !/^(ACCOUNT_VISIBLE|REPLACE|PLACEHOLDER)/i.test(input.model), `${role} requires an exact reviewed model`)
    for (const key of profileFields.slice(2)) {
      const valid = key.includes('Units')
        ? Number.isSafeInteger(input[key]) && input[key] >= 0 && input[key] <= 1_000_000_000_000
        : integer(input[key])
      ensure(valid, `invalid ${role}.${key}`)
    }
    ensure(input.maxTokens < input.contextWindow, `${role} output ceiling must leave input capacity`)
    return {
      profile_key: `${config.templateKey}-${role}`, profile_version: config.templateVersion,
      provider: input.provider, model: input.model,
      allowed_roles: role === 'generation' ? ['decision', 'reasoning', 'generation'] : ['review'],
      temperature: option(0), top_p: option(null), max_tokens: input.maxTokens,
      context_window: input.contextWindow, timeout_ms: input.timeoutMs,
      max_retries: 0, max_concurrency: input.maxConcurrency, supports_tool_calling: true,
      supports_structured_output: true, supports_parallel_requests: false,
      input_cost_per_1_k_microunits: option(input.inputUnitsPer1k),
      output_cost_per_1_k_microunits: option(input.outputUnitsPer1k),
      per_request_cost_ceiling_microunits: option(null),
    }
  }
  const generation_profile = profile('generation')
  const review_profile = profile('review')
  ensure(generation_profile.provider === review_profile.provider, 'generation and review must use the same provider')
  ensure(generation_profile.model !== review_profile.model, 'review requires a distinct model')
  return { template_key: config.templateKey, template_version: config.templateVersion,
    generation_profile, review_profile, skill_ids: config.skillIds, currency: config.currency,
    monthly_limit_units: config.monthlyLimitUnits, rate_limit_per_minute: config.rateLimitPerMinute,
    max_enrolled_organizations: config.maxEnrolledOrganizations }
}

export function platformClient(env, fetcher = fetch) {
  const required = key => { ensure(env[key]?.trim(), `missing ${key}`); return env[key].trim() }
  const base = new URL(required('STDB_HOST'))
  ensure(!base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'STDB_HOST must be an origin')
  ensure(base.protocol === 'https:' || (base.protocol === 'http:' &&
    (['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.hostname.endsWith('.railway.internal'))), 'STDB_HOST must use HTTPS or private/loopback HTTP')
  const database = encodeURIComponent(required('STDB_MODULE'))
  const token = required('STDB_SERVER_TOKEN')
  const request = async (path, body, contentType) => {
    const response = await fetcher(`${base.origin}/v1/database/${database}/${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body,
    }).catch(() => { throw new Error('platform setup transport failed; inspect durable state before retry') })
    ensure(response.ok, `platform setup failed: HTTP ${response.status}`)
    return response
  }
  return {
    async call(name, args) { await request(`call/${name}`, JSON.stringify(args), 'application/json') },
    async sql(statement) {
      const response = await request('sql', statement, 'text/plain')
      const results = await response.json().catch(() => { throw new Error('invalid platform SQL response') })
      ensure(Array.isArray(results) && results.length === 1, 'ambiguous platform SQL response')
      const result = results[0]
      ensure(Array.isArray(result?.schema?.elements) && Array.isArray(result.rows), 'invalid platform SQL result')
      const names = result.schema.elements.map(item => item.name?.some)
      ensure(names.every(name => typeof name === 'string'), 'invalid platform SQL schema')
      return result.rows.map(row => {
        ensure(Array.isArray(row) && row.length === names.length, 'invalid platform SQL row')
        return Object.fromEntries(names.map((name, index) => [name, row[index]]))
      })
    },
  }
}

function canonical(value) {
  if (Array.isArray(value)) {
    if (value.length === 2 && (value[0] === 0 || value[0] === 1)) return value[0] === 0 ? canonical(value[1]) : null
    return value.map(canonical)
  }
  if (value && typeof value === 'object') {
    if ('some' in value) return canonical(value.some)
    if ('none' in value) return null
    return Object.fromEntries(Object.keys(value).sort().map(key => [key.replace('_1k_', '_1_k_'), canonical(value[key])]))
  }
  return value
}

function verifyTemplate(row, params) {
  for (const [key, expected] of Object.entries(params)) {
    let actual = row[key]
    if (key === 'generation_profile' || key === 'review_profile') {
      actual ??= row[`${key}_json`]
      if (Array.isArray(actual)) {
        const names = Object.keys(expected)
        ensure(actual.length === names.length, `invalid registered ${key} tuple`)
        actual = Object.fromEntries(names.map((name, index) => [name, actual[index]]))
      }
      if (typeof actual === 'string') {
        try { actual = JSON.parse(actual) } catch { throw new Error(`invalid registered ${key}`) }
      }
    }
    ensure(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)),
      `platform template differs at ${key}; register a new immutable version`)
  }
}

export async function configurePlatform(config, client, mode = '--check') {
  const params = templateParams(config)
  ensure(['--check', '--register', '--activate'].includes(mode), 'invalid platform setup mode')
  const statement = `SELECT * FROM ai_platform_template WHERE template_key = '${params.template_key}' AND template_version = ${params.template_version}`
  let rows = await client.sql(statement)
  ensure(rows.length <= 1, 'platform template is ambiguous')
  if (!rows.length && mode !== '--check') {
    await client.call('register_ai_platform_template', [params])
    rows = await client.sql(statement)
    ensure(rows.length === 1, 'platform template registration is unconfirmed')
  }
  if (!rows.length) return { registered: false, active: false, billableCalls: 0 }
  verifyTemplate(rows[0], params)
  const templateId = Number(rows[0].id)
  ensure(integer(templateId, Number.MAX_SAFE_INTEGER), 'invalid platform template ID')
  if (mode === '--activate') await client.call('set_ai_platform_default', [option(templateId)])
  const defaults = await client.sql('SELECT template_id FROM ai_platform_default WHERE id = 1')
  ensure(defaults.length <= 1, 'platform default is ambiguous')
  const raw = defaults[0]?.template_id
  const selected = canonical(raw)
  const active = Number(selected) === templateId
  ensure(mode !== '--activate' || active, 'platform default activation is unconfirmed')
  return { templateId, registered: true, active, billableCalls: 0 }
}

async function main() {
  const [mode, filename, ...extra] = process.argv.slice(2)
  ensure(['--plan', '--check', '--register', '--activate'].includes(mode) && filename && !extra.length,
    'usage: node scripts/configure-ai-platform.mjs --plan|--check|--register|--activate manifest.json|--env')
  const raw = filename === '--env' ? process.env.AI_PLATFORM_TEMPLATE_JSON : await readFile(filename, 'utf8')
  ensure(raw?.trim(), 'missing AI_PLATFORM_TEMPLATE_JSON')
  let config
  try { config = JSON.parse(raw) } catch { throw new Error('platform template contains invalid JSON') }
  const result = mode === '--plan' ? { params: templateParams(config), billableCalls: 0 }
    : await configurePlatform(config, platformClient(process.env), mode)
  console.log(JSON.stringify(result, null, 2))
  if (mode === '--check' && !result.active) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
