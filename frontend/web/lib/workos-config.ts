import 'server-only'

/** Runtime server configuration takes precedence over the SDK's build-time public fallback. */
export function workOsRedirectUri(): string {
  const raw = process.env.WORKOS_REDIRECT_URI || process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
  if (!raw || !/^https?:\/\/[^/]/.test(raw) || /[\\\x00-\x20\x7f]/.test(raw)) throw new Error('Configure a valid WORKOS_REDIRECT_URI')
  const url = new URL(raw)
  const production = process.env.NODE_ENV === 'production' || process.env.LUMIERE_ENV === 'production'
  if (!['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:') ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/auth/callback') {
    throw new Error('WORKOS_REDIRECT_URI must be an absolute callback URL without credentials, query or fragment; production requires HTTPS')
  }
  return url.toString()
}
