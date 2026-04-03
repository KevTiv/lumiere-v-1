/**
 * Provisions test@email.com / Password123$ with admin org membership (local dev).
 *
 * Mirrors frontend/web/lib/stdb-auth-server.ts + signup + accept-invite reducer calls.
 *
 * Before admin reducers, calls `dev_promote_caller_superuser` so the JWT identity used for
 * `STDB_SERVER_TOKEN` gets `user_profile.is_superuser` (required by `store_user_credential`).
 * Publish the module after pulling this reducer; do not expose that reducer on untrusted hosts.
 *
 * Usage (from repo root or frontend/web):
 *   pnpm --dir frontend/web run seed-test-user
 *   # or: make seed-test-user
 *
 * Org selection: prefers "Lumiere Demo Corp" (seed_dev_data), then "Lumiere Dev Org" (ensure_minimal_dev_org),
 * else first organization row (LIMIT 1; SpacetimeDB HTTP SQL does not support ORDER BY here).
 *
 * Env: NEXT_PUBLIC_STDB_HOST, NEXT_PUBLIC_STDB_MODULE, STDB_SERVER_TOKEN,
 *      STDB_CREDENTIAL_ENCRYPTION_KEY (same as Next .env.local).
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

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const TEST_EMAIL = 'test@email.com'
const TEST_PASSWORD = 'Password123$'
/** Full demo dataset from `seed_dev_data` (Rust). */
const DEMO_ORG_NAME = 'Lumiere Demo Corp'
/** Minimal org from `ensure_minimal_dev_org` / `ensure_dev_admin`. */
const DEV_MINIMAL_ORG_NAME = 'Lumiere Dev Org'

/** Prefer demo org, then minimal dev org, then lowest id (deterministic). */
const ORG_NAME_PRIORITY = [DEMO_ORG_NAME, DEV_MINIMAL_ORG_NAME]

/** Parse frontend/web/.env.local: last duplicate key wins; only fills process.env keys that are empty. */
function loadEnvLocal() {
  const p = join(__dirname, '..', '.env.local')
  if (!existsSync(p)) return
  const text = readFileSync(p, 'utf8')
  const map = new Map()
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    map.set(k, v)
  }
  for (const [k, v] of map) {
    if (!String(process.env[k] ?? '').trim() && String(v).trim()) {
      process.env[k] = v
    }
  }
}

function getStdbHost() {
  const raw = process.env['NEXT_PUBLIC_STDB_HOST'] ?? 'https://maincloud.spacetimedb.com'
  return raw.replace(/^wss?:\/\//, 'https://')
}

const TOKEN_PLACEHOLDERS = new Set([
  'your-server-token-here',
  'changeme',
  'replace-me',
  'replace_me',
])

/** True when the HTTP API host is this machine (tokens must be issued by that server). */
function isLocalStdbHost(hostUrl) {
  try {
    const u = new URL(hostUrl.startsWith('http') ? hostUrl : `https://${hostUrl}`)
    const h = u.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1'
  } catch {
    return false
  }
}

/** Read spacetimedb_token from Spacetime CLI config (same JWT many devs use for STDB_SERVER_TOKEN). */
function readSpacetimeCliTomlToken() {
  const p = join(homedir(), '.config', 'spacetime', 'cli.toml')
  if (!existsSync(p)) return null
  const text = readFileSync(p, 'utf8')
  const m = text.match(/spacetimedb_token\s*=\s*"([^"]+)"/)
  return m ? m[1].trim() : null
}

/** Decode JWT iss claim without verifying (for routing hints only). */
function jwtIssuerUnsafe(token) {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    return typeof payload.iss === 'string' ? payload.iss : null
  } catch {
    return null
  }
}

/**
 * Resolves Bearer token for /v1/database calls. Trims env; rejects placeholders;
 * falls back to ~/.config/spacetime/cli.toml. Fails fast if local host + maincloud JWT.
 */
function resolveStdbToken(host) {
  let t = process.env['STDB_SERVER_TOKEN']?.trim() ?? ''
  if (!t || TOKEN_PLACEHOLDERS.has(t.toLowerCase())) {
    t = readSpacetimeCliTomlToken() ?? ''
  }
  if (!t) {
    throw new Error(
      'STDB_SERVER_TOKEN is missing or still a placeholder. Set it in frontend/web/.env.local to a real JWT, ' +
        'or run `spacetime login` (maincloud) or `spacetime login --server-issued-login local` (local server) ' +
        'so ~/.config/spacetime/cli.toml contains spacetimedb_token.',
    )
  }

  const local = isLocalStdbHost(host)
  const iss = jwtIssuerUnsafe(t)
  if (local && iss && iss.includes('auth.spacetimedb.com')) {
    throw new Error(
      `STDB_SERVER_TOKEN is a maincloud login JWT, but NEXT_PUBLIC_STDB_HOST targets a local server (${host}). ` +
        'SpacetimeDB tokens are not portable between clusters.\n' +
        'Run:\n' +
        '  spacetime login --server-issued-login local\n' +
        'Then set STDB_SERVER_TOKEN to the spacetimedb_token in ~/.config/spacetime/cli.toml (or export it) and re-run. ' +
        'If you use maincloud, set NEXT_PUBLIC_STDB_HOST to https://maincloud.spacetimedb.com instead.',
    )
  }

  return t
}

function authErrorHint(host, status, body) {
  if (status !== 401) return ''
  const local = isLocalStdbHost(host)
  const extra = local
    ? ' For local: use a token from `spacetime login --server-issued-login local`, not a maincloud-only token.'
    : ' Check `spacetime login` and that STDB_SERVER_TOKEN matches spacetimedb_token in ~/.config/spacetime/cli.toml.'
  return (
    `\n(${status} ${body.trim()}. JWT may be wrong/expired or for a different cluster.${extra})`
  )
}

function getEncryptionKey() {
  const hex = process.env['STDB_CREDENTIAL_ENCRYPTION_KEY']?.trim() ?? ''
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      'STDB_CREDENTIAL_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes), same as Next.js ' +
        'frontend/web/lib/stdb-auth-server.ts. Add it to frontend/web/.env.local (or export it). ' +
        'Generate one with: openssl rand -hex 32',
    )
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

async function encryptToken(plaintext) {
  const keyBytes = getEncryptionKey()
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  const combined = new Uint8Array(12 + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), 12)
  return Buffer.from(combined).toString('base64')
}

async function provisionStdbIdentity(host) {
  const url = `${host}/v1/identity`
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`SpacetimeDB identity provisioning failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function callStdbReducer(host, moduleName, token, reducerName, args) {
  if (!token) throw new Error('STDB_SERVER_TOKEN is not configured')
  const url = `${host}/v1/database/${moduleName}/call/${reducerName}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `Reducer ${reducerName} failed: ${res.status} ${body}${authErrorHint(host, res.status, body)}`,
    )
  }
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

async function main() {
  loadEnvLocal()

  const host = getStdbHost()
  const moduleName = process.env['NEXT_PUBLIC_STDB_MODULE'] ?? 'lumiere-v1-j1uo0'
  const adminToken = resolveStdbToken(host)

  await callStdbReducer(host, moduleName, adminToken, 'dev_promote_caller_superuser', [])
  console.log('[seed-test-user] dev_promote_caller_superuser OK (HTTP token identity is superuser).')

  const safeEmail = TEST_EMAIL.replace(/'/g, "''")

  let identityForReducer
  const existing = await queryStdb(
    host,
    moduleName,
    adminToken,
    `SELECT identity FROM user_credential WHERE email = '${safeEmail}'`,
  )

  if (existing.length > 0) {
    console.log(`[seed-test-user] Credential exists for ${TEST_EMAIL}; skipping store_user_credential.`)
    identityForReducer = toIdentityReducerArg(existing[0].identity)
  } else {
    console.log(`[seed-test-user] Provisioning identity and credentials…`)
    const { identity, token } = await provisionStdbIdentity(host)
    identityForReducer = toIdentityReducerArg(identity)
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 12)
    const tokenEnc = await encryptToken(token)
    await callStdbReducer(host, moduleName, adminToken, 'store_user_credential', [
      identityForReducer,
      TEST_EMAIL,
      passwordHash,
      tokenEnc,
    ])
    console.log('[seed-test-user] store_user_credential OK.')
  }

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
      console.log(`[seed-test-user] User already in org ${orgId}; done.`)
    } else {
      throw e
    }
  }

  console.log(`[seed-test-user] Ready: sign in as ${TEST_EMAIL} with the seeded password.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
