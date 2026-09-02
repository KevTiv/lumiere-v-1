/**
 * Browser API URL resolver.
 *
 * Default production/local layout is same-origin `/api/*` through Kong. Keep
 * `NEXT_PUBLIC_API_GATEWAY_URL` unset for that path.
 *
 * Optional escape hatch: set `NEXT_PUBLIC_API_GATEWAY_URL` to a direct Rust
 * `api-server` base URL (e.g. `http://localhost:8082`) to rewrite selected
 * `/api/*` paths to `{base}/v1/*`.
 *
 * Paths not listed here stay same-origin because they still belong to Next.js
 * BFF handlers (for example `/api/ai/*`, `/api/auth/signup`, `/api/auth/signout`).
 */

const GATEWAY_PREFIXES = [
  '/api/query/',
  '/api/operations/',
  '/api/compat/reducer/',
  '/api/auth/signin',
  '/api/auth/invite',
  '/api/auth/accept-invite',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/crm/',
  '/api/sales/',
  '/api/accounting/',
  '/api/inventory/',
  '/api/settings/',
  '/api/proposals/',
] as const

export function getApiGatewayBaseUrl(): string {
  if (typeof process === 'undefined') return ''
  const raw = process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim() ?? ''
  return raw.replace(/\/$/, '')
}

export function apiUrl(path: string): string {
  const base = getApiGatewayBaseUrl()
  if (!base || !path.startsWith('/api/')) {
    return path
  }
  const allowed = GATEWAY_PREFIXES.some((p) => path.startsWith(p))
  if (!allowed) {
    return path
  }
  return `${base}/v1${path.slice(4)}`
}
