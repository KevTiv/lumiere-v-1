import 'server-only'

import { cookies } from 'next/headers'
import { getStdbSession, runtimeIsProduction, type ApiSession } from '@/lib/api-session'

function allowDevMockSession() {
  return (
    !runtimeIsProduction() &&
    Boolean(process.env.DEV_MOCK_ORG_ID && process.env.STDB_SERVER_TOKEN)
  )
}

export async function hasStdbSessionCookie() {
  const store = await cookies()
  return Boolean(store.get('stdb_token')?.value)
}

export function hasAuthenticatedIdentity(session: ApiSession | null | undefined) {
  return Boolean(session?.identityHex && session.identityHex !== 'unknown')
}

/**
 * Resolve only real browser sessions. `getStdbSession()` can fall back to the
 * server admin token for backend work; public pages must not treat that as login.
 */
export async function getBrowserStdbSession() {
  if (!(await hasStdbSessionCookie()) && !allowDevMockSession()) {
    return null
  }
  return getStdbSession()
}
