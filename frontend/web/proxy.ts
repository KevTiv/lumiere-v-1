import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Auth pages that don't require a session
const AUTH_PATHS = [
  '/sign-in',
  '/forgot-password',
  '/reset-password',
  '/accept-invite',
  '/auth/callback',
]

/**
 * Extracts Bearer token from Authorization header.
 * Supports: Authorization: Bearer <token>
 * Returns the token or undefined if not found/invalid.
 */
function extractBearerToken(request: NextRequest): string | undefined {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim()
  }
  return undefined
}

/**
 * Checks if request is authenticated via either:
 * - HTTP-only cookie (web browsers)
 * - Authorization: Bearer header (Expo/mobile)
 */
function isAuthenticated(request: NextRequest): boolean {
  const cookieToken = request.cookies.get('stdb_token')?.value
  if (cookieToken) return true

  const bearerToken = extractBearerToken(request)
  if (bearerToken) return true

  return false
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow all API routes - authentication is handled in route handlers
  // This supports both cookies (web) and Bearer tokens (Expo/mobile)
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/public/') ||
    pathname === '/robots.txt' ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const isLoggedIn = isAuthenticated(request)
  const isAuthPage = AUTH_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))

  // Cheap crawler guard, not an authorization boundary: API/session handlers
  // still verify tokens. Do not render private ERP pages for anonymous traffic.
  if (process.env.NODE_ENV === 'production' && !isLoggedIn && !isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    url.search = ''
    if (pathname !== '/') url.searchParams.set('callbackUrl', pathname)
    const response = NextResponse.redirect(url)
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    return response
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-lumiere-pathname', pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
