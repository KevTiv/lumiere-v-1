import { workOsRedirectUri } from './lib/workos-config'
import { authkit, handleAuthkitHeaders } from '@workos-inc/authkit-nextjs'
import { isWorkOsEnabled } from './lib/auth-mode'
import { withoutPkceCookie } from './lib/workos-pkce-cookie'
import { NextResponse, NextRequest } from 'next/server'
import { requiresPrivatePageLogin } from './lib/private-release-policy'

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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isWorkOsEnabled()) {
    // Preserve the custom pathname marker while AuthKit strips forged internal headers,
    // verifies/refreshes the sealed browser session, and propagates its response cookies.
    const headers = new Headers(request.headers)
    headers.set('x-lumiere-pathname', pathname)
    const forwarded = new NextRequest(request, { headers })
    const result = await authkit(forwarded, { redirectUri: workOsRedirectUri() })
    const privatePage = requiresPrivatePageLogin(pathname, process.env.NODE_ENV === 'production', Boolean(result.session.user))
    const response = handleAuthkitHeaders(forwarded, withoutPkceCookie(result.headers), privatePage ? {
      redirect: new URL(`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`, workOsRedirectUri()),
    } : {})
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    return response
  }

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

  // Cheap crawler guard, not an authorization boundary: API/session handlers
  // still verify tokens. Do not render private ERP pages for anonymous traffic.
  if (requiresPrivatePageLogin(pathname, process.env.NODE_ENV === 'production', isLoggedIn)) {
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
