'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

const cookieSecure =
  process.env.NODE_ENV === 'production' || process.env['COOKIE_FORCE_SECURE'] === 'true'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: cookieSecure,
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
  revalidatePath('/', 'layout')
}

export async function clearStdbSession(): Promise<void> {
  const store = await cookies()
  store.delete('stdb_token')
  store.delete('stdb_identity')
}
