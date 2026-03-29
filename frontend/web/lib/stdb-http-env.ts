/**
 * SpacetimeDB HTTP host + database name for Next.js server code.
 *
 * Must stay aligned with:
 * - `stdb-auth-server` credential SQL (same DB as org membership)
 * - `frontend/web/server.js` WebSocket proxy (`STDB_MODULE` / `STDB_HOST`)
 * - `@lumiere/stdb` `http.ts` (which defaults module to `lumiere-v1` if unset — avoid relying on that alone)
 */
import 'server-only'

export function getDefaultStdbHttpConnect(): { host: string; module: string } {
  const rawHost =
    process.env['STDB_HOST'] ??
    process.env['NEXT_PUBLIC_STDB_HOST'] ??
    'wss://maincloud.spacetimedb.com'
  const host = rawHost
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/$/, '')

  const module =
    process.env['STDB_MODULE'] ??
    process.env['NEXT_PUBLIC_STDB_MODULE'] ??
    'lumiere-v1-j1uo0'

  return { host, module }
}

/** Normalize identity for SQL `user_identity = '…'` / credential columns (64 hex, lowercase). */
export function normalizeIdentityHexForSql(identity: string): string {
  const s = String(identity).trim().replace(/^0x/i, '')
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase()
  return s
}
