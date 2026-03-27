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
import {
  serverQueryUserOrganization,
  type StdbHttpOptions,
} from '@lumiere/stdb/server'

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
    return {
      stdbToken: mockToken,
      identityHex: 'dev-mock-identity',
      organizationId: Number(mockOrgId),
      opts: { token: mockToken },
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

  // If still no token, try server token as fallback
  if (!token) {
    token = process.env['STDB_SERVER_TOKEN']
  }

  if (!token) {
    return null
  }

  const opts: StdbHttpOptions = { token }

  let organizationId: number | undefined

  // Only try to resolve organization if we have an identity
  if (identityHex) {
    try {
      const orgs = await serverQueryUserOrganization(identityHex, opts)
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

  return {
    stdbToken: token,
    identityHex: identityHex || 'unknown',
    organizationId,
    opts,
  }
}
