/**
 * Typed helpers for GET /api/query/* list responses.
 * Centralizes JSON parsing so hooks can use useQuery<QueryRows>() without per-row casts.
 */

export type QueryRow = Record<string, unknown>
export type QueryRows = QueryRow[]

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Narrow `{ data: unknown }` from /api/query into a list of row objects. */
export function parseQueryListResponse(json: unknown): QueryRows {
  if (!isPlainObject(json)) return []
  const raw = json.data
  if (!Array.isArray(raw)) return []
  const out: QueryRow[] = []
  for (const item of raw) {
    if (isPlainObject(item)) out.push(item)
  }
  return out
}

export async function fetchQueryList(path: string, errorMessage: string): Promise<QueryRows> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(errorMessage)
  const json: unknown = await r.json()
  return parseQueryListResponse(json)
}

/** Same as {@link fetchQueryList} but returns [] when the response is not OK (e.g. optional map resources). */
export async function fetchQueryListAllowEmpty(path: string): Promise<QueryRows> {
  const r = await fetch(path)
  if (!r.ok) return []
  const json: unknown = await r.json()
  return parseQueryListResponse(json)
}

export async function emptyQueryRows(): Promise<QueryRows> {
  return []
}
