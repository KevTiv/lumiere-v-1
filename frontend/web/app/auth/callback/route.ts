import { workOsRedirectUri } from '@/lib/workos-config'
import { handleAuth } from '@workos-inc/authkit-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { isWorkOsEnabled } from '@/lib/auth-mode'
import { clearStdbSession } from '@/app/actions/save-stdb-token'
import { bridgeWorkOsUserToStdbSession } from '@/lib/workos-stdb-bridge'

const callback = handleAuth({
  returnPathname: '/auth/complete',
  baseURL: isWorkOsEnabled() ? workOsRedirectUri() : undefined,
  onSuccess: async ({ accessToken, state }) => {
    // Complete and verify admission before allowing any ERP session access.
    if (state) throw new Error('Legacy invitation completion requires administrator approval')
    await bridgeWorkOsUserToStdbSession(accessToken)
    await clearStdbSession()
  },
  onError: async ({ request }) => {
    // AuthKit saves its sealed cookie before onSuccess. Remove it on every admission failure.
    const store = await cookies()
    store.set(process.env.WORKOS_COOKIE_NAME || 'wos-session', '', {
      path: '/', maxAge: 0, httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', ...(process.env.WORKOS_COOKIE_DOMAIN ? { domain: process.env.WORKOS_COOKIE_DOMAIN } : {}),
    })
    await clearStdbSession()
    return NextResponse.redirect(new URL('/sign-in?error=admission_denied', workOsRedirectUri()))
  },
})

export async function GET(request: NextRequest) {
  if (!isWorkOsEnabled()) return new NextResponse(null, { status: 404 })
  const canonicalUrl = new URL(workOsRedirectUri())
  canonicalUrl.search = request.nextUrl.search
  return callback(new NextRequest(canonicalUrl, { headers: request.headers }))
}
