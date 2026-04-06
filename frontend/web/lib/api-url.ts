/**
 * Optional direct browser → Rust `api-server` (skips Next.js route handlers).
 *
 * When `NEXT_PUBLIC_API_GATEWAY_URL` is set (e.g. `http://localhost:8082`), relative
 * requests under the prefixes below go to `{base}/v1/...` from the browser.
 *
 * **Preferred layout:** leave this unset so the browser calls same-origin `/api/*`;
 * Next.js route handlers forward to Axum using `LUMIERE_API_SERVER_URL` (see
 * `lib/api-server-forward.ts`) — one gateway, cookies stay on the Next origin.
 *
 * Paths **not** listed here (e.g. `/api/auth/*`, `/api/stdb/*`, `/api/health`) always
 * stay on the Next.js origin.
 */

const GATEWAY_PREFIXES = [
  '/api/query/',
  '/api/call/',
  '/api/crm/',
  '/api/sales/',
  '/api/accounting/',
  '/api/inventory/',
  '/api/settings/',
  '/api/bootstrap/',
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
