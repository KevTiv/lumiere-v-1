/**
 * SpacetimeDB HTTP SQL client — runs in both Node.js (SSR) and browser.
 *
 * Used in TanStack Start route loaders to prefetch data server-side,
 * seeding the React Query cache so pages render with data instead of spinners.
 *
 * SpacetimeDB HTTP SQL endpoint: POST /v1/database/:name/sql
 * Response: Array of result sets, each with SATS-JSON schema + rows.
 */

// ── SATS-JSON types ─────────────────────────────────────────────────────────

type SatsName = { some: string } | { none: [] }

type SatsElement = {
  name: SatsName
  algebraic_type: unknown
}

type SqlResultSet = {
  schema: { elements: SatsElement[] }
  rows: unknown[][]
}

// ── Row parsing ──────────────────────────────────────────────────────────────

function elementName(el: SatsElement): string {
  return 'some' in el.name ? el.name.some : ''
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * Unwrap SATS Option/Sum values:
 *   { some: v }  → v (recursively unwrapped)
 *   { none: [] } → undefined
 *   anything else → returned as-is
 */
function unwrapSats(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>
    if ('some' in obj) return unwrapSats(obj['some'])
    if ('none' in obj) return undefined
  }
  return v
}

function parseRow(
  elements: SatsElement[],
  row: unknown[],
): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (let i = 0; i < elements.length; i++) {
    const snake = elementName(elements[i])
    if (!snake) continue
    obj[snakeToCamel(snake)] = unwrapSats(row[i])
  }
  return obj
}

// ── Config resolution ────────────────────────────────────────────────────────

function resolveHost(override?: string): string {
  const raw =
    override ??
    (typeof process !== 'undefined' ? process.env['VITE_STDB_HOST'] : undefined) ??
    'https://maincloud.spacetimedb.com'
  return raw.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
}

function resolveModule(override?: string): string {
  return (
    override ??
    (typeof process !== 'undefined' ? process.env['VITE_STDB_MODULE'] : undefined) ??
    'lumiere-v1'
  )
}

function resolveToken(override?: string): string | undefined {
  return (
    override ??
    (typeof process !== 'undefined' ? process.env['STDB_SERVER_TOKEN'] : undefined)
  )
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface StdbHttpOptions {
  /** Override SpacetimeDB host (default: VITE_STDB_HOST env or maincloud) */
  host?: string
  /** Override module/database name (default: VITE_STDB_MODULE env) */
  module?: string
  /**
   * Bearer token for authenticated access.
   * Server-side: defaults to STDB_SERVER_TOKEN env var.
   * Never expose STDB_SERVER_TOKEN to the browser.
   */
  token?: string
}

/**
 * Execute a SQL query against SpacetimeDB's HTTP API.
 *
 * Returns rows as plain objects with camelCase keys.
 * SATS Option fields (`{ some: v }` / `{ none: [] }`) are automatically
 * unwrapped to `v` / `undefined`. All numeric types come as JSON numbers
 * (not bigints) — suitable for display and JSON serialization.
 */
export async function stdbSql<T = Record<string, unknown>>(
  sql: string,
  opts?: StdbHttpOptions,
): Promise<T[]> {
  const host = resolveHost(opts?.host)
  const mod = resolveModule(opts?.module)
  const token = resolveToken(opts?.token)

  const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${host}/v1/database/${mod}/sql`, {
    method: 'POST',
    headers,
    body: sql,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`SpacetimeDB HTTP ${res.status}: ${body}`)
  }

  const results: SqlResultSet[] = await res.json()
  const first = results[0]
  if (!first) return []

  return first.rows.map(row => parseRow(first.schema.elements, row) as T)
}
