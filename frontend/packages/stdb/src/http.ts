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

function satsUnitEnumTag(key: string): string {
  if (!key) return ''
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function variantNameFromElement(el: Record<string, unknown>): string | undefined {
  const name = el['name'] as SatsName | undefined
  if (name && 'some' in name) return name.some
  return undefined
}

function isOptionSum(sum: { variants?: unknown[] }): boolean {
  const variants = sum.variants
  if (!Array.isArray(variants)) return false
  let hasSome = false
  let hasNone = false
  for (const v of variants) {
    const n = variantNameFromElement(v as Record<string, unknown>)
    if (n === 'some') hasSome = true
    if (n === 'none') hasNone = true
  }
  return hasSome && hasNone
}

function isTimestampProduct(atype: Record<string, unknown>): boolean {
  const product = atype['Product'] as { elements?: SatsElement[] } | undefined
  const elements = product?.elements
  return (
    Array.isArray(elements) &&
    elements.length === 1 &&
    elementName(elements[0]!) === '__timestamp_micros_since_unix_epoch__'
  )
}

function isEmptyPayload(v: unknown): boolean {
  if (v == null) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

function isUnitProduct(atype: Record<string, unknown>): boolean {
  const product = atype['Product'] as { elements?: unknown[] } | undefined
  return Array.isArray(product?.elements) && product!.elements!.length === 0
}

function unwrapSatsObject(v: unknown): unknown | undefined {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return undefined
  const obj = v as Record<string, unknown>
  if ('some' in obj) return unwrapSatsTyped(obj['some'], undefined)
  if ('none' in obj) return undefined
  const keys = Object.keys(obj)
  if (keys.length === 1) {
    const val = obj[keys[0]!]
    if (Array.isArray(val) && val.length === 0) {
      return satsUnitEnumTag(keys[0]!)
    }
    if (
      val != null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      Object.keys(val as object).length === 0
    ) {
      return satsUnitEnumTag(keys[0]!)
    }
  }
  return undefined
}

/**
 * Unwrap SATS Option/Sum values using schema when available:
 *   { some: v } / [0, v]  → v (recursively unwrapped)
 *   { none: [] } / [1, []] → undefined (Option) or unit enum tag (Sum)
 *   { outInvoice: [] } / [1, []] with enum schema → "OutInvoice"
 */
function unwrapSatsTyped(v: unknown, algebraicType: unknown): unknown {
  const objectUnwrapped = unwrapSatsObject(v)
  if (objectUnwrapped !== undefined) return objectUnwrapped

  if (algebraicType != null && typeof algebraicType === 'object' && !Array.isArray(algebraicType)) {
    const atype = algebraicType as Record<string, unknown>
    const sum = atype['Sum'] as { variants?: Record<string, unknown>[] } | undefined
    if (sum && Array.isArray(v) && v.length >= 2) {
      const tag = v[0]
      const payload = v[1]
      if (typeof tag === 'number') {
        if (isOptionSum(sum)) {
          if (tag === 0) {
            const inner = sum.variants?.[0]?.['algebraic_type']
            return unwrapSatsTyped(payload, inner)
          }
          if (tag === 1) return undefined
        } else if (Array.isArray(sum.variants)) {
          const variant = sum.variants[tag]
          if (variant) {
            const name = variantNameFromElement(variant) ?? ''
            const innerType = variant['algebraic_type'] as Record<string, unknown> | undefined
            if (innerType && isUnitProduct(innerType) && isEmptyPayload(payload)) {
              return satsUnitEnumTag(name)
            }
            if (innerType) return unwrapSatsTyped(payload, innerType)
          }
        }
      }
    }

    if (isTimestampProduct(atype) && Array.isArray(v) && typeof v[0] === 'number') {
      return { microsSinceUnixEpoch: v[0] }
    }
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
    obj[snakeToCamel(snake)] = unwrapSatsTyped(row[i], elements[i]!.algebraic_type)
  }
  return obj
}

// ── Config resolution ────────────────────────────────────────────────────────

function resolveHost(override?: string): string {
  const raw =
    override ??
    (typeof process !== 'undefined'
      ? process.env['STDB_HOST'] ?? process.env['NEXT_PUBLIC_STDB_HOST'] ?? process.env['VITE_STDB_HOST']
      : undefined) ??
    'https://maincloud.spacetimedb.com'
  return raw.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
}

/** Default published DB name when env is unset (align with Makefile / web `DEFAULT_STDB_MODULE_DEV`). */
const DEFAULT_STDB_MODULE = 'lumiere-v1-j1uo0'

function resolveModule(override?: string): string {
  return (
    override ??
    (typeof process !== 'undefined'
      ? process.env['STDB_MODULE'] ?? process.env['NEXT_PUBLIC_STDB_MODULE'] ?? process.env['VITE_STDB_MODULE']
      : undefined) ??
    DEFAULT_STDB_MODULE
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
