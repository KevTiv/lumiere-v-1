export type QueryRow = Record<string, unknown>
export type QueryRows = QueryRow[]

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

/** Narrow `{ data: unknown }` from GET /api/query/:resource into row objects. */
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
