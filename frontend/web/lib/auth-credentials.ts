import 'server-only'

import { cookies } from 'next/headers'
import { isWorkOsEnabled } from './auth-mode'

/** AuthKit owns browser session verification and refresh; Rust verifies API authority. */
export async function workOsBrowserSession() {
  const { withAuth } = await import('@workos-inc/authkit-nextjs')
  return withAuth()
}

export type RequestCredentials = {
  /** Preserve explicit credentials verbatim so the API can reject malformed values. */
  authorization: string | null
  token: string | undefined
  presented: boolean
}

/** One credential precedence rule for BFF requests and server-rendered sessions. */
export async function resolveRequestCredentials(request?: Pick<Request, 'headers'>): Promise<RequestCredentials> {
  const authorization = request?.headers.get('authorization') ?? null
  if (authorization !== null) {
    return {
      authorization,
      token: authorization.startsWith('Bearer ') ? authorization.slice(7).trim() || undefined : undefined,
      presented: true,
    }
  }

  if (isWorkOsEnabled()) {
    const session = await workOsBrowserSession()
    const token = session.accessToken || undefined
    // Even a signed-out hosted caller must never inherit native cookies or dev credentials.
    return { authorization: token ? `Bearer ${token}` : null, token, presented: true }
  }

  const cookie = (await cookies()).get('stdb_token')
  const token = cookie?.value.trim() || undefined
  return { authorization: token ? `Bearer ${token}` : null, token, presented: cookie !== undefined }
}
