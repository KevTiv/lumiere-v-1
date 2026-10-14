/** Cheap routing policy only. Session/API handlers remain the auth boundary. */
export function requiresPrivatePageLogin(pathname: string, production: boolean, hasToken: boolean) {
  if (!production || hasToken) return false
  const publicAuthPaths = ['/sign-in', '/forgot-password', '/reset-password', '/accept-invite', '/auth/callback']
  if (publicAuthPaths.some(path => pathname === path || pathname.startsWith(path + '/'))) return false
  return !(
    pathname.startsWith('/api/') || pathname.startsWith('/_next/') ||
    pathname.startsWith('/public/') || pathname === '/favicon.ico' || pathname === '/robots.txt'
  )
}
