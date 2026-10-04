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
import { callReducer } from '@/lib/stdb-reducer'

/** Mirrors `stdb_config::runtime_is_production` — dev bypasses must not run in prod. */
export function runtimeIsProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.LUMIERE_ENV === 'production'
  )
}

/** Optional provisioning for an already authenticated development caller. */
const DEV_ADMIN_AUTO_ORG = process.env.NEXT_PUBLIC_DEV_ADMIN_AUTO_ORG === 'true'

const DEV_ADMIN_ENABLED = process.env.NEXT_PUBLIC_DEV_ADMIN === 'true'

type VerifiedSession = {
  identityHex: string
  organizationId: number | undefined
  fieldAccess?: FieldAccessContext
}

/** Resolve actor, membership and policy together from the trusted API authority. */
async function fetchVerifiedSession(token: string): Promise<VerifiedSession | null> {
  const base = resolveApiServerBaseUrl()
  if (!base) return null

  try {
    const res = await fetch(`${base}/v1/session/field-access`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      identityHex?: unknown
      organizationId?: unknown
      fieldAccess?: FieldAccessContext | null
    }
    if (typeof data.identityHex !== 'string' || !/^[0-9a-f]{64}$/i.test(data.identityHex)) return null
    if (data.organizationId != null &&
      (typeof data.organizationId !== 'number' || !Number.isSafeInteger(data.organizationId) || data.organizationId <= 0)) return null
    return {
      identityHex: data.identityHex,
      organizationId: (data.organizationId ?? undefined) as number | undefined,
      fieldAccess: data.fieldAccess ?? undefined,
    }
  } catch {
    return null
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
  /** Field-permission + role context for field-level SQL projection on `/api/query` */
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
  let token: string | undefined
  let credentialsPresented = false

  if (req) {
    const authHeader = req.headers.get('authorization')
    credentialsPresented = authHeader !== null
    if (authHeader !== null) {
      // Explicit credentials must never fall back to the server's development identity.
      if (!authHeader.startsWith('Bearer ') || !authHeader.slice(7).trim()) return null
      token = authHeader.slice(7).trim()
    }
  }

  // Web: If no bearer credentials were supplied, try the browser session.
  if (!credentialsPresented) {
    try {
      const store = await cookies()
      const tokenCookie = store.get('stdb_token')
      credentialsPresented = tokenCookie !== undefined
      token = tokenCookie?.value.trim()
    } catch {
      // Cookies() throws outside a request context.
    }
  }

  // Anonymous local development only: never replace an explicit caller's credentials.
  if (!credentialsPresented && !runtimeIsProduction() && process.env['DEV_MOCK_ORG_ID']) {
    token = process.env['STDB_SERVER_TOKEN']?.trim()
  }

  if (!token) return null
  let verified = await fetchVerifiedSession(token)
  if (!verified) return null
  const opts: StdbHttpOptions = { token }

  if (
    !runtimeIsProduction() &&
    DEV_ADMIN_ENABLED &&
    DEV_ADMIN_AUTO_ORG &&
    verified.organizationId === undefined
  ) {
    try {
      await callReducer('ensure_dev_admin', [], opts)
      const provisioned = await fetchVerifiedSession(token)
      if (!provisioned) return null
      verified = provisioned
    } catch {
      // Remain authenticated but without membership; never infer a seeded org.
    }
  }

  return {
    stdbToken: token,
    opts,
    ...verified,
  }
}
