#!/usr/bin/env node
// One-shot, private-network operation. Credentials are supplied by Railway
// references; newly minted tokens leave the process only in an encrypted envelope.
import { createCipheriv, publicEncrypt, randomBytes, constants } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const REVIEWED_MAIL_TOKEN = 'LUMIERE_REVIEWED_MAIL_STDB_TOKEN'

export function reviewedMailSelected(env) {
  const selection = env.RAILWAY_ENABLE_REVIEWED_MAIL?.trim()
  if (selection && !['true', 'false'].includes(selection)) {
    throw new Error('RAILWAY_ENABLE_REVIEWED_MAIL must be true or false')
  }
  return selection === 'true' || Boolean(env[REVIEWED_MAIL_TOKEN]?.trim())
}

function normalizeIdentity(value) {
  return typeof value === 'string' ? value.replace(/^0x/, '').toLowerCase()
    : value?.__identity__?.replace(/^0x/, '').toLowerCase()
}

function encryptEnvelope(payload, publicKey) {
  const key = randomBytes(32), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()])
  return {
    key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64'),
  }
}

export async function bootstrapServiceIdentities({
  env = process.env, fetchFn = fetch, log = console.log, verifyReviewedMail = false,
  sealEnvelope = encryptEnvelope,
} = {}) {
  function required(name) {
    const value = env[name]?.trim()
    if (!value) throw new Error(`missing ${name}`)
    return value
  }

  const host = new URL(required('STDB_HOST'))
  if (!host.hostname.endsWith('.railway.internal') || host.protocol !== 'http:'
    || host.username || host.password || host.search || host.hash) {
    throw new Error('bootstrap requires Railway private SpacetimeDB HTTP')
  }
  const database = encodeURIComponent(required('STDB_MODULE'))
  const owner = required('STDB_SERVER_TOKEN')
  const reviewedMail = verifyReviewedMail || reviewedMailSelected(env)
  if (reviewedMail && required(REVIEWED_MAIL_TOKEN) === owner) {
    throw new Error('reviewed mail token must differ from STDB_SERVER_TOKEN')
  }
  const publicKey = verifyReviewedMail ? null : required('LUMIERE_BOOTSTRAP_PUBLIC_KEY')

  async function request(path, token, body, contentType = 'text/plain') {
    let response
    try {
      response = await fetchFn(new URL(path, host), {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': contentType },
        body,
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new Error(`bootstrap request ${path} failed before a response`)
    }
    if (!response.ok) throw new Error(`bootstrap request ${path} failed: HTTP ${response.status}`)
    return response
  }

  async function readJson(response) {
    try {
      return await response.json()
    } catch {
      throw new Error('bootstrap response contained invalid JSON')
    }
  }

  function rows(resultSets) {
    const result = resultSets[0]
    if (!result || !Array.isArray(result.rows) || !Array.isArray(result.schema?.elements)
      || result.schema.elements.some(element => typeof element.name?.some !== 'string')
      || result.rows.some(row => !Array.isArray(row) || row.length !== result.schema.elements.length)) {
      throw new Error('bootstrap SQL response contained an invalid result schema')
    }
    return result.rows.map(row => Object.fromEntries(
      result.schema.elements.map((element, index) => [element.name.some, row[index]]),
    ))
  }

  async function sql(token, statement) {
    const response = await request(`/v1/database/${database}/sql`, token, statement)
    const identity = response.headers.get('spacetime-identity')?.replace(/^0x/, '').toLowerCase()
    if (!identity || !/^[0-9a-f]{64}$/.test(identity)) throw new Error('server did not verify identity')
    return { identity, rows: rows(await readJson(response)) }
  }

  const organizations = (await sql(owner, 'SELECT id FROM organization')).rows.map(row => Number(row.id))
  if (organizations.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('invalid organization id')
  const minted = {}
  for (const prefix of verifyReviewedMail ? [] : ['EXPENSE', 'HR', 'PROJECT']) {
    const response = await request('/v1/identity', null, undefined)
    const identity = await readJson(response)
    if (typeof identity.token !== 'string' || !identity.token) throw new Error('identity mint failed')
    minted[`STDB_${prefix}_WORKER_TOKEN`] = identity.token
  }
  const services = verifyReviewedMail ? [] : [
    ['STDB_FINALIZATION_TOKEN', 'projection_worker'],
    ['STDB_FINALIZATION_TOKEN', 'pos_order_hydrator'],
    ['STDB_OWNER_REPORT_WORKER_TOKEN', 'owner_report_worker'],
    ['STDB_WORKFLOW_WORKER_TOKEN', 'workflow_worker'],
    ['STDB_EXPENSE_WORKER_TOKEN', 'expense_integration_worker'],
    ['STDB_HR_WORKER_TOKEN', 'hr_integration_worker'],
    ['STDB_PROJECT_WORKER_TOKEN', 'project_integration_worker'],
  ]
  if (reviewedMail) services.push([REVIEWED_MAIL_TOKEN, 'reviewed_mail_dispatcher'])
  const identities = new Map()
  for (const [key] of services) {
    if (!identities.has(key)) identities.set(key, (await sql(minted[key] ?? required(key), 'SELECT id FROM organization LIMIT 1')).identity)
  }
  const ownerIdentity = (await sql(owner, 'SELECT id FROM organization LIMIT 1')).identity
  if (new Set([ownerIdentity, ...identities.values()]).size !== identities.size + 1) {
    throw new Error('service identities must be distinct from one another and owner')
  }
  for (const organizationId of organizations) {
    if (reviewedMail) {
      const active = (await sql(owner, `SELECT service_name, identity FROM cold_tier_service_identity WHERE organization_id = ${organizationId} AND is_active = true LIMIT 257`)).rows
      if (active.length >= 257) throw new Error(`active service binding verification limit exceeded for organization ${organizationId}`)
      if (active.some(row => typeof row.service_name !== 'string'
        || !/^[0-9a-f]{64}$/.test(normalizeIdentity(row.identity) ?? ''))) {
        throw new Error(`active service binding is malformed for organization ${organizationId}`)
      }
      const reviewedIdentity = identities.get(REVIEWED_MAIL_TOKEN)
      if (active.some(row => row.service_name !== 'reviewed_mail_dispatcher'
        && normalizeIdentity(row.identity) === reviewedIdentity)) {
        throw new Error(`reviewed mail identity is shared with another active service for organization ${organizationId}`)
      }
    }
    for (const [key, service] of services) {
      const identity = identities.get(key)
      const active = (await sql(owner, `SELECT identity, is_active FROM cold_tier_service_identity WHERE organization_id = ${organizationId} AND service_name = '${service}'`)).rows
        .filter(row => row.is_active === true)
      if (active.length === 1 && normalizeIdentity(active[0].identity) === identity) continue
      if (verifyReviewedMail || (service === 'reviewed_mail_dispatcher' && active.length > 0)) {
        throw new Error(`active ${service} binding missing or different for organization ${organizationId}; operator review required`)
      }
      await request(`/v1/database/${database}/call/register_cold_tier_service_identity`, owner, JSON.stringify([
        organizationId, `railway-${service}-org${organizationId}-${identity.slice(0, 16)}`, service, { __identity__: `0x${identity}` },
      ]), 'application/json')
      const verified = (await sql(owner, `SELECT identity, is_active FROM cold_tier_service_identity WHERE organization_id = ${organizationId} AND service_name = '${service}'`)).rows
        .filter(row => row.is_active === true)
      if (verified.length !== 1 || normalizeIdentity(verified[0].identity) !== identity) {
        throw new Error(`registered ${service} binding verification failed for organization ${organizationId}`)
      }
    }
  }

  if (verifyReviewedMail) {
    if (organizations.length === 0) throw new Error('reviewed mail verification requires an existing organization')
    log(`REVIEWED_MAIL_VERIFIED organizations=${organizations.length}`)
    return
  }

  const envelope = sealEnvelope({ tokens: minted, organizationIds: organizations }, publicKey)
  log(`BOOTSTRAP_ENVELOPE ${JSON.stringify(envelope)}`)
  log(`BOOTSTRAP_VERIFIED organizations=${organizations.length} distinctIdentities=${identities.size}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--verify-reviewed-mail')) {
    throw new Error('usage: railway-bootstrap-service-identities.mjs [--verify-reviewed-mail]')
  }
  try {
    await bootstrapServiceIdentities({ verifyReviewedMail: args[0] === '--verify-reviewed-mail' })
  } catch (error) {
    console.error(`[service-identities] ${error.message}`)
    process.exitCode = 1
  }
}
