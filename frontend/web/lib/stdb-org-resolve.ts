/**
 * Resolve user_organization rows for an identity. Tries the caller's SpacetimeDB JWT first;
 * if that returns nothing or errors (expired token, SQL rejection), falls back to STDB_SERVER_TOKEN
 * so server-side session and sign-in redirect stay aligned with seeded data.
 *
 * Import only from server code (API routes, RSC).
 */
import 'server-only'

import {
  serverQueryUserOrganization,
  type StdbHttpOptions,
} from '@lumiere/stdb/server'
import { getDefaultStdbHttpConnect, normalizeIdentityHexForSql } from '@/lib/stdb-http-env'

const ADMIN_TOKEN_PLACEHOLDERS = new Set([
  '',
  'your-server-token-here',
  'changeme',
  'replace-me',
  'replace_me',
])

function isUsableAdminToken(raw: string | undefined): boolean {
  const t = raw?.trim()
  if (!t) return false
  return !ADMIN_TOKEN_PLACEHOLDERS.has(t.toLowerCase())
}

/**
 * Lists active user_organization rows for `identityHex`, preferring `userOpts.token` and
 * retrying with `STDB_SERVER_TOKEN` when needed.
 */
export async function serverQueryUserOrganizationWithFallback(
  identityHex: string,
  userOpts: StdbHttpOptions,
): Promise<unknown[]> {
  const id = normalizeIdentityHexForSql(identityHex)
  const base = getDefaultStdbHttpConnect()
  const opts: StdbHttpOptions = { ...base, ...userOpts }

  try {
    const rows = await serverQueryUserOrganization(id, opts)
    if (Array.isArray(rows) && rows.length > 0) return rows
  } catch {
    // Expired JWT, InvalidToken, or transient SQL failure — try admin below.
  }

  const admin = process.env['STDB_SERVER_TOKEN']
  if (!isUsableAdminToken(admin)) return []

  try {
    const rows = await serverQueryUserOrganization(id, {
      ...opts,
      token: admin,
    })
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}
