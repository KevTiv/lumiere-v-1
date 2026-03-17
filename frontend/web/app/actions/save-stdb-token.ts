'use server'

import { cookies } from 'next/headers'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days
}

/**
 * Bridges the SpacetimeDB WebSocket session to the server via HTTP-only cookies.
 * Called by StdbConnectionProvider after a successful WebSocket connection.
 *
 * Sets two cookies:
 *   stdb_token    — auth token (for authenticated HTTP SQL queries server-side)
 *   stdb_identity — identity hex (for per-user data scoping and Casbin filtering)
 *
 * Note: organization_id is resolved server-side from user_organization using
 * the identity, so it does not need to be stored separately here.
 */
export async function saveStdbSession(
  token: string,
  identityHex: string,
): Promise<void> {
  const store = await cookies()
  store.set('stdb_token', token, COOKIE_OPTS)
  store.set('stdb_identity', identityHex, COOKIE_OPTS)
}

export async function clearStdbSession(): Promise<void> {
  const store = await cookies()
  store.delete('stdb_token')
  store.delete('stdb_identity')
}
