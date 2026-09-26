/**
 * Provisions the versioned first-org browser personas (local dev/E2E).
 *
 * Uses the API server's platform-control credential bootstrap, then creates the
 * organization-owned SpacetimeDB bindings after membership exists.
 *
 * Before admin reducers, calls `dev_promote_caller_superuser` so the JWT identity used for
 * `STDB_SERVER_TOKEN` can create membership and binding projections.
 * Publish the module after pulling this reducer; do not expose that reducer on untrusted hosts.
 *
 * Usage (from repo root or frontend/web):
 *   pnpm --dir frontend/web run seed-test-user
 *   pnpm --dir frontend/web run seed-first-org-personas
 *   # or: make seed-test-user
 *
 * Org selection is fail-closed: the exact manifest organization name+code and company code must exist.
 *
 * Env: STDB_MODULE or NEXT_PUBLIC_STDB_MODULE (required — must match `spacetime publish <name>`),
 *      STDB_HOST or NEXT_PUBLIC_STDB_HOST, STDB_SERVER_TOKEN, STDB_CREDENTIAL_ENCRYPTION_KEY
 *      (same as Next + api-server).
 * Loads frontend/web/.env.local when present (does not override existing env).
 *
 * STDB_CREDENTIAL_ENCRYPTION_KEY: required when creating credentials (64 hex chars); must match
 * the Next app so sign-in can decrypt stored tokens. Generate: openssl rand -hex 32
 *
 * Local SpacetimeDB (http://127.0.0.1:3000): HTTP tokens are signed by that host.
 * A maincloud JWT from `spacetime login` will NOT work — run:
 *   spacetime login --server-issued-login local
 * then set STDB_SERVER_TOKEN to spacetimedb_token in ~/.config/spacetime/cli.toml,
 * or rely on this script reading that file when STDB_SERVER_TOKEN is unset.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  loadEnvLocal,
  getStdbHost,
  resolveStdbToken,
  callStdbReducer,
  getRequiredModuleName,
  authErrorHint,
} from './stdb-http-seed-shared.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(SCRIPT_DIR, '../fixtures/first-org-fixture.v1.json')
const SATS_NONE = { none: [] }
const satsSome = (value) => ({ some: value })
const EXPECTED_PERSONA_KEYS = [
  'organization-admin',
  'finance-accounting',
  'sales-crm',
  'warehouse-manufacturing',
  'purchasing',
  'hr-project',
  'limited-read-only',
]
const EXPECTED_MODULE_HEALTH = [
  ['COV-03', 'contact', true],
  ['COV-04', 'sale_order', true],
  ['COV-05', 'purchase_order', true],
  ['COV-06', 'warehouse', true],
  ['COV-07', 'mrp_production', true],
  ['COV-08', 'account_move', true],
  ['COV-09', 'hr_employee', true],
  ['COV-10', 'project_project', true],
  ['COV-11', 'expense_sheet', true],
  ['COV-12', 'subscription', true],
  ['COV-13', 'pos_config', true],
  ['COV-14', 'helpdesk_ticket', true],
  ['COV-15', 'fleet_vehicle', true],
  ['COV-16', 'iot_device', true],
  ['COV-17', 'proposal', true],
  ['COV-18', 'document', true],
  ['COV-19', 'calendar_event', true],
  ['COV-20', 'financial_report', true],
  ['COV-21', 'workflow', true],
  ['COV-22', 'form_config', true],
  ['COV-23', 'organization_settings', true],
  ['COV-24', 'sale_order', true],
]

function loadFixtureManifest() {
  const manifest = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
  const failures = []
  if (manifest.schema_version !== 1) failures.push('schema_version must be 1')
  if (manifest.fixture_key !== 'lumiere-first-org-v1') failures.push('fixture_key must be lumiere-first-org-v1')
  if (!manifest.organization?.name || !manifest.organization?.code) failures.push('organization name+code are required')
  if (!manifest.company?.name || !manifest.company?.code) failures.push('company name+code are required')
  if (!manifest.password_env) failures.push('password_env is required')

  const personaKeys = (manifest.personas ?? []).map((persona) => persona.key)
  if (JSON.stringify(personaKeys) !== JSON.stringify(EXPECTED_PERSONA_KEYS)) {
    failures.push(`personas must be exactly ${EXPECTED_PERSONA_KEYS.join(', ')}`)
  }
  const emails = (manifest.personas ?? []).map((persona) => persona.email)
  const roles = (manifest.personas ?? []).map((persona) => persona.role_name)
  if (new Set(emails).size !== emails.length) failures.push('persona emails must be unique')
  if (new Set(roles).size !== roles.length) failures.push('persona role names must be unique')
  for (const persona of manifest.personas ?? []) {
    if (!persona.email?.endsWith('.test') && persona.key !== 'organization-admin') {
      failures.push(`${persona.key}: non-admin fixture email must use the reserved .test domain`)
    }
    if (!Array.isArray(persona.permissions) || persona.permissions.length === 0) {
      failures.push(`${persona.key}: permissions are required`)
    }
    if (persona.key !== 'organization-admin' && persona.permissions.includes('*:*')) {
      failures.push(`${persona.key}: non-admin persona cannot have global wildcard authority`)
    }
  }

  const moduleHealth = (manifest.module_health ?? []).map((entry) => [entry.id, entry.table, entry.required])
  if (JSON.stringify(moduleHealth) !== JSON.stringify(EXPECTED_MODULE_HEALTH)) {
    failures.push('module_health must match the accepted COV-03 through COV-24 table and requirement map')
  }
  for (const entry of manifest.module_health ?? []) {
    if (!/^[a-z][a-z0-9_]*$/.test(entry.table ?? '')) failures.push(`${entry.id}: invalid health table`)
    if (typeof entry.required !== 'boolean') failures.push(`${entry.id}: required must be boolean`)
  }

  if (failures.length > 0) throw new Error(`Invalid first-org fixture manifest:\n- ${failures.join('\n- ')}`)
  return manifest
}

async function bootstrapPlatformCredential(adminToken, persona, password) {
  const base = (process.env['LUMIERE_API_SERVER_URL'] ?? 'http://127.0.0.1:8082').replace(/\/$/, '')
  const res = await fetch(`${base}/v1/auth/internal/bootstrap-credential`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: persona.email, password }),
  })
  if (!res.ok) {
    throw new Error(`Platform credential bootstrap failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

/** SpacetimeDB 2.x SQL HTTP response: array of result sets with SATS schema + row arrays (see @lumiere/stdb http.ts). */
function sqlElementName(el) {
  if (!el || typeof el !== 'object') return ''
  const n = el.name
  if (n && typeof n === 'object' && 'some' in n && typeof n.some === 'string') return n.some
  return ''
}

function sqlSnakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function unwrapSats(v) {
  if (Array.isArray(v) && v.length === 2 && v[0] === 0) return unwrapSats(v[1])
  if (Array.isArray(v) && v.length === 2 && v[0] === 1) return undefined
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    if ('some' in v) return unwrapSats(v.some)
    if ('none' in v) return undefined
  }
  return v
}

function sqlRowToObject(elements, row) {
  const obj = {}
  for (let i = 0; i < elements.length; i++) {
    const snake = sqlElementName(elements[i])
    if (!snake) continue
    obj[sqlSnakeToCamel(snake)] = unwrapSats(row[i])
  }
  return obj
}

async function queryStdb(host, moduleName, token, sql) {
  if (!token) throw new Error('STDB_SERVER_TOKEN is not configured')
  const url = `${host}/v1/database/${moduleName}/sql`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: sql,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `SpacetimeDB SQL query failed: ${res.status} ${body}${authErrorHint(host, res.status, body)}`,
    )
  }
  const results = await res.json()
  const first = Array.isArray(results) ? results[0] : null
  if (!first?.rows?.length) return []
  const elements = first.schema?.elements
  if (!Array.isArray(elements)) {
    throw new Error(
      'Unexpected SQL response: missing schema.elements (SpacetimeDB 2.x SATS format).',
    )
  }
  return first.rows.map((row) => sqlRowToObject(elements, row))
}

/** Extract 64 hex chars (no 0x) from SQL / API shapes for wrapping. */
function normalizeIdentityHex(raw) {
  if (raw == null) throw new Error('Missing identity')
  if (typeof raw === 'string') {
    return raw.replace(/^0x/i, '')
  }
  /** SATS-JSON sometimes wraps U256/Identity as a one-element array: ["0x...64 hex..."] */
  if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === 'string') {
    return normalizeIdentityHex(raw[0])
  }
  if (Array.isArray(raw) || raw instanceof Uint8Array) {
    const buf = raw instanceof Uint8Array ? raw : Uint8Array.from(raw)
    if (buf.length !== 32) {
      throw new Error(
        `Identity byte array must be 32 bytes; got ${buf.length}. Value: ${JSON.stringify(raw)}`,
      )
    }
    return Buffer.from(buf).toString('hex')
  }
  if (typeof raw === 'object' && raw !== null && Array.isArray(raw.__identity__)) {
    const inner = raw.__identity__
    if (inner.length !== 32) {
      throw new Error(
        `Identity.__identity__ byte array must be 32 bytes; got ${inner.length}`,
      )
    }
    return Buffer.from(inner).toString('hex')
  }
  if (typeof raw === 'object' && raw !== null && typeof raw.__identity__ === 'string') {
    return normalizeIdentityHex(raw.__identity__)
  }
  throw new Error(`Unexpected identity shape: ${typeof raw} ${JSON.stringify(raw)}`)
}

/**
 * SpacetimeDB HTTP reducer args expect Identity as { __identity__: "0x..." } (U256), not a bare hex string.
 * Matches spacetimedb SDK Identity (see node_modules/spacetimedb/src/lib/identity.ts).
 * SATS-JSON from SQL often uses { __identity__: <32-byte number[]> } (not a hex string).
 */
function toIdentityReducerArg(raw) {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw) && '__identity__' in raw) {
    const inner = raw.__identity__
    if (typeof inner === 'bigint') {
      throw new Error(
        'Identity.__identity__ is bigint; use /v1/identity JSON with string __identity__.',
      )
    }
    if (typeof inner === 'string') {
      const s = inner.startsWith('0x') ? inner : `0x${inner}`
      return { __identity__: s }
    }
    if (inner instanceof Uint8Array || Array.isArray(inner)) {
      const buf = inner instanceof Uint8Array ? inner : Uint8Array.from(inner)
      if (buf.length !== 32) {
        throw new Error(
          `Identity.__identity__ must be 32 bytes; got ${buf.length}. Raw: ${JSON.stringify(raw)}`,
        )
      }
      const hex = Buffer.from(buf).toString('hex')
      return { __identity__: `0x${hex.toLowerCase()}` }
    }
    throw new Error(`Unexpected Identity.__identity__ type: ${typeof inner}`)
  }
  const hex = normalizeIdentityHex(raw)
  if (hex.length !== 64) {
    throw new Error(`Identity hex must be 64 hex chars (32 bytes); got length ${hex.length}`)
  }
  return { __identity__: `0x${hex.toLowerCase()}` }
}

function sqlLiteral(value) {
  return String(value).replace(/'/g, "''")
}

async function resolveTargetOrg(host, moduleName, adminToken, manifest) {
  const rows = await queryStdb(
    host,
    moduleName,
    adminToken,
    `SELECT id, name, code FROM organization WHERE name = '${sqlLiteral(manifest.organization.name)}' AND code = '${sqlLiteral(manifest.organization.code)}'`,
  )
  if (rows.length !== 1) {
    throw new Error(
      `Expected exactly one fixture organization ${manifest.organization.name} (${manifest.organization.code}); found ${rows.length}. Run seed_dev_data against a clean fixture database.`,
    )
  }
  const row = rows[0]
  console.log(`[seed-test-user] Target org: id=${row.id} name="${row.name}" code=${row.code}.`)
  return Number(row.id)
}

async function resolveTargetCompany(host, moduleName, adminToken, orgId, manifest) {
  const rows = await queryStdb(
    host,
    moduleName,
    adminToken,
    `SELECT id, name, code FROM company WHERE organization_id = ${orgId} AND code = '${sqlLiteral(manifest.company.code)}'`,
  )
  if (rows.length !== 1 || rows[0]?.name !== manifest.company.name) {
    throw new Error(
      `Expected exactly one fixture company ${manifest.company.name} (${manifest.company.code}); found ${rows.length}.`,
    )
  }
  return Number(rows[0].id)
}

async function resolveRole(host, moduleName, adminToken, orgId, roleName) {
  const rows = await queryStdb(
    host,
    moduleName,
    adminToken,
    `SELECT id, name, permissions, is_system FROM role WHERE organization_id = ${orgId}`,
  )
  return rows.find((row) => String(row.name ?? '').toLowerCase() === roleName.toLowerCase()) ?? null
}

async function ensurePersonaRole(host, moduleName, adminToken, orgId, persona, fixtureKey) {
  let role = await resolveRole(host, moduleName, adminToken, orgId, persona.role_name)
  if (!role) {
    if (!persona.managed_role) throw new Error(`required system role not found: ${persona.role_name}`)
    await callStdbReducer(host, moduleName, adminToken, 'create_role', [
      orgId,
      {
        name: persona.role_name,
        description: satsSome(`COV-02 fixture role for ${persona.key}`),
        parent_id: SATS_NONE,
        permissions: persona.permissions,
        is_active: true,
        metadata: satsSome(JSON.stringify({ fixture_key: fixtureKey, persona: persona.key })),
      },
    ])
    role = await resolveRole(host, moduleName, adminToken, orgId, persona.role_name)
  }
  if (!role?.id) throw new Error(`role could not be resolved: ${persona.role_name}`)

  const actualPermissions = Array.isArray(role.permissions) ? role.permissions : []
  if (persona.managed_role && JSON.stringify(actualPermissions) !== JSON.stringify(persona.permissions)) {
    await callStdbReducer(host, moduleName, adminToken, 'update_role', [
      Number(role.id),
      {
        name: SATS_NONE,
        description: SATS_NONE,
        permissions: satsSome(persona.permissions),
        is_active: satsSome(true),
      },
    ])
  }
  if (!persona.managed_role && !actualPermissions.includes('*:*')) {
    throw new Error(`system role ${persona.role_name} is missing expected global authority`)
  }
  return Number(role.id)
}

async function ensureRoleAssignment(host, moduleName, adminToken, identityForReducer, orgId, roleId, personaKey) {
  try {
    await callStdbReducer(host, moduleName, adminToken, 'assign_role', [
      identityForReducer,
      roleId,
      orgId,
      { expires_at_micros: SATS_NONE, metadata: SATS_NONE },
    ])
    console.log(`[seed-test-user] assign_role OK (${personaKey}, org_id=${orgId}, role_id=${roleId}).`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('already has this role')) {
      console.log(`[seed-test-user] assign_role skipped for ${personaKey} (already assigned).`)
      return
    }
    throw e
  }
}

async function ensureCredentialBinding(
  host,
  moduleName,
  adminToken,
  credential,
  identityForReducer,
  orgId,
  email,
) {
  try {
    await callStdbReducer(host, moduleName, adminToken, 'bind_user_credential', [
      credential.platformUserId,
      identityForReducer,
      email,
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('Identity already has a credential binding')) throw error
    const rows = await queryStdb(
      host,
      moduleName,
      adminToken,
      `SELECT platform_user_id, email FROM user_credential WHERE organization_id = ${orgId} AND email = '${sqlLiteral(email)}'`,
    )
    if (
      rows.length !== 1 ||
      rows[0]?.platformUserId !== credential.platformUserId ||
      rows[0]?.email !== email
    ) {
      throw new Error('Existing organization credential binding does not match the platform user')
    }
    console.log('[seed-test-user] Credential binding already matches; continuing.')
  }
}

async function ensureMembership(host, moduleName, adminToken, identityForReducer, orgId, companyId, persona, fixtureKey) {
  try {
    await callStdbReducer(host, moduleName, adminToken, 'add_org_member', [
      identityForReducer,
      orgId,
      {
        role_name: persona.role_name,
        company_id: satsSome(companyId),
        job_title: satsSome(persona.job_title),
        department_id: SATS_NONE,
        employee_id: SATS_NONE,
        is_active: true,
        is_default: true,
        metadata: satsSome(JSON.stringify({ fixture_key: fixtureKey, persona: persona.key })),
      },
    ])
    console.log(`[seed-test-user] add_org_member OK (${persona.key}, org_id=${orgId}).`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('already an active member')) throw error
    console.log(`[seed-test-user] add_org_member skipped for ${persona.key} (already active).`)
  }
}

async function verifyFixtureHealth(host, moduleName, adminToken, manifest, orgId, companyId) {
  const failures = []
  const personaResults = []
  const memberships = await queryStdb(
    host,
    moduleName,
    adminToken,
    `SELECT id, user_identity, organization_id, company_id, role_id, is_active, is_default FROM user_organization WHERE organization_id = ${orgId}`,
  )
  const assignments = await queryStdb(
    host,
    moduleName,
    adminToken,
    `SELECT id, user_identity, role_id, organization_id, is_active FROM user_role_assignment WHERE organization_id = ${orgId}`,
  )
  for (const persona of manifest.personas) {
    const credentials = await queryStdb(
      host,
      moduleName,
      adminToken,
      `SELECT id, email, identity FROM user_credential WHERE organization_id = ${orgId} AND email = '${sqlLiteral(persona.email)}'`,
    )
    const role = await resolveRole(host, moduleName, adminToken, orgId, persona.role_name)
    if (credentials.length !== 1) failures.push(`${persona.key}: expected one credential, found ${credentials.length}`)
    if (!role?.id) failures.push(`${persona.key}: role ${persona.role_name} is missing`)
    let identityHex = null
    if (credentials.length === 1) {
      identityHex = normalizeIdentityHex(credentials[0].identity).toLowerCase()
    }
    const activeMemberships = identityHex === null
      ? []
      : memberships.filter((membership) =>
        normalizeIdentityHex(membership.userIdentity).toLowerCase() === identityHex
        && membership.isActive === true)
    const activeAssignments = identityHex === null
      ? []
      : assignments.filter((assignment) =>
        normalizeIdentityHex(assignment.userIdentity).toLowerCase() === identityHex
        && assignment.isActive === true)
    const membership = activeMemberships[0]
    const assignment = activeAssignments[0]
    if (
      activeMemberships.length !== 1
      || Number(membership?.roleId) !== Number(role?.id)
      || Number(membership?.companyId) !== companyId
      || membership?.isDefault !== true
    ) {
      failures.push(`${persona.key}: active membership must be unique, default, and use the fixture company and role`)
    }
    if (activeAssignments.length !== 1 || Number(assignment?.roleId) !== Number(role?.id)) {
      failures.push(`${persona.key}: active role assignment must be unique and match the fixture role`)
    }
    personaResults.push({
      key: persona.key,
      credential_count: credentials.length,
      role_id: role?.id ?? null,
      active_membership_count: activeMemberships.length,
      active_role_assignment_count: activeAssignments.length,
    })
  }

  const moduleResults = []
  for (const entry of manifest.module_health) {
    const rows = await queryStdb(
      host,
      moduleName,
      adminToken,
      `SELECT organization_id FROM ${entry.table} WHERE organization_id = ${orgId} LIMIT 1`,
    )
    const present = rows.length === 1
    if (entry.required && !present) failures.push(`${entry.id}: required ${entry.table} fixture row is missing`)
    moduleResults.push({ id: entry.id, table: entry.table, required: entry.required, present })
  }

  const report = {
    fixture_key: manifest.fixture_key,
    organization_id: orgId,
    company_id: companyId,
    personas: personaResults,
    modules: moduleResults,
    healthy: failures.length === 0,
    failures,
  }
  console.log(`[seed-test-user] HEALTH ${JSON.stringify(report)}`)
  if (failures.length > 0) throw new Error(`First-org fixture health failed:\n- ${failures.join('\n- ')}`)
}

async function main() {
  const manifest = loadFixtureManifest()
  if (process.argv.includes('--check-manifest')) {
    console.log(
      `[seed-test-user] Manifest OK: ${manifest.fixture_key}, ${manifest.personas.length} personas, ${manifest.module_health.length} module health rows.`,
    )
    return
  }

  loadEnvLocal()

  const host = getStdbHost()
  const moduleName = getRequiredModuleName('seed-test-user')
  const adminToken = resolveStdbToken(host)

  await callStdbReducer(host, moduleName, adminToken, 'dev_promote_caller_superuser', [])
  console.log('[seed-test-user] dev_promote_caller_superuser OK (HTTP token identity is superuser).')

  const orgId = await resolveTargetOrg(host, moduleName, adminToken, manifest)
  const companyId = await resolveTargetCompany(host, moduleName, adminToken, orgId, manifest)
  const allPersonas = process.argv.includes('--all-personas')
  const selectedPersonas = allPersonas
    ? manifest.personas
    : manifest.personas.filter((persona) => persona.key === 'organization-admin')
  const password = process.env[manifest.password_env]?.trim() || 'Password123$'
  if (!process.env[manifest.password_env]?.trim()) {
    console.warn(`[seed-test-user] ${manifest.password_env} is unset; using the local E2E fixture password.`)
  }

  for (const persona of selectedPersonas) {
    const roleId = await ensurePersonaRole(host, moduleName, adminToken, orgId, persona, manifest.fixture_key)
    const credential = await bootstrapPlatformCredential(adminToken, persona, password)
    if (!credential.identity || !credential.platformUserId) {
      throw new Error(`Platform credential bootstrap returned an incomplete binding for ${persona.key}`)
    }
    const identityForReducer = toIdentityReducerArg(credential.identity)
    await ensureMembership(
      host,
      moduleName,
      adminToken,
      identityForReducer,
      orgId,
      companyId,
      persona,
      manifest.fixture_key,
    )
    await ensureCredentialBinding(
      host,
      moduleName,
      adminToken,
      credential,
      identityForReducer,
      orgId,
      persona.email,
    )
    await callStdbReducer(host, moduleName, adminToken, 'bind_user_profile', [
      credential.platformUserId,
      identityForReducer,
    ])
    await ensureRoleAssignment(
      host,
      moduleName,
      adminToken,
      identityForReducer,
      orgId,
      roleId,
      persona.key,
    )
    console.log(`[seed-test-user] Ready: ${persona.key} (${persona.email}).`)
  }

  if (allPersonas) await verifyFixtureHealth(host, moduleName, adminToken, manifest, orgId, companyId)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
