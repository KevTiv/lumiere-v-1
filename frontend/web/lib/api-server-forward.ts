/**
 * Forward `/api/*` route-handler requests to the Rust `api-server`, which talks to SpacetimeDB.
 *
 * - Server-only env: `LUMIERE_API_SERVER_URL` (e.g. `http://127.0.0.1:8082`). Empty / `false` / `off` disables forwarding.
 * - In development, defaults to `http://127.0.0.1:8082` when unset so local Axum + Next work together.
 * - Production (`NODE_ENV=production`): unset does **not** fall back to localhost — return null so callers must set
 *   `LUMIERE_API_SERVER_URL` to your internal api-server base URL (no trailing slash).
 * - Debug: `LUMIERE_DEBUG_API_FORWARD=1` logs each proxied method + upstream URL on the Next.js server.
 *
 * Path map: same-origin `/api/...` → `{base}/v1/...` (e.g. `/api/auth/signin`, `/api/stdb/v1/identity`, `/api/query/foo`).
 *
 * Use {@link forwardToApiServerRequired} for BFF routes implemented only on the Rust gateway
 * (returns 503 when forwarding is off). {@link forwardToApiServerIfEnabled} remains for
 * `signout`, which may fall back to WorkOS AuthKit + `clearStdbSession` when not proxied.
 */

import { type NextRequest, NextResponse } from "next/server"

const PASSTHROUGH_HEADERS = [
  "cookie",
  "authorization",
  "x-stdb-identity",
  "content-type",
  "accept",
  "accept-language",
] as const

export function resolveApiServerBaseUrl(): string | null {
  const raw = process.env.LUMIERE_API_SERVER_URL
  if (raw === "" || raw === "false" || raw === "off") return null
  if (raw?.trim()) return raw.trim().replace(/\/$/, "")
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:8082"
  return null
}

/**
 * If an API server base URL is configured, proxy the incoming request and return the response.
 * Otherwise return `null` so the route handler runs its legacy implementation.
 */
export async function forwardToApiServerIfEnabled(request: NextRequest): Promise<NextResponse | null> {
  const base = resolveApiServerBaseUrl()
  if (!base) return null

  const src = new URL(request.url)
  const path = src.pathname.replace(/^\/api/, "/v1")
  const target = `${base}${path}${src.search}`

  if (process.env.LUMIERE_DEBUG_API_FORWARD === "1") {
    console.info("[lumiere:api-forward]", request.method, target)
  }

  const headers = new Headers()
  for (const name of PASSTHROUGH_HEADERS) {
    const v = request.headers.get(name)
    if (v) headers.set(name, v)
  }

  const init: RequestInit = {
    method: request.method,
    headers,
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body
    Object.assign(init, { duplex: "half" as const })
  }

  let res: Response
  try {
    res = await fetch(target, init)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: "API server unreachable", detail: message },
      { status: 502 },
    )
  }

  const out = new Headers(res.headers)
  out.delete("transfer-encoding")
  out.delete("connection")

  return new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: out,
  })
}

const FORWARD_REQUIRED_MSG =
  "This endpoint is implemented by the Rust api-server. Set LUMIERE_API_SERVER_URL to its base URL (development defaults to http://127.0.0.1:8082 when unset)."

/**
 * Always proxy to api-server, or return 503 if forwarding is disabled (no legacy body in the route).
 */
export async function forwardToApiServerRequired(request: NextRequest): Promise<NextResponse> {
  const r = await forwardToApiServerIfEnabled(request)
  if (r) return r
  return NextResponse.json({ error: FORWARD_REQUIRED_MSG }, { status: 503 })
}
