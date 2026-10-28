/**
 * Resolve BFF/SSR sessions through the Rust API's identity and access authority.
 * Browser credentials come from AuthKit in hosted mode or native HTTP-only
 * cookies; explicit mobile/API bearer credentials always take precedence.
 */

import { isWorkOsEnabled } from '@/lib/auth-mode'
import { resolveRequestCredentials } from '@/lib/auth-credentials'
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
  /** API bearer credential: WorkOS access token in hosted mode, STDB token in native mode. */
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
 * - AuthKit's hosted browser session, or native HTTP-only cookie (`stdb_token`)
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
  try {
    const credentials = await resolveRequestCredentials(req)
    token = credentials.token
    credentialsPresented = credentials.presented
  } catch {
    // Session lookup failures must not select a different authentication authority.
    return null
  }

  // Anonymous local development only: never replace an explicit caller's credentials.
  if (!isWorkOsEnabled() && !credentialsPresented && !runtimeIsProduction() && process.env['DEV_MOCK_ORG_ID']) {
    token = process.env['STDB_SERVER_TOKEN']?.trim()
  }

  if (!token) return null
  let verified = await fetchVerifiedSession(token)
  if (!verified) return null
  const opts: StdbHttpOptions = { token }

  if (
    !isWorkOsEnabled() &&
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
