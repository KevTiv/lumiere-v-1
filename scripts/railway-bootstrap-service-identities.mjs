#!/usr/bin/env node
// One-shot, private-network operation. Credentials are supplied by Railway
// references; newly minted tokens leave the process only in an encrypted envelope.
import { createCipheriv, publicEncrypt, randomBytes, constants } from 'node:crypto'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`missing ${name}`)
  return value
}

const host = new URL(required('STDB_HOST'))
if (!host.hostname.endsWith('.railway.internal') || host.protocol !== 'http:') {
  throw new Error('bootstrap requires Railway private SpacetimeDB HTTP')
}
const database = encodeURIComponent(required('STDB_MODULE'))
const owner = required('STDB_SERVER_TOKEN')
const publicKey = required('LUMIERE_BOOTSTRAP_PUBLIC_KEY')

async function request(path, token, body, contentType = 'text/plain') {
  const response = await fetch(new URL(path, host), {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': contentType },
    body,
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`bootstrap request ${path} failed: HTTP ${response.status}`)
  return response
}

function rows(resultSets) {
  const result = resultSets[0]
  return (result?.rows ?? []).map(row => Object.fromEntries(
    result.schema.elements.map((element, index) => [element.name.some, row[index]]),
  ))
}

async function sql(token, statement) {
  const response = await request(`/v1/database/${database}/sql`, token, statement)
  const identity = response.headers.get('spacetime-identity')?.replace(/^0x/, '').toLowerCase()
  if (!identity || !/^[0-9a-f]{64}$/.test(identity)) throw new Error('server did not verify identity')
  return { identity, rows: rows(await response.json()) }
}

const organizations = (await sql(owner, 'SELECT id FROM organization')).rows.map(row => Number(row.id))
if (organizations.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('invalid organization id')
const minted = {}
for (const prefix of ['EXPENSE', 'HR', 'PROJECT']) {
  const response = await request('/v1/identity', null, undefined)
  const identity = await response.json()
  if (typeof identity.token !== 'string' || !identity.token) throw new Error('identity mint failed')
  minted[`STDB_${prefix}_WORKER_TOKEN`] = identity.token
}
const services = [
  ['STDB_FINALIZATION_TOKEN', 'projection_worker'],
  ['STDB_FINALIZATION_TOKEN', 'pos_order_hydrator'],
  ['STDB_OWNER_REPORT_WORKER_TOKEN', 'owner_report_worker'],
  ['STDB_WORKFLOW_WORKER_TOKEN', 'workflow_worker'],
  ['STDB_EXPENSE_WORKER_TOKEN', 'expense_integration_worker'],
  ['STDB_HR_WORKER_TOKEN', 'hr_integration_worker'],
  ['STDB_PROJECT_WORKER_TOKEN', 'project_integration_worker'],
]
const identities = new Map()
for (const [key] of services) {
  if (!identities.has(key)) identities.set(key, (await sql(minted[key] ?? required(key), 'SELECT id FROM organization LIMIT 1')).identity)
}
const ownerIdentity = (await sql(owner, 'SELECT id FROM organization LIMIT 1')).identity
if (new Set([ownerIdentity, ...identities.values()]).size !== identities.size + 1) {
  throw new Error('service identities must be distinct from one another and owner')
}
for (const organizationId of organizations) {
  for (const [key, service] of services) {
    const identity = identities.get(key)
    const active = (await sql(owner, `SELECT identity, is_active FROM cold_tier_service_identity WHERE organization_id = ${organizationId} AND service_name = '${service}'`)).rows
      .filter(row => row.is_active === true)
    const normalize = value => typeof value === 'string' ? value.replace(/^0x/, '').toLowerCase() : value?.__identity__?.replace(/^0x/, '').toLowerCase()
    if (active.length === 1 && normalize(active[0].identity) === identity) continue
    await request(`/v1/database/${database}/call/register_cold_tier_service_identity`, owner, JSON.stringify([
      organizationId, `railway-${service}-org${organizationId}-${identity.slice(0, 16)}`, service, { __identity__: `0x${identity}` },
    ]), 'application/json')
  }
}

const key = randomBytes(32), iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', key, iv)
const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ tokens: minted, organizationIds: organizations })), cipher.final()])
const envelope = {
  key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'),
  iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64'),
}
console.log(`BOOTSTRAP_ENVELOPE ${JSON.stringify(envelope)}`)
console.log(`BOOTSTRAP_VERIFIED organizations=${organizations.length} distinctIdentities=${identities.size}`)
