/**
 * Resolve the Rust `ai-gateway` base URL for Next.js server routes.
 * Configure `LUMIERE_AI_GATEWAY_URL` or `AI_GATEWAY_URL` (e.g. `http://127.0.0.1:8080`).
 */
import 'server-only'

/** Returns null when unset or disabled — callers return 503. */
export function resolveAiGatewayBaseUrl(): string | null {
  const raw = process.env['LUMIERE_AI_GATEWAY_URL'] ?? process.env['AI_GATEWAY_URL']
  if (raw === undefined || raw === null || raw === '' || raw === 'false' || raw === 'off') {
    return null
  }
  return raw.trim().replace(/\/$/, '')
}

export async function fetchAiGateway(path: string, init: RequestInit & { body?: string }): Promise<{
  ok: boolean
  status: number
  text: string
}> {
  const base = resolveAiGatewayBaseUrl()
  if (!base) {
    throw new Error('AI gateway URL not configured')
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const secret = process.env['LUMIERE_AI_GATEWAY_INTERNAL_SECRET']
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (
    ['POST', 'PUT', 'PATCH'].includes(method) &&
    init.body !== undefined &&
    init.body !== null &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json')
  }
  if (secret) {
    headers.set('X-Lumiere-Gateway-Secret', secret)
  }
  const res = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}
