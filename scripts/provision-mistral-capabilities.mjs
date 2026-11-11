#!/usr/bin/env node
// Reviewed setup only: no provider request, new agent, budget, credit or certificate.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { httpClient, unwrap } from './provision-ai-harness.mjs'

const infrastructure = new Map([
  ['document_ocr', 'ocr'], ['document_embeddings', 'embedding_index'],
  ['activity_indexing', 'embedding_index'], ['embedding_query', 'embedding_query'],
])
const check = (condition, message) => { if (!condition) throw new Error(message) }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = (value, name) => { check(Number.isSafeInteger(value) && value > 0, `invalid ${name}`); return value }
const fields = (value, allowed, name) => check(plain(value) && Object.keys(value).every(key => allowed.includes(key)), `unknown ${name} field`)
const label = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)
const exactModel = value => label(value) && !/latest/i.test(value) && !/^(REPLACE|PLACEHOLDER|ACCOUNT_VISIBLE)/i.test(value)
const hash = value => typeof value === 'string' && /^(sha256:)?[a-f0-9]{64}$/.test(value)
const sameHash = (a, b) => hash(a) && hash(b) && a.replace(/^sha256:/, '') === b.replace(/^sha256:/, '')
const integer = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0
const number = (value, name) => { check(integer(value), `invalid ${name}`); return Number(value) }
const budgetSnapshot = rows => [...rows].sort((a, b) =>
  number(a.agent_id, 'budget agent') - number(b.agent_id, 'budget agent')
  || number(a.id, 'budget id') - number(b.id, 'budget id'))
const one = (rows, name) => { check(rows.length === 1, `${name} must resolve exactly once`); return rows[0] }
const none = () => ({ none: [] })
const some = value => ({ some: value })
const parsedObject = (raw, name) => {
  let value
  try { value = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { throw new Error(`invalid ${name}`) }
  check(plain(value), `invalid ${name}`)
  return value
}
const passed = value => typeof value === 'string' ? value.toLowerCase() === 'passed'
  // Raw SpacetimeDB SQL encodes AiSkillTestRunStatus::Passed as [0, []].
  : Array.isArray(value) ? value.length === 2 && value[0] === 0
    && Array.isArray(value[1]) && value[1].length === 0
  : plain(value) && Object.keys(value).length === 1 && ['Passed', 'passed'].some(key => Array.isArray(value[key]) && value[key].length === 0)

export function validateManifest(config) {
  fields(config, ['version', 'organizationId', 'companyId', 'agentId', 'intelligencePolicyRef',
    'currency', 'pricesReviewedAt', 'surfaces', 'meters', 'agentCapabilities'], 'manifest')
  if (config.agentCapabilities !== undefined) {
    fields(config.agentCapabilities, ['addModels', 'addActions'], 'agentCapabilities')
    for (const [key, allowed] of Object.entries({ addModels: ['mistral-embed'], addActions: ['embedding_query', 'embedding_index'] })) {
      const items = config.agentCapabilities[key] ?? []
      check(Array.isArray(items) && items.every(item => allowed.includes(item)) && new Set(items).size === items.length,
        `unknown or duplicate reviewed ${key}`)
    }
    check(!config.surfaces?.some(surface => surface.skillKey === 'document_ocr')
      && !config.meters?.some(meter => meter.unit === 'pages'), 'reviewed capability additions are limited to non-OCR repair')
  }
  check(config.version === 1, 'unsupported manifest version')
  for (const key of ['organizationId', 'companyId', 'agentId']) id(config[key], key)
  check(typeof config.intelligencePolicyRef === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}@[1-9][0-9]{0,9}$/.test(config.intelligencePolicyRef), 'exact intelligencePolicyRef is required')
  check(/^[A-Z]{3}$/.test(config.currency), 'invalid currency')
  check(typeof config.pricesReviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(config.pricesReviewedAt)
    && Number.isFinite(Date.parse(config.pricesReviewedAt))
    && new Date(config.pricesReviewedAt).toISOString().slice(0, 10) === config.pricesReviewedAt, 'reviewed prices date is required')
  check(Array.isArray(config.surfaces) && config.surfaces.length > 0 && config.surfaces.length <= 32, 'bounded surfaces are required')
  const keys = new Set(), ids = new Set()
  for (const surface of config.surfaces) {
    fields(surface, ['skillKey', 'skillId', 'sourceHash'], 'surface')
    check(label(surface.skillKey), 'invalid surface key'); id(surface.skillId, 'skillId')
    check(!keys.has(surface.skillKey) && !ids.has(surface.skillId), 'duplicate surface')
    keys.add(surface.skillKey); ids.add(surface.skillId)
    check(infrastructure.has(surface.skillKey) ? surface.sourceHash === undefined : hash(surface.sourceHash),
      'generative surfaces require exact sourceHash; infrastructure bindings do not assert certification')
  }
  check(Array.isArray(config.meters) && config.meters.length <= 8, 'bounded meters are required')
  const meters = new Set()
  for (const meter of config.meters) {
    fields(meter, ['model', 'unit', 'unitsPer1k'], 'meter')
    check(exactModel(meter.model), 'meter needs an exact reviewed Mistral model')
    check((meter.unit === 'tokens' && meter.model === 'mistral-embed')
      || (meter.unit === 'pages' && meter.model.startsWith('mistral-ocr-')), 'model does not support meter')
    id(meter.unitsPer1k, 'unitsPer1k'); check(meter.unitsPer1k <= 1_000_000_000_000, 'meter price exceeds bound')
    const key = `${meter.model}:${meter.unit}`
    check(!meters.has(key), 'duplicate meter'); meters.add(key)
  }
  if (keys.has('document_ocr')) check(config.meters.some(meter => meter.unit === 'pages'), 'OCR requires a reviewed page meter')
  if ([...keys].some(key => ['document_embeddings', 'activity_indexing', 'embedding_query', 'rag_generation'].includes(key))) {
    check(config.meters.some(meter => meter.model === 'mistral-embed'), 'semantic surfaces require a reviewed embedding meter')
  }
  return config
}

export function planCapabilities(config) {
  validateManifest(config)
  return { organizationId: config.organizationId, companyId: config.companyId, agentId: config.agentId,
    intelligencePolicyRef: config.intelligencePolicyRef, currency: config.currency, pricesReviewedAt: config.pricesReviewedAt,
    surfaces: config.surfaces, meters: config.meters, billableCalls: 0, deploymentAcceptance: false,
    agentCapabilities: config.agentCapabilities,
    writes: [...(config.agentCapabilities ? ['missing reviewed set_ai_agent_model', 'missing reviewed set_ai_agent_action'] : []),
      'missing configure_ai_metered_price', 'missing company upsert_ai_skill_config'],
    remainingGates: ['immutable contract release and aligned deployment', 'provider usage and billing acceptance', 'signed-in company isolation and recovery acceptance'],
    prerequisites: ['existing company-compatible agent and current-month monetary pool', 'reviewed model policy', 'exact platform-registered ai_spend_writer matching the gateway identity',
      'matching active certificates for generative surfaces', 'explicit existing infrastructure skill catalog entries'] }
}

function requiredAction(skillKey) {
  if (infrastructure.has(skillKey)) return infrastructure.get(skillKey)
  if (skillKey === 'rag_generation') return 'chat'
  if (skillKey === 'form_suggestion') return 'form_suggest'
  if (skillKey === 'action_draft_generation') return 'action_draft'
  return 'skill_run'
}

function permits(actions, action) {
  if (actions.includes(action)) return true
  if (action === 'form_suggest') return actions.includes('summarize')
  if (action === 'action_draft') return actions.some(value => ['chat', 'summarize', 'form_suggest'].includes(value))
  if (action === 'skill_run') return actions.some(value => ['chat', 'summarize'].includes(value))
  return false
}

async function inspectCapabilities(config, client, now) {
  const org = config.organizationId, companyId = config.companyId, agentId = config.agentId
  await client.verifyTarget(org)
  const writerIdentity = await client.writerIdentity()
  check(typeof writerIdentity === 'string' && /^[a-f0-9]{64}$/.test(writerIdentity), 'spend writer identity not verified by server')
  const writers = await client.sql(`SELECT organization_id, service_name, identity, is_active FROM cold_tier_service_identity WHERE organization_id = ${org} AND service_name = 'ai_spend_writer' AND is_active = true`)
  const writer = one(writers, 'active platform spend writer binding')
  const rawWriterIdentity = Array.isArray(writer.identity) && writer.identity.length === 1 ? writer.identity[0] : unwrap(writer.identity)
  const registeredIdentity = (typeof rawWriterIdentity === 'string' ? rawWriterIdentity : rawWriterIdentity?.__identity__)?.replace(/^0x/, '').toLowerCase()
  check(number(writer.organization_id, 'writer organization') === org && writer.service_name === 'ai_spend_writer'
    && writer.is_active === true && registeredIdentity === writerIdentity, 'platform spend writer binding does not match the gateway identity')
  const company = one(await client.sql(`SELECT id, organization_id FROM company WHERE id = ${companyId}`), 'company')
  check(number(company.id, 'company id') === companyId && number(company.organization_id, 'company organization') === org, 'company scope mismatch')
  const agent = structuredClone(one(await client.sql(`SELECT * FROM ai_agent WHERE organization_id = ${org} AND id = ${agentId}`), 'Mistral agent'))
  check(number(agent.organization_id, 'agent organization') === org && number(agent.id, 'agent id') === agentId
    && agent.is_active === true && agent.provider === 'mistral', 'active Mistral agent required')
  const agentCompanyId = unwrap(agent.company_id)
  const matchesCompany = agentCompanyId === companyId || agentCompanyId === String(companyId)
  check(agentCompanyId === null || matchesCompany, 'agent is outside the requested company scope')
  check(Array.isArray(agent.allowed_models) && agent.allowed_models.includes(agent.model)
    && agent.allowed_models.every(exactModel), 'agent model allowlist is invalid')
  check(Array.isArray(agent.allowed_actions), 'agent action allowlist is invalid')
  const originalAgent = structuredClone(agent)
  const capabilityWrites = []
  for (const [key, column, reducer] of [['addModels', 'allowed_models', 'set_ai_agent_model'], ['addActions', 'allowed_actions', 'set_ai_agent_action']]) {
    for (const item of config.agentCapabilities?.[key] ?? []) {
      if (!agent[column].includes(item)) capabilityWrites.push({ reducer, item })
    }
  }
  // Never modify the read snapshot (including clients backed by an in-memory cache).
  agent.allowed_models = [...agent.allowed_models]
  agent.allowed_actions = [...agent.allowed_actions]
  for (const { reducer, item } of capabilityWrites) agent[reducer === 'set_ai_agent_model' ? 'allowed_models' : 'allowed_actions'].push(item)
  for (const meter of config.meters) check(agent.allowed_models.includes(meter.model), 'metered model is not allowed for the agent')
  for (const surface of config.surfaces) check(permits(agent.allowed_actions, requiredAction(surface.skillKey)), `agent action is not allowed for ${surface.skillKey}`)
  if (config.surfaces.some(surface => surface.skillKey === 'rag_generation')) {
    check(permits(agent.allowed_actions, 'embedding_query'), 'rag_generation requires the embedding_query agent action')
  }

  const period = now.toISOString().slice(0, 7)
  check(config.pricesReviewedAt <= now.toISOString().slice(0, 10), 'pricing review date is in the future')
  const budgets = await client.sql(`SELECT * FROM ai_spend_budget_read WHERE organization_id = ${org} AND billing_period = '${period}'`, 'spend')
  check(budgets.every(row => number(row.organization_id, 'budget organization') === org && row.billing_period === period), 'budget read scope mismatch')
  const budget = one(budgets.filter(row => number(row.agent_id, 'budget agent') === agentId), 'current-period shared pool')
  check(budget.currency === config.currency && number(budget.limit_units, 'limit') > 0, 'shared pool currency or allowance mismatch')
  check(BigInt(number(budget.settled_units, 'settled')) + BigInt(number(budget.outstanding_units, 'held')) < BigInt(number(budget.limit_units, 'limit')), 'shared pool has no valid remaining allowance')
  check(!budgets.some(row => number(row.agent_id, 'budget agent') !== agentId &&
    ['limit_units', 'settled_units', 'outstanding_units'].some(key => number(row[key], key) > 0)), 'another monetary pool exists; consolidate through its canonical owner first')

  const owners = await client.sql(`SELECT agent_id, organization_id FROM ai_owner_configuration_read WHERE organization_id = ${org}`, 'spend')
  check(owners.every(row => number(row.organization_id, 'owner pool organization') === org && number(row.agent_id, 'owner pool agent') === agentId), 'another managed monetary pool exists')

  const [policyKey, policyVersion] = config.intelligencePolicyRef.split('@')
  const policy = one(await client.sql(`SELECT * FROM ai_intelligence_policy WHERE organization_id = ${org} AND policy_key = '${policyKey}' AND policy_version = ${Number(policyVersion)}`), 'intelligence policy')
  check(policy.is_active === true && number(policy.organization_id, 'policy organization') === org, 'policy is inactive or outside organization')
  const profileModels = new Map()
  for (const role of ['decision', 'reasoning', 'generation', 'review']) {
    const ref = policy[`default_${role}_profile`]
    check(typeof ref === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}@[1-9][0-9]{0,9}$/.test(ref), 'policy profile ref is invalid')
    const [key, version] = ref.split('@')
    const profile = one(await client.sql(`SELECT * FROM ai_model_profile WHERE organization_id = ${org} AND profile_key = '${key}' AND profile_version = ${Number(version)}`), `${role} profile`)
    check(profile.is_active === true && profile.provider === 'mistral' && agent.allowed_models.includes(profile.model)
      && Array.isArray(profile.allowed_roles) && profile.allowed_roles.includes(role), 'profile provider/model/role mismatch')
    check(number(profile.organization_id, 'profile organization') === org && profile.profile_key === key
      && number(profile.profile_version, 'profile version') === Number(version), 'profile identity mismatch')
    check(number(profile.max_retries, 'profile retries') === 0, 'automatic provider retries are outside this rollout')
    check(number(profile.max_tokens, 'profile output') > 0 && number(profile.max_tokens, 'profile output') <= number(agent.max_tokens, 'agent output')
      && number(profile.context_window, 'profile context') <= number(agent.context_window, 'agent context'), 'profile limits exceed agent limits')
    profileModels.set(role, profile.model)
  }
  check(profileModels.get('review') !== profileModels.get('generation'), 'independent review requires a distinct model')
  check(Array.isArray(policy.shadow_profiles) && policy.shadow_profiles.length === 0, 'shadow dispatch is outside this rollout')
  check(Object.keys(parsedObject(policy.fallback_profiles_json, 'fallback profiles')).length === 0, 'fallback dispatch is outside this rollout')

  const bindingWrites = [], priceWrites = [], missing = []
  for (const surface of config.surfaces) {
    const skill = one(await client.sql(`SELECT * FROM ai_skill WHERE id = ${surface.skillId}`), `${surface.skillKey} catalog entry`)
    check(number(skill.id, 'skill id') === surface.skillId && skill.skill_key === surface.skillKey && skill.is_active === true
      && [0, org].includes(number(skill.organization_id, 'skill organization')), 'skill catalog scope/key mismatch')
    if (!infrastructure.has(surface.skillKey)) {
      const release = one(await client.sql(`SELECT * FROM ai_skill_release WHERE organization_id = ${org} AND skill_id = ${surface.skillId} AND is_active = true`), `${surface.skillKey} active release`)
      check(release.is_active === true && number(release.organization_id, 'release organization') === org
        && number(release.skill_id, 'release skill') === surface.skillId, 'active release scope mismatch')
      const versionId = id(number(release.skill_version_id, 'released version'), 'released version')
      const version = one(await client.sql(`SELECT * FROM ai_skill_version WHERE organization_id = ${org} AND id = ${versionId}`), 'released version')
      check(number(version.organization_id, 'version organization') === org && number(version.id, 'version id') === versionId
        && number(version.skill_id, 'version skill') === surface.skillId && version.skill_key === surface.skillKey
        && sameHash(version.source_hash, surface.sourceHash), 'active source hash differs from reviewed runtime source')
      const fixtures = await client.sql(`SELECT id, organization_id, skill_id FROM ai_skill_fixture WHERE organization_id = ${org} AND skill_id = ${surface.skillId}`)
      check(fixtures.length > 0 && new Set(fixtures.map(row => id(number(row.id, 'fixture id'), 'fixture id'))).size === fixtures.length,
        'released skill must have unambiguous certification fixtures')
      const evidence = await client.sql(`SELECT * FROM ai_skill_certification_evidence WHERE organization_id = ${org} AND skill_version_id = ${versionId}`)
      for (const fixture of fixtures) {
        check(number(fixture.organization_id, 'fixture organization') === org && number(fixture.skill_id, 'fixture skill') === surface.skillId,
          'certification fixture scope mismatch')
        const matches = evidence.filter(row => number(row.fixture_id, 'certification fixture') === Number(fixture.id))
        check(new Set(matches.map(row => number(row.id, 'certification id'))).size === matches.length, 'ambiguous certification evidence')
        const latest = matches.reduce((a, b) => !a || number(b.id, 'certification id') > number(a.id, 'certification id') ? b : a, null)
        check(latest && number(latest.organization_id, 'certification organization') === org
          && number(latest.company_id, 'certification company') === companyId && number(latest.skill_id, 'certification skill') === surface.skillId
          && number(latest.skill_version_id, 'certification version') === versionId && passed(latest.status)
          && sameHash(latest.source_hash, surface.sourceHash), 'matching current passed company certification is required')
      }
    }
    const rows = await client.sql(`SELECT * FROM ai_skill_config WHERE organization_id = ${org} AND skill_id = ${surface.skillId}`)
    check(rows.every(row => number(row.organization_id, 'binding organization') === org && number(row.skill_id, 'binding skill') === surface.skillId), 'skill binding read scope mismatch')
    const scoped = rows.filter(row => Number(unwrap(row.company_id)) === companyId)
    check(scoped.length <= 1, 'duplicate company skill bindings')
    const inherited = rows.filter(row => unwrap(row.company_id) == null)
    check(inherited.length <= 1, 'duplicate organization skill bindings')
    const previous = scoped[0]
    check((previous ?? inherited[0])?.is_enabled !== false, 'skill is explicitly disabled')
    const priorSettings = previous ?? inherited[0]
    const settings = priorSettings ? parsedObject(priorSettings.config_json, 'skill settings') : {}
    for (const key of ['defaultAgentId', 'default_agent_id']) check(settings[key] == null || Number(settings[key]) === agentId, 'skill is bound to another agent')
    for (const key of ['intelligencePolicyRef', 'intelligence_policy_ref']) check(settings[key] == null || settings[key] === config.intelligencePolicyRef, 'skill is bound to another policy')
    if (!previous || settings.defaultAgentId !== agentId || settings.intelligencePolicyRef !== config.intelligencePolicyRef) {
      bindingWrites.push({ company_id: some(companyId), skill_id: surface.skillId, is_enabled: true,
        config_json: JSON.stringify({ ...settings, defaultAgentId: agentId, intelligencePolicyRef: config.intelligencePolicyRef }),
        custom_instructions: priorSettings?.custom_instructions ?? none(), tool_overrides: priorSettings?.tool_overrides ?? [], metadata: priorSettings?.metadata ?? none() })
      missing.push(`binding:${surface.skillKey}`)
    }
  }
  for (const meter of config.meters) {
    const prices = await client.sql(`SELECT id, organization_id, agent_id, model, unit, currency, units_per_1_k, version FROM ai_metered_price_read WHERE organization_id = ${org} AND agent_id = ${agentId} AND model = '${meter.model}' AND unit = '${meter.unit}'`, 'spend')
    check(prices.every(row => number(row.organization_id, 'price organization') === org && number(row.agent_id, 'price agent') === agentId
      && row.model === meter.model && row.unit === meter.unit && row.currency === config.currency), 'metered price scope/currency mismatch')
    check(new Set(prices.map(row => number(row.version, 'price version'))).size === prices.length, 'duplicate metered price versions')
    const latest = prices.reduce((a, b) => !a || number(b.version, 'price version') > number(a.version, 'price version') ? b : a, null)
    check(!latest || number(latest.units_per_1_k, 'metered rate') === meter.unitsPer1k, 'metered price differs; review a separate immutable price update')
    if (!latest) { priceWrites.push({ model: meter.model, unit: meter.unit, currency: config.currency, units_per_1_k: meter.unitsPer1k }); missing.push(`meter:${meter.model}:${meter.unit}`) }
  }
  missing.unshift(...capabilityWrites.map(write => `${write.reducer}:${write.item}`))
  if (capabilityWrites.length) {
    check(typeof client.verifyActivationAuthority === 'function', 'native operator authority and deployed toggle schema probe required before capability writes')
    await client.verifyActivationAuthority(org, agentId, priceWrites.length > 0)
  }
  return { bindingWrites, priceWrites, capabilityWrites, originalAgent, budgets: structuredClone(budgets), missing, billingPeriod: period }
}

export async function provisionCapabilities(config, client, apply = false, now = new Date()) {
  validateManifest(config)
  const inspection = await inspectCapabilities(config, client, now)
  if (apply) {
    // Every structural prerequisite was checked before the first mutation.
    // An uncertain response stops immediately; check durable state before retry.
    for (const toggle of inspection.capabilityWrites) await client.call(toggle.reducer, [config.organizationId, config.agentId, toggle.item, true])
    if (inspection.capabilityWrites.length) {
      const actual = one(await client.sql(`SELECT * FROM ai_agent WHERE organization_id = ${config.organizationId} AND id = ${config.agentId}`), 'updated agent')
      const expected = structuredClone(inspection.originalAgent)
      for (const { reducer, item } of inspection.capabilityWrites) expected[reducer === 'set_ai_agent_model' ? 'allowed_models' : 'allowed_actions'].push(item)
      for (const key of Object.keys(expected).filter(key => !['write_uid', 'write_date'].includes(key))) {
        check(JSON.stringify(actual[key]) === JSON.stringify(expected[key]), 'agent readback differs; inspect durable state before retry')
      }
    }
    for (const price of inspection.priceWrites) await client.call('configure_ai_metered_price', [config.organizationId, config.agentId, price])
    for (const binding of inspection.bindingWrites) await client.call('upsert_ai_skill_config', [config.organizationId, binding])
    const verified = await inspectCapabilities(config, client, now)
    check(verified.missing.length === 0, 'provisioned capability readback differs; inspect durable state before retry')
    check(JSON.stringify(budgetSnapshot(verified.budgets)) === JSON.stringify(budgetSnapshot(inspection.budgets)),
      'pool readback changed during provisioning; inspect durable state before retry')
  }
  return { organizationId: config.organizationId, companyId: config.companyId, agentId: config.agentId,
    billingPeriod: inspection.billingPeriod, applied: apply, ready: apply || inspection.missing.length === 0,
    missing: apply ? [] : inspection.missing, billableCalls: 0, deploymentAcceptance: false }
}

async function main() {
  const [mode, filename, ...extra] = process.argv.slice(2)
  check(['--plan', '--check', '--apply'].includes(mode) && filename && extra.length === 0,
    'usage: node scripts/provision-mistral-capabilities.mjs --plan|--check|--apply manifest.json|--env')
  const raw = filename === '--env' ? process.env.MISTRAL_CAPABILITIES_MANIFEST_JSON : await readFile(filename, 'utf8')
  check(typeof raw === 'string' && raw.trim(), 'missing capability manifest')
  let config
  try { config = JSON.parse(raw) } catch { throw new Error('manifest contains invalid JSON') }
  const result = mode === '--plan' ? planCapabilities(config)
    : await provisionCapabilities(config, httpClient(process.env), mode === '--apply')
  console.log(JSON.stringify(result, null, 2))
  if (mode === '--check' && !result.ready) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
