/** The API validates the provider token and admits the canonical identity. No DB credentials leave it. */
import 'server-only'
import { resolveApiServerBaseUrl } from '@/lib/api-server-forward'

export async function bridgeWorkOsUserToStdbSession(accessToken: string): Promise<void> {
  const base = resolveApiServerBaseUrl()
  if (!base || !accessToken) throw new Error('WorkOS admission is unavailable')
  const response = await fetch(`${base}/v1/auth/workos/bridge`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: '{}',
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`WorkOS admission rejected (${response.status})`)
}
