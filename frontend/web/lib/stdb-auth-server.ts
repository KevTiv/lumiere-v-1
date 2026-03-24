/**
 * Server-only SpacetimeDB auth utilities.
 *
 * Import ONLY from API route handlers and server actions.
 * Never import in "use client" components.
 */
import 'server-only'

import bcrypt from 'bcryptjs'

const STDB_HOST = process.env['NEXT_PUBLIC_STDB_HOST']?.replace(/^wss?:\/\//, 'https://') ?? 'https://maincloud.spacetimedb.com'
const STDB_MODULE = process.env['NEXT_PUBLIC_STDB_MODULE'] ?? 'lumiere-v1-j1uo0'
const STDB_ADMIN_TOKEN = process.env['STDB_SERVER_TOKEN']
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
  const url = `${STDB_HOST}/v1/identity`
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
  const url = `${STDB_HOST}/v1/database/${STDB_MODULE}/call/${reducerName}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STDB_ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Reducer ${reducerName} failed: ${res.status} ${body}`)
  }
}

/**
 * Query a private SpacetimeDB table via HTTP SQL API using the admin token.
 */
export async function queryStdb<T>(sql: string): Promise<T[]> {
  if (!STDB_ADMIN_TOKEN) throw new Error('STDB_SERVER_TOKEN is not configured')
  const url = `${STDB_HOST}/v1/database/${STDB_MODULE}/sql`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STDB_ADMIN_TOKEN}`,
      'Content-Type': 'text/plain',
    },
    body: sql,
  })
  if (!res.ok) {
    throw new Error(`SpacetimeDB SQL query failed: ${res.status} ${await res.text()}`)
  }
  // SpacetimeDB SQL API returns [{rows: [...], columns: [...]}]
  const result = await res.json() as Array<{ rows: unknown[][]; columns: Array<{ name: string }> }>
  if (!result[0]) return []
  const { rows, columns } = result[0]
  return rows.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => { obj[col.name] = row[i] })
    return obj as T
  })
}

// ─── Credential lookup ────────────────────────────────────────────────────────

export interface StdbCredential {
  id: number
  email: string
  identity: string
  password_hash: string
  stdb_token_enc: string
  email_verified: boolean
}

/** Look up a user credential by email. Returns null if not found. */
export async function findCredentialByEmail(email: string): Promise<StdbCredential | null> {
  // Escape single quotes in email to prevent SQL injection
  const safeEmail = email.replace(/'/g, "''")
  const rows = await queryStdb<StdbCredential>(
    `SELECT id, email, identity, password_hash, stdb_token_enc, email_verified FROM user_credential WHERE email = '${safeEmail}'`
  )
  return rows[0] ?? null
}

/** Look up a user credential by identity hex. Returns null if not found. */
export async function findCredentialByIdentity(identityHex: string): Promise<StdbCredential | null> {
  const rows = await queryStdb<StdbCredential>(
    `SELECT id, email, identity, password_hash, stdb_token_enc, email_verified FROM user_credential WHERE identity = 0x${identityHex.replace(/^0x/, '')}`
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
