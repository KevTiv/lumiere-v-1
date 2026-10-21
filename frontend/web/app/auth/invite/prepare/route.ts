import { isWorkOsEnabled } from '@/lib/auth-mode'
import {
  hostedInviteCookieName,
  hostedInviteCookieOptions,
  INVITE_COOKIE_MAX_AGE,
  sealHostedInvite,
  validInviteToken,
} from '@/lib/hosted-invite-token'
import { type NextRequest, NextResponse } from 'next/server'

/** Consume email link into a same-origin HTTP-only, encrypted, short-lived handoff. */
export function GET(request: NextRequest) {
  if (!isWorkOsEnabled()) return new NextResponse(null, { status: 404 })
  const token = request.nextUrl.searchParams.get('token')
  const response = NextResponse.redirect(new URL('/accept-invite', request.url), 303)
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  const name = hostedInviteCookieName()
  if (validInviteToken(token)) {
    response.cookies.set(name, sealHostedInvite(token), {
      ...hostedInviteCookieOptions(),
      maxAge: INVITE_COOKIE_MAX_AGE,
    })
  } else {
    response.cookies.set(name, '', { ...hostedInviteCookieOptions(), maxAge: 0 })
  }
  return response
}
