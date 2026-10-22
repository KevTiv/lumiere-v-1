import { workOsRedirectUri } from '@/lib/workos-config'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { isWorkOsEnabled } from '@/lib/auth-mode'

/** Mint only a short-lived, HTTP-only handshake credential scoped to the Rust websocket. */
export async function POST(request: NextRequest) {
  if (!isWorkOsEnabled()) return new NextResponse(null, { status: 404 })
  const expectedOrigin = new URL(workOsRedirectUri()).origin
  if (request.headers.get('origin') !== expectedOrigin) return new NextResponse(null, { status: 403 })
  const session = await withAuth()
  if (!session.accessToken) return new NextResponse(null, { status: 401 })
  const response = NextResponse.json({ ready: true }, { headers: { 'Cache-Control': 'private, no-store' } })
  response.cookies.set('stdb_token', session.accessToken, {
    path: '/v1/realtime', maxAge: 60, httpOnly: true, sameSite: 'strict',
    secure: new URL(workOsRedirectUri()).protocol === 'https:',
  })
  return response
}
