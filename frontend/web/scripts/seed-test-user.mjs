/**
 * Provisions test@email.com / Password123$ with admin org membership (local dev).
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
 *   # or: make seed-test-user
 *
 * Org selection: prefers "Lumiere Demo Corp" (seed_dev_data), then "Lumiere Dev Org" (ensure_minimal_dev_org),
 * else first organization row (LIMIT 1; SpacetimeDB HTTP SQL does not support ORDER BY here).
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

import {
  loadEnvLocal,
  getStdbHost,
  resolveStdbToken,
  callStdbReducer,
  getRequiredModuleName,
  authErrorHint,
} from './stdb-http-seed-shared.mjs'

const TEST_EMAIL = 'test@email.com'
const TEST_PASSWORD = 'Password123$'
/** Full demo dataset from `seed_dev_data` (Rust). */
const DEMO_ORG_NAME = 'Lumiere Demo Corp'
/** Minimal org from `ensure_minimal_dev_org` / `ensure_dev_admin`. */
const DEV_MINIMAL_ORG_NAME = 'Lumiere Dev Org'

/** Prefer demo org, then minimal dev org, then lowest id (deterministic). */
const ORG_NAME_PRIORITY = [DEMO_ORG_NAME, DEV_MINIMAL_ORG_NAME]

async function bootstrapPlatformCredential(adminToken) {
  const base = (process.env['LUMIERE_API_SERVER_URL'] ?? 'http://127.0.0.1:8082').replace(/\/$/, '')
  const res = await fetch(`${base}/v1/auth/internal/bootstrap-credential`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
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

/**
 * Picks which tenant to attach test@email.com to. Matches `seed_dev_data` / `ensure_dev_admin` naming in spacetimedb/src/seed.rs.
 */
async function resolveTargetOrg(host, moduleName, adminToken) {
  for (const wantedName of ORG_NAME_PRIORITY) {
    const safe = wantedName.replace(/'/g, "''")
    const rows = await queryStdb(
      host,
      moduleName,
      adminToken,
      `SELECT id, name FROM organization WHERE name = '${safe}' LIMIT 1`,
    )
    if (rows.length > 0) {
      const row = rows[0]
      console.log(
        `[seed-test-user] Target org: id=${row.id} name="${row.name}" (matched "${wantedName}").`,
      )
      return Number(row.id)
    }
  }
  const any = await queryStdb(
    host,
    moduleName,
    adminToken,
    `SELECT id, name FROM organization LIMIT 1`,
  )
  if (any.length === 0) {
    console.error(
      '[seed-test-user] No organization found. Run seed_dev_data or ensure_minimal_dev_org first.',
    )
    process.exit(1)
  }
  const row = any[0]
  console.log(
    `[seed-test-user] No "${DEMO_ORG_NAME}" or "${DEV_MINIMAL_ORG_NAME}" — using arbitrary first org row: id=${row.id} name="${row.name}".`,
  )
  return Number(row.id)
}

async function resolveAdminRoleId(host, moduleName, adminToken, orgId) {
  const rows = await queryStdb(
    host,
    moduleName,
    adminToken,
    `SELECT id, name FROM role WHERE organization_id = ${orgId}`,
  )
  const admin = rows.find((r) => String(r.name ?? '').toLowerCase() === 'admin')
  if (!admin?.id) {
    throw new Error(`admin role not found for org ${orgId}`)
  }
  return Number(admin.id)
}

async function ensureAdminRoleAssignment(host, moduleName, adminToken, identityForReducer, orgId) {
  const roleId = await resolveAdminRoleId(host, moduleName, adminToken, orgId)
  try {
    await callStdbReducer(host, moduleName, adminToken, 'assign_role', [
      identityForReducer,
      roleId,
      orgId,
      { expires_at_micros: null, metadata: null },
    ])
    console.log(`[seed-test-user] assign_role OK (org_id=${orgId}, role_id=${roleId}).`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('already has this role')) {
      console.log(`[seed-test-user] assign_role skipped (already assigned).`)
      return
    }
    throw e
  }
}

async function main() {
  loadEnvLocal()

  const host = getStdbHost()
  const moduleName = getRequiredModuleName('seed-test-user')
  const adminToken = resolveStdbToken(host)

  await callStdbReducer(host, moduleName, adminToken, 'dev_promote_caller_superuser', [])
  console.log('[seed-test-user] dev_promote_caller_superuser OK (HTTP token identity is superuser).')

  const credential = await bootstrapPlatformCredential(adminToken)
  if (!credential.identity || !credential.platformUserId) {
    throw new Error('Platform credential bootstrap returned an incomplete binding')
  }
  const identityForReducer = toIdentityReducerArg(credential.identity)
  console.log('[seed-test-user] Platform credential ready.')

  const orgId = await resolveTargetOrg(host, moduleName, adminToken)

  const addParams = {
    role_name: 'admin',
    company_id: null,
    job_title: null,
    department_id: null,
    employee_id: null,
    is_active: true,
    is_default: true,
    metadata: null,
  }

  try {
    await callStdbReducer(host, moduleName, adminToken, 'add_org_member', [
      identityForReducer,
      orgId,
      addParams,
    ])
    console.log(`[seed-test-user] add_org_member OK (org_id=${orgId}, role=admin).`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('already an active member')) {
      console.log(`[seed-test-user] User already in org ${orgId}; continuing.`)
    } else {
      throw e
    }
  }

  await callStdbReducer(host, moduleName, adminToken, 'bind_user_credential', [
    credential.platformUserId,
    identityForReducer,
    TEST_EMAIL,
  ])
  await callStdbReducer(host, moduleName, adminToken, 'bind_user_profile', [
    credential.platformUserId,
    identityForReducer,
  ])
  console.log('[seed-test-user] Organization-owned credential/profile bindings ready.')

  await ensureAdminRoleAssignment(host, moduleName, adminToken, identityForReducer, orgId)

  console.log(`[seed-test-user] Ready: sign in as ${TEST_EMAIL} with the seeded password.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
