/**
 * SpacetimeDB HTTP host + database name for Next.js server code.
 *
 * Must stay aligned with:
 * - `stdb-config` (Rust api-server / gateways)
 * - `@lumiere/stdb` `http.ts` (browser + SSR SQL)
 * - `lib/stdb-connect-env.ts` (shared resolution)
 */
import 'server-only'

import { resolveStdbConnectFromEnv } from '@/lib/stdb-connect-env'

export function getDefaultStdbHttpConnect(): { host: string; module: string } {
  return resolveStdbConnectFromEnv()
}

/** Normalize identity for SQL `user_identity = '…'` / credential columns (64 hex, lowercase). */
export function normalizeIdentityHexForSql(identity: string): string {
  const s = String(identity).trim().replace(/^0x/i, '')
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase()
  return s
}
