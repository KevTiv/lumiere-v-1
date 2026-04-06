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
 * Persists SpacetimeDB credentials in HTTP-only cookies for server-side and `/api/*` use.
 *
 * Called from auth routes (sign-in, sign-up, invite accept, password reset) and the
 * WorkOS ↔ STDB bridge — not from a browser WebSocket client.
 *
 * Sets two cookies:
 *   stdb_token    — bearer token for SpacetimeDB HTTP SQL / reducer calls
 *   stdb_identity — identity hex (per-user scoping and Casbin field policy)
 *
 * `organization_id` is resolved server-side from `user_organization` using the identity;
 * it is not stored in these cookies.
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
