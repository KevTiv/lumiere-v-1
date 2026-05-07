/**
 * SpacetimeDB host + module resolution for Next.js (server and any non-`server-only` callers).
 * Keeps defaults aligned with `crates/stdb-config` / Makefile / seed scripts.
 */

/** Dev fallback when `STDB_MODULE` / `NEXT_PUBLIC_STDB_MODULE` are unset (local + Makefile). */
export const DEFAULT_STDB_MODULE_DEV = 'lumiere-v1-j1uo0'

/** Normalize wss/ws Spacetime URLs to https/http for HTTP SQL / reducer APIs. */
export function normalizeStdbHttpHost(raw: string): string {
  return raw
    .trim()
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/$/, '')
}

function readHostEnv(): string {
  return (
    process.env['STDB_HOST'] ??
    process.env['NEXT_PUBLIC_STDB_HOST'] ??
    'wss://maincloud.spacetimedb.com'
  )
}

function readModuleEnv(): string | undefined {
  const m = process.env['STDB_MODULE'] ?? process.env['NEXT_PUBLIC_STDB_MODULE']
  const t = typeof m === 'string' ? m.trim() : ''
  return t.length > 0 ? t : undefined
}

export function resolveStdbConnectFromEnv(): { host: string; module: string } {
  const host = normalizeStdbHttpHost(readHostEnv())
  const module = readModuleEnv() ?? DEFAULT_STDB_MODULE_DEV
  return { host, module }
}
