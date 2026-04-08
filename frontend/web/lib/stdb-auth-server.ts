/**
 * Server-only SpacetimeDB auth utilities.
 *
 * Import ONLY from API route handlers and server actions.
 * Never import in "use client" components.
 */
import 'server-only'

import { stringifyReducerCallBody } from '@lumiere/api-client'
import bcrypt from 'bcryptjs'
import { stdbSql } from '@lumiere/stdb/server'
import { getDefaultStdbHttpConnect } from '@/lib/stdb-http-env'

const STDB_TOKEN_PLACEHOLDERS = new Set([
  '',
  'your-server-token-here',
  'changeme',
  'replace-me',
  'replace_me',
])

function resolveStdbAdminToken(): string | undefined {
  const raw = process.env['STDB_SERVER_TOKEN']?.trim()
  if (!raw) return undefined
  if (STDB_TOKEN_PLACEHOLDERS.has(raw)) {
    return undefined
  }
  return raw
}

const STDB_ADMIN_TOKEN = resolveStdbAdminToken()
const ENCRYPTION_KEY_HEX = process.env['STDB_CREDENTIAL_ENCRYPTION_KEY']

// ─── Encryption ──────────────────────────────────────────────────────────────

function getEncryptionKey(): Uint8Array {
  if (!ENCRYPTION_KEY_HEX || ENCRYPTION_KEY_HEX.length < 64) {
    throw new Error('STDB_CREDENTIAL_ENCRYPTION_KEY must be a 32-byte (64 hex char) env var')
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(ENCRYPTION_KEY_HEX.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * AES-GCM encrypt a string. Returns base64(iv + ciphertext).
 */
export async function encryptToken(plaintext: string): Promise<string> {
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

/**
 * AES-GCM decrypt a base64(iv + ciphertext) string back to plaintext.
 */
export async function decryptToken(b64: string): Promise<string> {
  const keyBytes = getEncryptionKey()
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
  const combined = Buffer.from(b64, 'base64')
  const iv = combined.subarray(0, 12)
  const ciphertext = combined.subarray(12)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}

// ─── Password hashing ─────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ─── SpacetimeDB HTTP API ─────────────────────────────────────────────────────

/**
 * Provision a brand-new SpacetimeDB identity server-side.
 * Uses POST /v1/identity which requires no auth — SpacetimeDB creates a new
 * anonymous identity and returns its token. The token is the credential.
 */
export async function provisionStdbIdentity(): Promise<{ identity: string; token: string }> {
  const { host } = getDefaultStdbHttpConnect()
  const url = `${host}/v1/identity`
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`SpacetimeDB identity provisioning failed: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<{ identity: string; token: string }>
}

/**
 * Call a SpacetimeDB reducer via HTTP using the admin token.
 * ctx.sender() in the reducer will be the admin identity (is_superuser = true).
 */
export async function callStdbReducer(reducerName: string, args: unknown[]): Promise<void> {
  if (!STDB_ADMIN_TOKEN) throw new Error('STDB_SERVER_TOKEN is not configured')
  const { host, module } = getDefaultStdbHttpConnect()
  const url = `${host}/v1/database/${module}/call/${reducerName}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STDB_ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: stringifyReducerCallBody(args),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Reducer ${reducerName} failed: ${res.status} ${body}`)
  }
}

/** Match camelCase keys from `@lumiere/stdb` stdbSql to existing snake_case row types. */
function camelToSnakeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
}

function rowCamelToSnake(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    out[camelToSnakeKey(k)] = v
  }
  return out
}

/**
 * SpacetimeDB 2.x SATS-JSON encodes Identity as hex string, 32-byte array, or one-element ["0x..."].
 * Normalize to a 64-character lowercase hex string (no 0x) for cookies and SQL helpers.
 */
function normalizeIdentitySqlValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') {
    return value.replace(/^0x/i, '')
  }
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    return normalizeIdentitySqlValue(value[0])
  }
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const buf = value instanceof Uint8Array ? value : Uint8Array.from(value as number[])
    if (buf.length !== 32) {
      throw new Error(
        `Identity byte array must be 32 bytes; got ${buf.length}: ${JSON.stringify(value)}`,
      )
    }
    return Buffer.from(buf).toString('hex')
  }
  if (typeof value === 'object' && '__identity__' in (value as object)) {
    const inner = (value as { __identity__: unknown }).__identity__
    if (typeof inner === 'string') {
      return inner.replace(/^0x/i, '')
    }
    if (Array.isArray(inner) || inner instanceof Uint8Array) {
      return normalizeIdentitySqlValue(inner)
    }
  }
  throw new Error(`Unexpected Identity value from SQL: ${JSON.stringify(value)}`)
}

const IDENTITY_COLUMNS_SNAKE = new Set(['identity', 'invited_by', 'user_identity'])

function normalizeIdentityColumns(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row }
  for (const key of Object.keys(out)) {
    if (!IDENTITY_COLUMNS_SNAKE.has(key) || out[key] == null) continue
    out[key] = normalizeIdentitySqlValue(out[key])
  }
  return out
}

/**
 * Query a private SpacetimeDB table via HTTP SQL API using the admin token.
 * Uses SpacetimeDB 2.x SATS-JSON parsing (same as `@lumiere/stdb` stdbSql), then maps rows to snake_case.
 */
export async function queryStdb<T>(sql: string): Promise<T[]> {
  if (!STDB_ADMIN_TOKEN) throw new Error('STDB_SERVER_TOKEN is not configured')
  const { host, module } = getDefaultStdbHttpConnect()
  try {
    const rows = await stdbSql<Record<string, unknown>>(sql, {
      host,
      module,
      token: STDB_ADMIN_TOKEN,
    })
    return rows.map((row) => normalizeIdentityColumns(rowCamelToSnake(row)) as T)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('404') && (msg.includes('not found') || msg.includes('Not found'))) {
      throw new Error(
        `${msg} — Database name "${module}" does not exist on this server. ` +
          `Set NEXT_PUBLIC_STDB_MODULE and STDB_MODULE in frontend/web/.env.local to the exact name from ` +
          `\`spacetime publish <name>\` (Makefile DB is often lumiere-v1-j1uo0).`,
      )
    }
    throw err
  }
}

// ─── Credential lookup ────────────────────────────────────────────────────────

export interface StdbCredential {
  id: number
  email: string
  identity: string
  password_hash: string
  stdb_token_enc: string
  email_verified: boolean
  /** Present when the row was created via WorkOS SSO or linked. */
  workos_user_id: string | null
}

const CREDENTIAL_SELECT =
  'SELECT id, email, identity, password_hash, stdb_token_enc, email_verified, workos_user_id FROM user_credential'

/** Look up a user credential by email. Returns null if not found. */
export async function findCredentialByEmail(email: string): Promise<StdbCredential | null> {
  // Escape single quotes in email to prevent SQL injection
  const safeEmail = email.replace(/'/g, "''")
  const rows = await queryStdb<StdbCredential>(
    `${CREDENTIAL_SELECT} WHERE email = '${safeEmail}'`
  )
  return rows[0] ?? null
}

/** Case-insensitive at the app layer; SpacetimeDB SQL does not support `LOWER()`. */
export async function findCredentialByEmailCaseInsensitive(email: string): Promise<StdbCredential | null> {
  return findCredentialByEmail(email.trim().toLowerCase())
}

/** Look up a user credential by identity hex. Returns null if not found. */
export async function findCredentialByIdentity(identityHex: string): Promise<StdbCredential | null> {
  const rows = await queryStdb<StdbCredential>(
    `${CREDENTIAL_SELECT} WHERE identity = 0x${identityHex.replace(/^0x/, '')}`
  )
  return rows[0] ?? null
}

/** Look up a user credential by WorkOS user id. Returns null if not found. */
export async function findCredentialByWorkosUserId(workosUserId: string): Promise<StdbCredential | null> {
  const safe = workosUserId.replace(/'/g, "''")
  const rows = await queryStdb<StdbCredential>(
    `${CREDENTIAL_SELECT} WHERE workos_user_id = '${safe}'`
  )
  return rows[0] ?? null
}

export interface StdbInvite {
  id: number
  organization_id: number
  role_id: number
  email: string
  token_hash: string
  invited_by: string
  expires_at: number  // microseconds since unix epoch
  accepted_at: number | null
}

/** Look up an invite by its SHA-256 token hash. */
export async function findInviteByTokenHash(tokenHash: string): Promise<StdbInvite | null> {
  const rows = await queryStdb<StdbInvite>(
    `SELECT id, organization_id, role_id, email, token_hash, invited_by, expires_at, accepted_at FROM user_invite WHERE token_hash = '${tokenHash}'`
  )
  return rows[0] ?? null
}

/** Resolve role display name for `add_org_member` (role name, not numeric id). */
export async function getRoleNameInOrganization(
  roleId: number,
  organizationId: number,
): Promise<string | null> {
  const rows = await queryStdb<{ name: string }>(
    `SELECT name FROM role WHERE id = ${roleId} AND organization_id = ${organizationId}`,
  )
  return rows[0]?.name ?? null
}

export interface StdbResetToken {
  id: number
  identity: string
  token_hash: string
  expires_at: number  // microseconds since unix epoch
  used_at: number | null
}

/** Look up a password reset token by its SHA-256 token hash. */
export async function findResetTokenByHash(tokenHash: string): Promise<StdbResetToken | null> {
  const rows = await queryStdb<StdbResetToken>(
    `SELECT id, identity, token_hash, expires_at, used_at FROM password_reset_token WHERE token_hash = '${tokenHash}'`
  )
  return rows[0] ?? null
}

// ─── Token helpers ─────────────────────────────────────────────────────────────

/** Generate a cryptographically secure URL-safe token and its SHA-256 hash. */
export async function generateSecureToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Buffer.from(bytes).toString('base64url')
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = Buffer.from(hashBuffer).toString('hex')
  return { token, tokenHash }
}

/** Current time in microseconds since Unix epoch (matches SpacetimeDB Timestamp). */
export function nowMicros(): bigint {
  return BigInt(Date.now()) * 1000n
}

/** Microseconds → Date */
export function microsToDate(micros: number): Date {
  return new Date(Math.floor(micros / 1000))
}
