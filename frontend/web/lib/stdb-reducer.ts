/**
 * HTTP Reducer Bridge — Phase 2 of API Gateway Refactor
 *
 * Replaces direct WebSocket reducer calls with HTTP POST requests.
 * Used by Next.js route handlers to call SpacetimeDB reducers server-side.
 *
 * SpacetimeDB reducer endpoint:
 *   POST /v1/database/{module}/call/{reducer_name}
 *   Authorization: Bearer {token}
 *   Content-Type: application/json
 *   Body: JSON array of arguments
 */

import type { StdbHttpOptions } from '@lumiere/stdb/server'

// Module-level cache for config resolution
let cachedHost: string | undefined
let cachedModule: string | undefined

function resolveHost(override?: string): string {
  if (override) {
    return override.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
  }
  if (!cachedHost) {
    const raw =
      process.env['STDB_HOST'] ??
      process.env['NEXT_PUBLIC_STDB_HOST'] ??
      'https://maincloud.spacetimedb.com'
    cachedHost = raw.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
  }
  return cachedHost
}

function resolveModule(override?: string): string {
  if (override) return override
  if (!cachedModule) {
    cachedModule =
      process.env['STDB_MODULE'] ??
      process.env['NEXT_PUBLIC_STDB_MODULE'] ??
      'lumiere-v1-j1uo0'
  }
  return cachedModule
}

function resolveToken(opts?: StdbHttpOptions): string | undefined {
  return opts?.token ?? process.env['STDB_SERVER_TOKEN']
}

/**
 * Call a SpacetimeDB reducer via HTTP POST.
 *
 * Endpoint: POST /v1/database/{module}/call/{reducerName}
 *
 * @param reducerName - Name of the reducer to call (e.g., 'create_lead', 'update_account')
 * @param args - Array of arguments to pass to the reducer (must be JSON serializable)
 * @param opts - StdbHttpOptions for authentication and host/module overrides
 * @throws Error if the HTTP request fails (non-2xx status or network error)
 *
 * @example
 * ```ts
 * await callReducer('create_lead', [organizationId, { name: 'Acme Corp' }], { token: session.stdbToken })
 * ```
 */
export async function callReducer(
  reducerName: string,
  args: unknown[],
  opts?: StdbHttpOptions,
): Promise<void> {
  const host = resolveHost(opts?.host)
  const module = resolveModule(opts?.module)
  const token = resolveToken(opts)

  const url = `${host}/v1/database/${module}/call/${reducerName}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  })

  if (!res.ok) {
    let errorBody: string
    try {
      const json = await res.json()
      errorBody = JSON.stringify(json)
    } catch {
      errorBody = (await res.text().catch(() => '')) || 'Unknown error'
    }
    if (res.status === 404) {
      throw new Error(
        `SpacetimeDB reducer call failed (404) at /v1/database/${module}/call/${reducerName}. ` +
          `Usually the published database name does not match env: set NEXT_PUBLIC_STDB_MODULE and STDB_MODULE ` +
          `to the same value you passed to spacetime publish (e.g. maincloud dashboard). Body: ${errorBody}`,
      )
    }
    throw new Error(`SpacetimeDB reducer call failed (${res.status}): ${errorBody}`)
  }

  // Reducer calls return 200 on success with empty or JSON body
  // We don't need to parse the response for reducers
}

/**
 * Batch multiple reducer calls. Each call is executed sequentially.
 * If one fails, the subsequent calls are not executed.
 *
 * @param calls - Array of reducer calls to execute
 * @param opts - StdbHttpOptions shared across all calls
 * @throws Error if any reducer call fails
 *
 * @example
 * ```ts
 * await callReducersBatch([
 *   { reducer: 'create_lead', args: [orgId, { name: 'Lead 1' }] },
 *   { reducer: 'create_lead', args: [orgId, { name: 'Lead 2' }] },
 * ], session.opts)
 * ```
 */
export async function callReducersBatch(
  calls: Array<{ reducer: string; args: unknown[] }>,
  opts?: StdbHttpOptions,
): Promise<void> {
  for (const call of calls) {
    await callReducer(call.reducer, call.args, opts)
  }
}
