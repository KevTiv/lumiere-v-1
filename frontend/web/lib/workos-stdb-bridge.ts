/**
 * Maps a WorkOS AuthKit user to SpacetimeDB credentials and HTTP-only STDB cookies.
 * Called from AuthKit callback `onSuccess` after WorkOS session is saved.
 */
import 'server-only'

import { saveStdbSession } from '@/app/actions/save-stdb-token'
import { workOsEmailVerified, workOsPrimaryEmail, type WorkOsAuthKitUser } from '@/lib/workos-user-fields'
import { resolveApiServerBaseUrl } from '@/lib/api-server-forward'

/**
 * Provisions or loads STDB identity and sets `stdb_token` / `stdb_identity` cookies.
 */
export async function bridgeWorkOsUserToStdbSession(user: WorkOsAuthKitUser): Promise<void> {
  const email = workOsPrimaryEmail(user)
  const workosUserId = user.id?.trim()
  if (!email || !workosUserId) {
    throw new Error('WorkOS user is missing email or id')
  }

  const base = resolveApiServerBaseUrl()
  const serviceToken = process.env.STDB_SERVER_TOKEN?.trim()
  if (!base || !serviceToken) {
    throw new Error('WorkOS bridge requires LUMIERE_API_SERVER_URL and STDB_SERVER_TOKEN')
  }
  const response = await fetch(`${base}/v1/auth/workos/bridge`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      workosUserId,
      emailVerified: workOsEmailVerified(user),
    }),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`WorkOS platform bridge failed (${response.status})`)
  }
  const session = (await response.json()) as { token?: string; identity?: string }
  if (!session.token || !session.identity) {
    throw new Error('WorkOS platform bridge returned an incomplete STDB session')
  }
  await saveStdbSession(session.token, session.identity)
}
