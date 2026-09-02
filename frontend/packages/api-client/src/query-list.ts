export type QueryRow = Record<string, unknown>
export type QueryRows = QueryRow[]

export class QueryResponseDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QueryResponseDecodeError"
  }
}

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

/** Strict typed-read boundary for normal `{ data: [...] }` query resources. */
export function decodeQueryListResponse<Row>(
  json: unknown,
  decodeRow: (row: unknown, index: number) => Row,
): Row[] {
  if (!isPlainObject(json)) {
    throw new QueryResponseDecodeError("query response must be an object")
  }
  const keys = Object.keys(json)
  if (keys.length !== 1 || keys[0] !== "data") {
    throw new QueryResponseDecodeError("query response must contain only data")
  }
  if (!Array.isArray(json.data)) {
    throw new QueryResponseDecodeError("query response data must be an array")
  }
  return json.data.map((row, index) => decodeRow(row, index))
}
