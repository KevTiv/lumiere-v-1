/**
 * Universal API Session Resolver
 *
 * Works for both:
 * - Web: Extracts session from HTTP-only cookies
 * - Expo/Mobile: Extracts session from Authorization: Bearer <token> header
 *
 * Phase 1 of API Gateway Refactor Plan
 */

import { cookies } from 'next/headers'
import type { FieldAccessContext, StdbHttpOptions } from '@lumiere/stdb/server'
import { resolveApiServerBaseUrl } from '@/lib/api-server-forward'
import { serverQueryUserOrganizationWithFallback } from '@/lib/stdb-org-resolve'
import { callReducer } from '@/lib/stdb-reducer'
import { decodeIdentityHexFromStdbToken } from '@/lib/stdb-token-identity'

/** When true with `NEXT_PUBLIC_DEV_ADMIN`, auto-call `ensure_dev_admin` and dev seed org fallbacks. */
const DEV_ADMIN_AUTO_ORG = process.env.NEXT_PUBLIC_DEV_ADMIN_AUTO_ORG === 'true'

const DEV_ADMIN_ENABLED = process.env.NEXT_PUBLIC_DEV_ADMIN === 'true'

function devSeedOrgId(): number | undefined {
  const raw = process.env['NEXT_PUBLIC_DEV_SEED_ORG_ID'] ?? process.env['DEV_SEED_ORG_ID']
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Field-access context is built only on the Rust api-server (`load_field_access_context`); avoid duplicating STDB queries in Next. */
async function fetchFieldAccessFromApiServer(input: {
  token: string
  identityHex: string
  cookieHeader?: string
}): Promise<FieldAccessContext | undefined> {
  const base = resolveApiServerBaseUrl()
  if (!base) return undefined

  const headers = new Headers()
  headers.set('Authorization', `Bearer ${input.token.trim()}`)
  if (input.identityHex && input.identityHex !== 'unknown') {
    headers.set('x-stdb-identity', input.identityHex)
  }
  if (input.cookieHeader) {
    headers.set('Cookie', input.cookieHeader)
  }

  try {
    const res = await fetch(`${base}/v1/session/field-access`, {
      headers,
      cache: 'no-store',
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as { fieldAccess?: FieldAccessContext | null }
    return data.fieldAccess ?? undefined
  } catch {
    return undefined
  }
}

async function browserCookieHeader(): Promise<string | undefined> {
  try {
    const store = await cookies()
    const all = store.getAll()
    if (all.length === 0) return undefined
    return all.map((c) => `${c.name}=${c.value}`).join('; ')
  } catch {
    return undefined
  }
}

export interface ApiSession {
  /** SpacetimeDB auth token */
  stdbToken: string
  /** User identity hex */
  identityHex: string
  /**
   * Organization ID resolved from the user's user_organization record.
   * Undefined if the user has no organization membership yet.
   */
  organizationId: number | undefined
  /** Pre-built StdbHttpOptions ready to pass to server query functions */
  opts: StdbHttpOptions
  /** Casbin + role context for field-level SQL projection on `/api/query` */
  fieldAccess?: FieldAccessContext
}

/**
 * Resolves the API session from either:
 * - HTTP-only cookie (`stdb_token`) for web browser requests
 * - `Authorization: Bearer <token>` header for Expo/mobile requests
 *
 * @param req - Optional Request object (needed for Expo/mobile Bearer token extraction)
 * @returns ApiSession or null if no valid authentication found
 */
/** @alias resolveApiSession — preferred name for server components and route handlers */
export const getStdbSession = (req?: Request) => resolveApiSession(req)

export async function resolveApiSession(req?: Request): Promise<ApiSession | null> {
  // Dev mode: bypass cookie/header lookup entirely and use a hardcoded org ID.
  // Set DEV_MOCK_ORG_ID=1 in .env.local when running locally with seed data.
  const mockOrgId = process.env['DEV_MOCK_ORG_ID']
  const mockToken = process.env['STDB_SERVER_TOKEN']
  if (mockOrgId && mockToken) {
    const opts: StdbHttpOptions = { token: mockToken }
    const organizationId = Number(mockOrgId)
    const identityHex = 'dev-mock-identity'
    let fieldAccess: FieldAccessContext | undefined
    try {
      fieldAccess = await fetchFieldAccessFromApiServer({
        token: mockToken,
        identityHex,
      })
    } catch {
      fieldAccess = undefined
    }
    return {
      stdbToken: mockToken,
      identityHex,
      organizationId,
      opts,
      fieldAccess,
    }
  }

  let token: string | undefined
  let identityHex: string | undefined

  if (req) {
    // Expo/Mobile: Extract from Authorization header
    const authHeader = req.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    }

    // Try to get identity from custom header (Expo can send this)
    identityHex = req.headers.get('x-stdb-identity') || undefined
  }

  // Web: If no token from header, try cookies
  if (!token) {
    try {
      const store = await cookies()
      token = store.get('stdb_token')?.value ?? undefined
      identityHex = store.get('stdb_identity')?.value ?? undefined
    } catch {
      // Cookies() throws if called outside of request context
      // This is fine - we'll check for token below
    }
  }

  // If still no token, try server token as fallback (admin / server-side SQL)
  if (!token) {
    token = process.env['STDB_SERVER_TOKEN']
  }

  if (!token) {
    return null
  }

  // Recover identity from JWT when stdb_identity cookie is missing (e.g. legacy clients).
  if (!identityHex) {
    const fromJwt = decodeIdentityHexFromStdbToken(token)
    if (fromJwt) identityHex = fromJwt
  }

  const opts: StdbHttpOptions = { token }

  let organizationId: number | undefined

  // Only try to resolve organization if we have an identity
  if (identityHex) {
    try {
      const orgs = await serverQueryUserOrganizationWithFallback(identityHex, opts)
      const org = (orgs as Array<Record<string, unknown>>).find(
        (o) => o['isDefault'],
      ) ?? orgs[0]
      if (org) {
        organizationId = Number((org as Record<string, unknown>)['organizationId'])
      }
    } catch {
      // No organization yet — user hasn't completed onboarding
    }
  }

  // Dev: provision caller into the seeded / first org before RSC runs, so layout and
  // /api/query see organizationId (client WS also calls ensureDevAdmin — idempotent).
  if (
    DEV_ADMIN_ENABLED &&
    DEV_ADMIN_AUTO_ORG &&
    organizationId === undefined &&
    identityHex &&
    identityHex !== 'unknown'
  ) {
    try {
      await callReducer('ensure_dev_admin', [], opts)
      const orgs = await serverQueryUserOrganizationWithFallback(identityHex, opts)
      const org = (orgs as Array<Record<string, unknown>>).find(
        (o) => o['isDefault'],
      ) ?? orgs[0]
      if (org) {
        organizationId = Number((org as Record<string, unknown>)['organizationId'])
      }
    } catch {
      const fallbackId = devSeedOrgId()
      if (fallbackId !== undefined) organizationId = fallbackId
    }
  }

  // Dev admin: org id from env so /api/query and RSC role hydration work before membership sync.
  if (DEV_ADMIN_ENABLED && DEV_ADMIN_AUTO_ORG && organizationId === undefined) {
    const fallbackId = devSeedOrgId()
    if (fallbackId !== undefined) organizationId = fallbackId
  }

  const resolvedIdentity = identityHex || 'unknown'
  let fieldAccess: FieldAccessContext | undefined
  if (organizationId !== undefined && resolvedIdentity !== 'unknown') {
    const cookieHeader = req?.headers.get('cookie') ?? (await browserCookieHeader())
    try {
      fieldAccess = await fetchFieldAccessFromApiServer({
        token,
        identityHex: resolvedIdentity,
        cookieHeader: cookieHeader ?? undefined,
      })
    } catch {
      fieldAccess = undefined
    }
  }

  return {
    stdbToken: token,
    identityHex: resolvedIdentity,
    organizationId,
    opts,
    fieldAccess,
  }
}
