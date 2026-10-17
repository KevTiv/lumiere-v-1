import { forwardToApiServerRequired } from '@/lib/api-server-forward'
import { isWorkOsEnabled } from '@/lib/auth-mode'
import {
  hostedInviteCookieName,
  hostedInviteCookieOptions,
  openHostedInvite,
} from '@/lib/hosted-invite-token'
import { type NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  if (!isWorkOsEnabled()) return forwardToApiServerRequired(request)
  // An explicit caller bearer must never override the sealed WorkOS browser session.
  if (request.headers.has('authorization')) {
    return NextResponse.json({ error: 'Use your hosted session' }, { status: 403 })
  }
  const name = hostedInviteCookieName()
  const token = openHostedInvite(request.cookies.get(name)?.value)
  if (!token) return NextResponse.json({ error: 'Invitation missing or expired' }, { status: 400 })

  // BFF refreshes AuthKit credentials and enforces same-origin request policy.
  const upstream = new NextRequest(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ token }),
  })
  const response = await forwardToApiServerRequired(upstream)
  // Keep a retryable handoff only for transient upstream errors.
  if (response.ok || [400, 403, 409, 410].includes(response.status)) {
    response.cookies.set(name, '', { ...hostedInviteCookieOptions(), maxAge: 0 })
  }
  return response
}
