#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const envPath = path.resolve(process.argv[2] ?? path.join(root, '.env.docker'))

function fail(message) {
  console.error(`[register-local-service-identities] ${message}`)
  process.exit(1)
}

function readEnv(file) {
  const values = new Map()
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    values.set(line.slice(0, separator), line.slice(separator + 1))
  }
  return values
}

function required(values, name) {
  const value = values.get(name)?.trim()
  if (!value || value.startsWith('replace-with-')) fail(`${name} is not configured`)
  return value
}

function normalizeIdentity(value) {
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

function decodeRows(resultSets) {
  const result = Array.isArray(resultSets) ? resultSets[0] : undefined
  if (!result?.rows?.length) return []
  const elements = result.schema?.elements
  if (!Array.isArray(elements)) fail('SQL response lacks schema elements')
  return result.rows.map((row) => {
    const decoded = {}
    elements.forEach((element, index) => {
      const name = elementName(element)
      if (name) decoded[name] = unwrapSats(row[index])
    })
    return decoded
  })
}

function isLoopback(url) {
  const hostname = new URL(url).hostname.toLowerCase()
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

const values = readEnv(envPath)
const host = (values.get('STDB_HOST') ?? 'http://127.0.0.1:3000').replace(/\/$/u, '')
if (!isLoopback(host)) fail('STDB_HOST must target loopback')
const moduleName = required(values, 'STDB_MODULE')
const adminToken = required(values, 'STDB_SERVER_TOKEN')
const services = [
  ['STDB_FINALIZATION_TOKEN', 'projection_worker'],
  ['STDB_FINALIZATION_TOKEN', 'pos_order_hydrator'],
  ['STDB_OWNER_REPORT_WORKER_TOKEN', 'owner_report_worker'],
  ['STDB_WORKFLOW_WORKER_TOKEN', 'workflow_worker'],
  ['STDB_EXPENSE_WORKER_TOKEN', 'expense_integration_worker'],
  ['STDB_HR_WORKER_TOKEN', 'hr_integration_worker'],
  ['STDB_PROJECT_WORKER_TOKEN', 'project_integration_worker'],
  ['STDB_IOT_GATEWAY_TOKEN', 'iot_gateway'],
  ['AI_SPEND_READ_STDB_TOKEN', 'ai_spend_reader'],
].map(([tokenName, service]) => ({ tokenName, service, token: required(values, tokenName) }))

const distinctTokens = new Set([adminToken, ...services.map(({ token }) => token)])
if (distinctTokens.size !== 1 + new Set(services.map(({ tokenName }) => tokenName)).size) {
  fail('admin and dedicated worker tokens must be pairwise distinct')
}

async function sql(token, statement) {
  const response = await fetch(`${host}/v1/database/${moduleName}/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: statement,
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`SQL failed (${response.status}): ${body}`)
  return { rows: decodeRows(JSON.parse(body)), identity: normalizeIdentity(response.headers.get('spacetime-identity')) }
}

async function reducer(token, name, args) {
  const response = await fetch(`${host}/v1/database/${moduleName}/call/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${name} failed (${response.status}): ${body}`)
}

try {
  const adminProbe = await sql(adminToken, 'SELECT id FROM organization LIMIT 1')
  if (!adminProbe.identity) fail('SpacetimeDB did not verify the administrator identity')

  const identityByTokenName = new Map()
  for (const { tokenName, token } of services) {
    if (identityByTokenName.has(tokenName)) continue
    const probe = await sql(token, 'SELECT id FROM organization LIMIT 1')
    if (!probe.identity) fail(`SpacetimeDB did not verify ${tokenName}`)
    identityByTokenName.set(tokenName, probe.identity)
  }
  const workerIdentities = [...identityByTokenName.values()]
  if (
    workerIdentities.includes(adminProbe.identity) ||
    new Set(workerIdentities).size !== workerIdentities.length
  ) {
    fail('administrator and dedicated worker identities must be pairwise distinct')
  }

  const organizations = (await sql(adminToken, 'SELECT id FROM organization')).rows
  if (organizations.length === 0) {
    console.log('[register-local-service-identities] no organizations exist; nothing to register')
    process.exit(0)
  }

  let changed = 0
  for (const organization of organizations) {
    const organizationId = Number(organization.id)
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
      throw new Error('organization row has an invalid id')
    }
    for (const { tokenName, service } of services) {
      const identity = identityByTokenName.get(tokenName)
      const active = (
        await sql(
          adminToken,
          `SELECT identity, is_active FROM cold_tier_service_identity WHERE organization_id = ${organizationId} AND service_name = '${service}'`,
        )
      ).rows.filter((row) => row.is_active === true)
      if (active.length === 1 && normalizeIdentity(active[0]?.identity) === identity) continue
      await reducer(adminToken, 'register_cold_tier_service_identity', [
        organizationId,
        // platform_id is the table's primary key, so it must be per organization.
        `local-${service}-org${organizationId}-${identity.slice(0, 16)}`,
        service,
        { __identity__: `0x${identity}` },
      ])
      changed += 1
    }
  }

  console.log(
    `[register-local-service-identities] verified ${services.length} services across ${organizations.length} organization(s); updated ${changed} binding(s)`,
  )
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
