import 'server-only'

import { cookies } from 'next/headers'

/** Retire native cookies during hosted login/logout, including the realtime handshake. */
export async function clearStdbSession(): Promise<void> {
  const store = await cookies()
  store.delete('stdb_token')
  store.delete('stdb_identity')
  store.set('stdb_token', '', {
    path: '/v1/realtime', maxAge: 0, httpOnly: true, sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_FORCE_SECURE === 'true',
  })
}
