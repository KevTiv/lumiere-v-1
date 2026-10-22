import { randomBytes } from 'node:crypto'

export const IDENTITY_TARGETS = Object.freeze([
  {
    secretName: 'STDB_FINALIZATION_TOKEN',
    services: ['projection-worker'],
    bindings: ['projection_worker', 'pos_order_hydrator'],
  },
  {
    secretName: 'STDB_OWNER_REPORT_WORKER_TOKEN',
    services: ['owner-report-worker'],
    bindings: ['owner_report_worker'],
  },
  {
    secretName: 'STDB_WORKFLOW_WORKER_TOKEN',
    services: ['workflow-worker'],
    bindings: ['workflow_worker'],
  },
  {
    secretName: 'STDB_EXPENSE_WORKER_TOKEN',
    services: ['expense-integration-worker'],
    bindings: ['expense_integration_worker'],
  },
  {
    secretName: 'STDB_HR_WORKER_TOKEN',
    services: ['hr-integration-worker'],
    bindings: ['hr_integration_worker'],
  },
  {
    secretName: 'STDB_PROJECT_WORKER_TOKEN',
    services: ['project-integration-worker'],
    bindings: ['project_integration_worker'],
  },
  {
    secretName: 'STDB_IOT_GATEWAY_TOKEN',
    services: ['iot-gateway'],
    bindings: ['iot_gateway'],
  },
  {
    secretName: 'AI_SPEND_READ_STDB_TOKEN',
    services: ['ai-gateway'],
    bindings: ['ai_spend_reader'],
  },
  {
    secretName: 'STDB_TOKEN',
    services: ['ai-gateway'],
    bindings: [],
  },
  {
    secretName: 'AI_CERTIFICATION_STDB_TOKEN',
    services: ['ai-gateway'],
    bindings: [],
    certificationExecutor: true,
  },
])

const SHARED_SECRETS = Object.freeze({
  'api-server': ['STDB_SERVER_TOKEN', 'STDB_CREDENTIAL_ENCRYPTION_KEY', 'LUMIERE_AI_GATEWAY_INTERNAL_SECRET'],
  web: ['STDB_SERVER_TOKEN', 'LUMIERE_AI_GATEWAY_INTERNAL_SECRET'],
  'workflow-worker': ['STDB_SERVER_TOKEN'],
  'projection-worker': ['STDB_SERVER_TOKEN'],
  'ai-gateway': ['LUMIERE_AI_GATEWAY_INTERNAL_SECRET', 'AI_EXECUTION_ENVELOPE_KEY'],
})

function required(value, name) {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function assertSafeRunId(value) {
  const runId = required(value, 'LUMIERE_IDENTITY_RUN_ID')
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(runId)) {
    throw new Error('LUMIERE_IDENTITY_RUN_ID must be 3-64 lowercase letters, digits, dots, underscores, or dashes')
  }
  return runId
}

export function normalizeIdentity(value) {
  if (Array.isArray(value) && value.length === 1) return normalizeIdentity(value[0])
  if (typeof value === 'string') {
    const normalized = value.replace(/^0x/iu, '').toLowerCase()
    return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : ''
  }
  if (value && typeof value === 'object' && '__identity__' in value) {
    return normalizeIdentity(value.__identity__)
  }
  return ''
}

function elementName(element) {
  const name = element?.name
  return name && typeof name === 'object' && typeof name.some === 'string' ? name.some : ''
}

function unwrapSats(value) {
  if (Array.isArray(value) && value.length === 2 && value[0] === 0) return unwrapSats(value[1])
  if (Array.isArray(value) && value.length === 1 && value[0] === 1) return undefined
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('some' in value) return unwrapSats(value.some)
    if ('none' in value) return undefined
  }
  return value
}

export function decodeSqlRows(resultSets) {
  const result = Array.isArray(resultSets) ? resultSets[0] : undefined
  if (!result?.rows?.length) return []
  if (!Array.isArray(result.schema?.elements)) throw new Error('SpacetimeDB SQL response lacks schema elements')
  return result.rows.map((row) => {
    const decoded = {}
    result.schema.elements.forEach((element, index) => {
      const name = elementName(element)
      if (name) decoded[name] = unwrapSats(row[index])
    })
    return decoded
  })
}

async function responseBody(response, { redactErrorBody = false } = {}) {
  const text = await response.text()
  if (!response.ok) {
    const detail = redactErrorBody ? '' : `: ${text.slice(0, 500)}`
    throw new Error(`request failed (${response.status})${detail}`)
  }
  return text
}

export function createSpacetimeClient({ fetchImpl = fetch, host, moduleName, adminToken }) {
  const baseUrl = required(host, 'STDB_HOST').replace(/\/$/u, '')
  const database = encodeURIComponent(required(moduleName, 'STDB_MODULE'))
  const ownerToken = required(adminToken, 'STDB_SERVER_TOKEN')

  async function sql(token, statement) {
    const response = await fetchImpl(`${baseUrl}/v1/database/${database}/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: statement,
    })
    const text = await responseBody(response)
    const identity = normalizeIdentity(response.headers.get('spacetime-identity'))
    return { identity, rows: decodeSqlRows(JSON.parse(text)) }
  }

  async function reducer(token, name, args) {
    const response = await fetchImpl(`${baseUrl}/v1/database/${database}/call/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    await responseBody(response)
  }

  return {
    async verifyOwner() {
      const probe = await sql(ownerToken, 'SELECT id FROM organization LIMIT 1')
      if (!probe.identity) throw new Error('SpacetimeDB did not verify STDB_SERVER_TOKEN')
      return probe.identity
    },
    async organizations() {
      const organizations = (await sql(ownerToken, 'SELECT id FROM organization')).rows.map(({ id }) => Number(id))
      if (organizations.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        throw new Error('SpacetimeDB returned an invalid organization id')
      }
      return organizations
    },
    async mintIdentity() {
      const response = await fetchImpl(`${baseUrl}/v1/identity`, { method: 'POST' })
      const payload = JSON.parse(await responseBody(response))
      const token = required(payload.token, 'SpacetimeDB identity token')
      const probe = await sql(token, 'SELECT id FROM organization LIMIT 1')
      if (!probe.identity) throw new Error('SpacetimeDB did not verify a newly issued identity')
      return { identity: probe.identity, token }
    },
    async registerBinding({ organizationId, runId, serviceName, identity }) {
      await reducer(ownerToken, 'register_cold_tier_service_identity', [
        organizationId,
        `production-${serviceName}-org${organizationId}-${runId}-${identity.slice(0, 12)}`.slice(0, 128),
        serviceName,
        { __identity__: `0x${identity}` },
      ])
    },
    async registerCertificationProfile({ organizationId, runId, runtimeHash, identity }) {
      await reducer(ownerToken, 'register_ai_skill_certification_runtime_profile', [
        organizationId,
        {
          profile_key: `production-${runId}`,
          runtime_hash: runtimeHash,
          executor_identity: { __identity__: `0x${identity}` },
          metadata: JSON.stringify({ source: 'production-identity-bootstrap', runId }),
        },
      ])
    },
  }
}

export function createDopplerClient({ fetchImpl = fetch, apiToken, project }) {
  const token = required(apiToken, 'DOPPLER_API_TOKEN')
  const projectSlug = required(project, 'DOPPLER_PROJECT')
  return {
    async writeSecrets(config, secrets) {
      const url = new URL('https://api.doppler.com/v3/configs/config/secrets')
      url.searchParams.set('project', projectSlug)
      url.searchParams.set('config', config)
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ secrets }),
      })
      await responseBody(response, { redactErrorBody: true })
    },
  }
}

export function parseConfigMap(value) {
  let parsed
  try {
    parsed = JSON.parse(required(value, 'DOPPLER_CONFIG_MAP_JSON'))
  } catch (error) {
    throw new Error(`DOPPLER_CONFIG_MAP_JSON must be valid JSON: ${error.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DOPPLER_CONFIG_MAP_JSON must be an object of service names to Doppler config names')
  }
  const result = new Map()
  for (const [service, config] of Object.entries(parsed)) {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(service) || typeof config !== 'string' || !config.trim()) {
      throw new Error(`invalid Doppler config mapping for ${service}`)
    }
    result.set(service, config.trim())
  }
  return result
}

export function buildServiceSecrets({ issued, targets = IDENTITY_TARGETS, adminToken, runtimeHash, bootstrapSecrets }) {
  const byService = new Map()
  const assign = (service, name, value) => {
    if (!byService.has(service)) byService.set(service, {})
    byService.get(service)[name] = value
  }
  for (const target of targets) {
    const credential = issued.get(target.secretName)
    if (!credential) throw new Error(`missing issued credential ${target.secretName}`)
    for (const service of target.services) assign(service, target.secretName, credential.token)
  }
  for (const [service, names] of Object.entries(SHARED_SECRETS)) {
    for (const name of names) {
      const value = name === 'STDB_SERVER_TOKEN' ? adminToken : bootstrapSecrets[name]
      if (value) assign(service, name, value)
    }
  }
  assign('ai-gateway', 'AI_CERTIFICATION_RUNTIME_HASH', runtimeHash)
  return byService
}

export function generateBootstrapSecrets() {
  return {
    STDB_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    LUMIERE_AI_GATEWAY_INTERNAL_SECRET: randomBytes(32).toString('base64url'),
    AI_EXECUTION_ENVELOPE_KEY: randomBytes(32).toString('base64url'),
  }
}

export async function bootstrapProductionIdentities({
  env,
  fetchImpl = fetch,
  logger = console,
  apply = false,
  mode = 'bootstrap',
}) {
  if (!['bootstrap', 'rotate'].includes(mode)) throw new Error('mode must be bootstrap or rotate')
  if (mode === 'rotate' && env.LUMIERE_ROTATION_DRAINED !== '1') {
    throw new Error('rotation requires LUMIERE_ROTATION_DRAINED=1 after affected workers are drained')
  }
  const runId = assertSafeRunId(env.LUMIERE_IDENTITY_RUN_ID)
  const runtimeHash = required(env.AI_CERTIFICATION_RUNTIME_HASH, 'AI_CERTIFICATION_RUNTIME_HASH')
  if (!/^sha256:[0-9a-f]{64}$/u.test(runtimeHash)) {
    throw new Error('AI_CERTIFICATION_RUNTIME_HASH must be sha256: plus 64 lowercase hex characters')
  }
  const configMap = parseConfigMap(env.DOPPLER_CONFIG_MAP_JSON)
  const selectedTargets = IDENTITY_TARGETS.filter((target) => target.services.some((service) => configMap.has(service)))
  if (selectedTargets.length === 0) throw new Error('DOPPLER_CONFIG_MAP_JSON does not select any identity-consuming service')

  const initializeNonRotatingSecrets = mode === 'bootstrap' && env.LUMIERE_INITIALIZE_NON_ROTATING_SECRETS === '1'
  const plan = {
    mode,
    runId,
    initializeNonRotatingSecrets,
    services: [...configMap.keys()].sort(),
    tokenNames: selectedTargets.map(({ secretName }) => secretName).sort(),
  }
  if (!apply) return plan

  const stdb = createSpacetimeClient({
    fetchImpl,
    host: env.STDB_HOST,
    moduleName: env.STDB_MODULE,
    adminToken: env.STDB_SERVER_TOKEN,
  })
  const ownerIdentity = await stdb.verifyOwner()
  const organizations = await stdb.organizations()
  const issued = new Map()
  for (const target of selectedTargets) issued.set(target.secretName, await stdb.mintIdentity())
  const identities = [ownerIdentity, ...[...issued.values()].map(({ identity }) => identity)]
  if (new Set(identities).size !== identities.length) throw new Error('issued SpacetimeDB identities are not pairwise distinct')

  const bootstrapSecrets = initializeNonRotatingSecrets ? generateBootstrapSecrets() : {}
  const secretsByService = buildServiceSecrets({
    issued,
    targets: selectedTargets,
    adminToken: required(env.STDB_SERVER_TOKEN, 'STDB_SERVER_TOKEN'),
    runtimeHash,
    bootstrapSecrets,
  })
  const doppler = createDopplerClient({
    fetchImpl,
    apiToken: env.DOPPLER_API_TOKEN,
    project: env.DOPPLER_PROJECT,
  })
  for (const [service, config] of configMap) {
    const secrets = secretsByService.get(service)
    if (!secrets || Object.keys(secrets).length === 0) continue
    await doppler.writeSecrets(config, secrets)
    logger.info(`[identity-bootstrap] wrote ${Object.keys(secrets).sort().join(', ')} to Doppler config ${config}`)
  }

  for (const target of selectedTargets) {
    const credential = issued.get(target.secretName)
    for (const organizationId of organizations) {
      for (const serviceName of target.bindings) {
        await stdb.registerBinding({ organizationId, runId, serviceName, identity: credential.identity })
      }
      if (target.certificationExecutor) {
        await stdb.registerCertificationProfile({
          organizationId,
          runId,
          runtimeHash,
          identity: credential.identity,
        })
      }
    }
  }
  logger.info(`[identity-bootstrap] completed ${mode} ${runId}; redeploy ${[...configMap.keys()].sort().join(', ')}`)
  return { ...plan, organizationCount: organizations.length }
}
