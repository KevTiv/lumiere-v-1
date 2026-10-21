/** Name of the one-use PKCE verifier cookie AuthKit sets when it builds a sign-in URL. */
export const WORKOS_PKCE_COOKIE_NAME = 'wos-auth-verifier'

/**
 * `authkit()` in the proxy mints a fresh PKCE cookie on every unauthenticated request.
 * This app starts sign-in from its own action, which sets the cookie that matches the
 * `state` it redirects with; any later proxy response (a prefetch, an asset request) would
 * overwrite it and make the callback fail with an OAuth state mismatch. Drop the proxy's
 * copy and leave every other Set-Cookie header untouched.
 */
export function withoutPkceCookie(source: Headers): Headers {
  const headers = new Headers(source)
  const cookies = source.getSetCookie()
  headers.delete('Set-Cookie')
  for (const cookie of cookies) {
    if (!cookie.startsWith(`${WORKOS_PKCE_COOKIE_NAME}=`)) headers.append('Set-Cookie', cookie)
  }
  return headers
}
