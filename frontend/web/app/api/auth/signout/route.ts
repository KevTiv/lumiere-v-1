import { type NextRequest, NextResponse } from 'next/server'
import { signOut } from '@workos-inc/authkit-nextjs'
import { clearStdbSession } from '@/app/actions/save-stdb-token'
import { forwardToApiServerIfEnabled } from '@/lib/api-server-forward'

/** Api-server clears STDB cookies; local fallback keeps WorkOS AuthKit sign-out when not proxied. */
export async function POST(req: NextRequest) {
  const forwarded = await forwardToApiServerIfEnabled(req)
  if (forwarded) return forwarded

  await clearStdbSession()
  if (!process.env.WORKOS_CLIENT_ID) {
    return NextResponse.json({ redirectTo: '/sign-in' })
  }
  await signOut({ returnTo: '/sign-in' })
}
