import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Auth pages that don't require a session
const AUTH_PATHS = ['/sign-in', '/sign-up', '/forgot-password', '/reset-password', '/accept-invite']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const stdbToken = request.cookies.get('stdb_token')?.value
  const isLoggedIn = Boolean(stdbToken)

  // Let API routes, static assets, and Next.js internals through
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/public/')
  ) {
    return NextResponse.next()
  }

  const isAuthPage = AUTH_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))

  if (!isLoggedIn && !isAuthPage) {
    // No session → redirect to sign-in, preserve intended destination
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    if (pathname !== '/') {
      url.searchParams.set('callbackUrl', pathname)
    }
    return NextResponse.redirect(url)
  }

  if (isLoggedIn && isAuthPage && pathname !== '/onboarding') {
    // Already logged in → redirect away from auth pages
    return NextResponse.redirect(new URL('/overview', request.url))
  }

  return NextResponse.next()
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
