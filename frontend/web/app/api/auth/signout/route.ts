import { workOsRedirectUri } from '@/lib/workos-config'
import { type NextRequest, NextResponse } from 'next/server'
import { signOut } from '@workos-inc/authkit-nextjs'
import { isWorkOsEnabled } from '@/lib/auth-mode'
import { clearStdbSession } from '@/lib/auth-cookies'
import { forwardToApiServerIfEnabled } from '@/lib/api-server-forward'

export async function POST(req: NextRequest) {
  if (isWorkOsEnabled()) {
    const origin = req.headers.get('origin')
    if (origin && origin !== new URL(workOsRedirectUri()).origin) {
      return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
    }
    // Keep the sealed session until the top-level handoff can end its provider session.
    return NextResponse.json({ redirectTo: '/api/auth/signout' }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const forwarded = await forwardToApiServerIfEnabled(req)
  if (forwarded) return forwarded
  await clearStdbSession()
  return NextResponse.json({ redirectTo: '/sign-in' })
}

/** Top-level logout handoff: needed because fetch hides cross-origin provider redirects. */
export async function GET(req: NextRequest) {
  const site = req.headers.get('sec-fetch-site')
  if (site && !['same-origin', 'none'].includes(site)) return new NextResponse(null, { status: 403 })
  if (!isWorkOsEnabled()) return NextResponse.redirect(new URL('/sign-in', req.url))
  await clearStdbSession()
  await signOut({ returnTo: new URL('/sign-in', workOsRedirectUri()).toString() })
}
