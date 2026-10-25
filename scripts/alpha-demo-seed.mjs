import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const snake = name => name.replace(/([a-zA-Z])(\d+)/g, '$1_$2').replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const unwrap = value => Array.isArray(value) && value.length === 2 && value[0] === 0 ? unwrap(value[1]) :
  Array.isArray(value) && value.length === 2 && value[0] === 1 ? null :
    value && typeof value === 'object' && own(value, 'some') ? unwrap(value.some) : value

export function encodeSeedValue(type, value, path = '') {
  if (type.kind === 'option') return value == null ? { none: [] } : { some: encodeSeedValue(type.element, value, path) }
  if (type.kind === 'object') {
    const input = value ?? {}
    for (const key of Object.keys(input)) {
      if (input[key] !== undefined && !own(type.fields, key)) throw new Error(`Unknown fixture field ${path}.${key}`)
    }
    return Object.fromEntries(Object.entries(type.fields).map(([key, field]) => {
      const defaultValue = key === 'metadata' ? JSON.stringify({ fixture_key: 'alpha-demo-v1' }) : undefined
      if (field.kind === 'u64' && /Id$/.test(key) && input[key] == null) throw new Error(`Missing fixture reference ${path}.${key}`)
      return [snake(key), encodeSeedValue(field, input[key] ?? defaultValue, `${path}.${key}`)]
    }))
  }
  if (type.kind === 'array') return (value ?? []).map(item => encodeSeedValue(type.element, item, path))
  if (type.kind === 'enum') {
    const entry = typeof value === 'string' ? [value, undefined] :
      value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 ? Object.entries(value)[0] : []
    const [variant, payload] = entry
    if (!own(type.fields, variant)) throw new Error(`Invalid fixture enum ${path}: ${String(variant)}`)
    const field = type.fields[variant]
    if (field.kind !== 'unit' && payload == null) throw new Error(`Missing fixture enum payload ${path}.${variant}`)
    return { [variant[0].toLowerCase() + variant.slice(1)]: encodeSeedValue(field, payload, `${path}.${variant}`) }
  }
  if (type.kind === 'timestamp') {
    const millis = Date.parse(value)
    if (!Number.isFinite(millis)) throw new Error(`Invalid fixture timestamp ${path}`)
    return { __timestamp_micros_since_unix_epoch__: millis * 1000 }
  }
  if (type.kind === 'identity') {
    if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`Invalid fixture identity ${path}`)
    return { __identity__: `0x${value}` }
  }
  if (type.kind === 'unit') return []
  if (type.kind === 'bool') return value ?? false
  if (type.kind === 'string') return value ?? ''
  if (/^[uif]\d+$/.test(type.kind)) return value ?? 0
  throw new Error(`Unsupported fixture type ${type.kind}`)
}

export function resolveSeedReferences(value, ids) {
  if (typeof value === 'string' && value.startsWith('@')) {
    const key = value.slice(1)
    if (!own(ids, key)) throw new Error(`Dependency ${key} is unavailable`)
    return ids[key]
  }
  if (Array.isArray(value)) return value.map(item => resolveSeedReferences(item, ids))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveSeedReferences(item, ids)]))
  return value
}

export async function runAlphaDemoSeed(env = process.env) {
  const required = name => { if (!env[name]) throw new Error(`Missing ${name}`); return env[name] }
  const api = new URL(required('LUMIERE_API_SERVER_URL')), stdb = new URL(required('STDB_HOST'))
  for (const url of [api, stdb]) if (url.protocol !== 'http:' || !url.hostname.endsWith('.railway.internal')) throw new Error('Seed requires Railway private HTTP')
  if (required('RAILWAY_ENVIRONMENT_NAME') !== 'production' || required('SEED_ORG_CODE') !== 'ALPHA' || required('SEED_ORG_NAME') !== 'Alpha org') throw new Error('Seed requires the explicitly selected Alpha production tenant')
  const compressed = required('SEED_PAYLOAD_GZIP') + (env.SEED_PAYLOAD_GZIP_2 ?? '') + (env.SEED_PAYLOAD_GZIP_3 ?? '')
  const { schema, fixtures } = JSON.parse(gunzipSync(Buffer.from(compressed, 'base64')).toString())
  const tables = new Set(schema.tables.map(table => table.name))
  const database = encodeURIComponent(required('STDB_MODULE'))
  const ownerEmail = required('SEED_OWNER_EMAIL')
  const admin = required('STDB_SERVER_TOKEN')
  async function sql(statement) {
    const response = await fetch(new URL(`/v1/database/${database}/sql`, stdb), {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'text/plain' }, body: statement, signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`SQL read HTTP ${response.status}: ${(await response.text()).slice(0, 300).replace(/[\r\n]/g, ' ')}`)
    const [result] = await response.json()
    return (result?.rows ?? []).map(row => Object.fromEntries(result.schema.elements.map((column, i) => [column.name.some, row[i]])))
  }
  async function request(path, token, body) {
    const response = await fetch(new URL(path, api), {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      // Only business operation errors are included; authentication never logs response bodies.
      const detail = path.startsWith('/v1/operations/') ? String(data.error ?? '').slice(0, 350).replace(/[\r\n]/g, ' ') : ''
      throw new Error(`HTTP ${response.status} ${detail}`)
    }
    return data
  }
  const credential = await request('/v1/auth/internal/bootstrap-credential', admin, { email: ownerEmail, password: required('SEED_OWNER_PASSWORD') })
  const token = credential.token
  if (!token) throw new Error('Owner credential could not be resolved')
  const organizations = await sql("SELECT id, name, code FROM organization WHERE code = 'ALPHA'")
  if (organizations.length !== 1 || organizations[0].name !== 'Alpha org') throw new Error('Alpha organization must exist exactly once')
  const org = Number(organizations[0].id)
  const session = await request('/v1/session/field-access', token)
  if (Number(session.organizationId) !== org || !['owner', 'admin', 'administrator'].includes(session.fieldAccess?.roleName?.toLowerCase())) throw new Error('Owner must have an organization-admin session')
  const roles = await sql(`SELECT id, permissions FROM role WHERE organization_id = ${org}`)
  if (!roles.some(role => role.permissions.includes('*:*'))) throw new Error('Organization administrator role is missing wildcard authority')
  await request('/v1/settings/roles', token)
  const companies = await sql(`SELECT id, currency_id FROM company WHERE organization_id = ${org} AND code = 'ALPHA'`)
  if (companies.length !== 1) throw new Error('Alpha company must exist exactly once')
  const ids = { company: Number(companies[0].id), currency: Number(companies[0].currency_id), ownerIdentity: credential.identity }
  if (!Number.isSafeInteger(ids.currency) || ids.currency <= 0) throw new Error('Company currency is not valid')
  console.log(`ALPHA_ADMIN_VERIFIED organizationId=${org} role=${session.fieldAccess.roleName} settingsAccess=true platformSuperuserRequired=false`)
  let referenceProvisioning
  if (env.SEED_PROVISION_REFERENCE_DATA === 'true') {
    const operation = schema.operations.apply_org_migrations
    if (!operation || operation.transport !== 'private-tenant-migration' || operation.reducer !== 'apply_org_migrations'
      || Object.keys(operation.fields).join(',') !== 'organizationId' || operation.fields.organizationId.kind !== 'u64') throw new Error('Pinned tenant migration contract is missing')
    const verifyNonPlatformOwner = async () => {
      const normalize = value => String(unwrap(value)?.__identity__ ?? unwrap(value)).replace(/^0x/, '').toLowerCase()
      const profiles = (await sql(`SELECT identity, is_superuser FROM user_profile WHERE organization_id = ${org}`))
        .filter(profile => normalize(profile.identity) === normalize(credential.identity))
      if (profiles.length !== 1 || profiles[0].is_superuser !== false) throw new Error('Alpha owner must remain a non-platform-superuser')
    }
    await verifyNonPlatformOwner()
    const migrated = await fetch(new URL(`/v1/database/${database}/call/${operation.reducer}`, stdb), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([org]), signal: AbortSignal.timeout(45000),
    })
    if (!migrated.ok) throw new Error(`Tenant reference provisioning HTTP ${migrated.status}; no privileged fallback attempted`)
    const migrations = await sql(`SELECT version FROM org_schema_migration WHERE organization_id = ${org}`)
    if (!migrations.some(row => Number(row.version) === 5)) throw new Error('Country catalog migration v5 is not deployed; no privileged fallback attempted')
    await verifyNonPlatformOwner()
    referenceProvisioning = { operation: operation.operationId, transport: operation.transport, migrationVersion: 5, platformSuperuser: false }
    console.log('ALPHA_REFERENCE_PROVISIONED migrationVersion=5 platformSuperuser=false')
  }
  const outcomes = []
  for (const fixture of fixtures) {
    try {
      if (!tables.has(fixture.table) || !/^[a-z][a-z0-9_]*$/.test(fixture.table)) throw new Error('Fixture table is not in pinned contracts')
      const tableDefinition = schema.tables.find(table => table.name === fixture.table)
      const primaryKey = tableDefinition.primaryKey ?? 'id'
      const match = resolveSeedReferences(fixture.match, ids)
      const columns = Object.keys(match).map(column => {
        if (!/^[a-z][a-z0-9_]*$/.test(column)) throw new Error('Unsafe fixture match column')
        return column
      })
      // HTTP SQL cannot compare Option<String> columns with bare strings.
      // Read a bounded tenant slice and match canonical decoded values instead.
      const find = async () => {
        const rows = await sql(`SELECT ${[...new Set([primaryKey, ...columns])].join(', ')} FROM ${fixture.table} WHERE organization_id = ${org} LIMIT 1000`)
        if (rows.length === 1000) throw new Error('Fixture lookup exceeded its safe tenant bound')
        return rows.filter(row => Object.entries(match).every(([column, value]) => String(unwrap(row[column])) === String(value)))
      }
      let existing = await find(), created = false
      if (existing.length > 1) throw new Error('Fixture identity is ambiguous')
      if (!existing.length) {
        const operation = schema.operations[fixture.operation]
        if (!operation) throw new Error('Fixture operation is not allowlisted')
        const input = resolveSeedReferences(fixture.input, ids), body = {}
        if (fixture.blob) {
          const bytes = Buffer.from(fixture.blob.content, 'utf8')
          const checksum = createHash('sha256').update(bytes).digest('hex')
          const slot = await request('/v1/documents/blobs/presign', token, {
            fileName: fixture.blob.fileName, contentType: fixture.blob.contentType,
            contentLength: bytes.length, checksum, companyId: ids.company, residency: 'eu',
          })
          if (!slot.uploadUrl?.startsWith(`/api/documents/blobs/upload/${org}/`)) throw new Error('Unexpected private document upload path')
          const upload = await fetch(new URL(slot.uploadUrl.replace(/^\/api\//, '/v1/'), api), {
            method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': fixture.blob.contentType },
            body: bytes, signal: AbortSignal.timeout(30000),
          })
          if (!upload.ok) throw new Error(`Document upload HTTP ${upload.status}`)
          const completed = await request('/v1/documents/blobs/complete', token, { objectKey: slot.objectKey, checksum })
          Object.assign(input.params, { url: completed.url, fileName: completed.fileName, mimetype: completed.mimetype,
            checksum: completed.checksum, fileSize: completed.fileSize })
        }
        for (const [field, type] of Object.entries(operation.fields)) {
          if (field === 'organizationId') continue
          // Only composite values are SATS-encoded here; API owns top-level Option encoding.
          body[field] = type.kind === 'object' ? encodeSeedValue(type, input[field], field) : (input[field] ?? null)
        }
        await request(`/v1/operations/${operation.operationId}`, token, body)
        existing = await find()
        if (existing.length !== 1) throw new Error('Created fixture could not be read back canonically')
        created = true
      }
      ids[fixture.key] = tableDefinition.hasId ? Number(existing[0][primaryKey]) : existing[0][primaryKey]
      outcomes.push({ key: fixture.key, table: fixture.table, id: ids[fixture.key], status: created ? 'created' : 'existing' })
      console.log(`ALPHA_SEED_ROW key=${fixture.key} table=${fixture.table} status=${created ? 'created' : 'existing'}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown seed error'
      outcomes.push({ key: fixture.key, table: fixture.table, status: 'gap', error: message })
      console.log(`ALPHA_SEED_GAP key=${fixture.key} reason=${message}`)
    }
  }
  const coverage = []
  for (const table of schema.tables) {
    if (!table.organizationOwned || !table.primaryKey) { coverage.push({ table: table.name, status: 'not-directly-org-addressable' }); continue }
    try {
      const rows = await sql(`SELECT ${table.primaryKey} FROM ${table.name} WHERE organization_id = ${org} LIMIT 1`)
      coverage.push({ table: table.name, status: rows.length ? 'populated' : 'empty' })
    } catch { coverage.push({ table: table.name, status: 'read-unavailable' }) }
  }
  const report = { fixtureKey: 'alpha-demo-v1', organizationId: org, generatedAt: new Date().toISOString(),
    adminVerified: true, referenceProvisioning, fixtureCount: fixtures.length, populatedFixtures: outcomes.filter(row => row.status !== 'gap').length, outcomes, coverage }
  if (env.SEED_GATEWAY_URL) {
    const gateway = new URL(env.SEED_GATEWAY_URL)
    if (gateway.protocol !== 'http:' || !gateway.hostname.endsWith('.railway.internal')) throw new Error('UI probe requires Railway private HTTP')
    const cookie = `stdb_token=${token}; stdb_identity=${credential.identity}`
    report.uiPages = []
    for (const path of ['/overview', '/crm', '/sales', '/purchasing', '/inventory', '/manufacturing', '/accounting', '/hr', '/projects',
      '/expenses', '/reports', '/documents', '/workflows', '/settings', '/helpdesk', '/fleet', '/pos', '/subscriptions', '/demo-readiness']) {
      try {
        const response = await fetch(new URL(path, gateway), { redirect: 'manual', headers: { Cookie: cookie }, signal: AbortSignal.timeout(45000) })
        report.uiPages.push({ path, status: response.status })
        console.log(`ALPHA_UI_PAGE path=${path} status=${response.status}`)
        await response.body?.cancel()
      } catch { report.uiPages.push({ path, status: 'unavailable' }) }
    }
    report.documentDownloads = []
    for (const fixture of fixtures.filter(row => row.blob)) {
      if (!ids[fixture.key]) continue
      const [row] = await sql(`SELECT url FROM document WHERE organization_id = ${org} AND id = ${ids[fixture.key]}`)
      const path = unwrap(row.url)
      if (typeof path !== 'string' || !path.startsWith(`/api/documents/blobs/object/${org}/`)) throw new Error('Unexpected document URL')
      const response = await fetch(new URL(path, gateway), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) })
      const verified = response.ok && await response.text() === fixture.blob.content
      report.documentDownloads.push({ key: fixture.key, verified })
      console.log(`ALPHA_DOCUMENT_VERIFIED key=${fixture.key} verified=${verified}`)
    }
    const anonymous = await fetch(new URL('/demo-readiness', gateway), { redirect: 'manual', signal: AbortSignal.timeout(10000) })
    report.anonymousDiagnosticsStatus = anonymous.status
    await anonymous.body?.cancel()
  }
  console.log(`ALPHA_SEED_REPORT ${JSON.stringify(report)}`)
  return report
}

if (process.env.SEED_RUN === 'true') {
  runAlphaDemoSeed().then(report => {
    createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ seed: 'complete', populatedFixtures: report.populatedFixtures, fixtureCount: report.fixtureCount }))
    }).listen(Number(process.env.PORT || 8080), '::')
  }).catch(error => { console.error(`ALPHA_SEED_FAILED ${error.message}`); process.exitCode = 1 })
}
