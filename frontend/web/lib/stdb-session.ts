/**
 * Server-only SpacetimeDB session utilities.
 *
 * Import ONLY from React Server Components, server actions, or route handlers.
 * Never import in "use client" components — it will throw at runtime.
 *
 * Usage:
 *   const { organizationId, opts } = await getStdbSession()
 *   const accounts = await serverQueryAccountAccounts(organizationId, opts)
 */

import { cookies } from 'next/headers'
import {
  serverQueryUserOrganization,
  type StdbHttpOptions,
} from '@lumiere/stdb/server'

export interface StdbSession {
  /** SpacetimeDB auth token — undefined if user has never connected via WebSocket */
  token: string | undefined
  /** User identity hex — undefined if user has never connected via WebSocket */
  identityHex: string | undefined
  /**
   * Organization ID resolved from the user's user_organization record.
   * This is the correct top-level scoping value for all business data queries.
   * Undefined if the user has no organization membership yet.
   */
  organizationId: number | undefined
  /** Pre-built StdbHttpOptions ready to pass to server query functions */
  opts: StdbHttpOptions
}

/**
 * Reads the SpacetimeDB session from HTTP-only cookies and resolves the
 * user's organization_id from their user_organization record.
 *
 * On the very first visit (no cookie yet) returns undefined for all fields.
 * Server queries will return empty arrays and the client hydrates via WebSocket.
 */
export async function getStdbSession(): Promise<StdbSession> {
  // Dev mode: bypass cookie lookup entirely and use a hardcoded org ID.
  // Set DEV_MOCK_ORG_ID=1 in .env.local when running locally with seed data.
  const mockOrgId = process.env['DEV_MOCK_ORG_ID']
  if (mockOrgId) {
    return {
      token: process.env['STDB_SERVER_TOKEN'],
      identityHex: undefined,
      organizationId: Number(mockOrgId),
      opts: { token: process.env['STDB_SERVER_TOKEN'] },
    }
  }

  const store = await cookies()
  const token =
    store.get('stdb_token')?.value ??
    process.env['STDB_SERVER_TOKEN']
  const identityHex = store.get('stdb_identity')?.value
  const opts: StdbHttpOptions = { token }

  let organizationId: number | undefined

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

  return { token, identityHex, organizationId, opts }
}
