import type { LumiereApiClient } from "./create-client"

/** Same contract as {@link LumiereApiClient.apiFetch}. */
export type LumiereHttpFetch = LumiereApiClient["apiFetch"]

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * Top-level reducer args are often `organization_id` / `company_id` / record ids. Legacy callers used
 * `String(n)` which becomes invalid JSON `"1"` for SpacetimeDB `u64` (host expects a number).
 */
function coerceTopLevelU64Like(value: unknown): unknown {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value)
    if (Number.isSafeInteger(n) && n >= 0) {
      return n
    }
  }
  return value
}

/**
 * SpacetimeDB HTTP expects JSON **numbers** for `u64` args, not quoted strings.
 * `JSON.stringify` omits `bigint`; older code used `.toString()` which produced invalid `"1"` for u64.
 */
function reducerArgsReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== "bigint") {
    return value
  }
  if (value < 0n) {
    throw new Error(
      `Reducer argument bigint ${value} is negative (expected unsigned u64 in JSON body)`,
    )
  }
  if (value > MAX_SAFE_BIGINT) {
    throw new Error(
      `Reducer argument bigint ${value} exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}); JSON cannot represent it exactly as a number for SpacetimeDB`,
    )
  }
  return Number(value)
}

/** JSON body for `POST /api/call/:reducer` (and direct STDB HTTP call) — bigints → numbers when safe. */
export function stringifyReducerCallBody(args: unknown[]): string {
  return JSON.stringify(args.map(coerceTopLevelU64Like), reducerArgsReplacer)
}

/** Named JSON body for the contract-aware `/api/call/:reducer` endpoint. */
export function stringifyReducerCommandBody(input: Record<string, unknown>): string {
  return JSON.stringify(input, reducerArgsReplacer)
}

/** GET `/api/query/:resource` → parsed `data` rows. */
export async function queryStdbList(
  apiFetch: LumiereHttpFetch,
  resource: string,
): Promise<Record<string, unknown>[]> {
  const r = await apiFetch(`/api/query/${encodeURIComponent(resource)}`)
  if (!r.ok) {
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>
    throw new Error((json.error as string | undefined) ?? `Query ${resource} failed`)
  }
  const json = (await r.json()) as { data?: Record<string, unknown>[] }
  return json.data ?? []
}

/** POST `/api/call/:reducer` with JSON body (safe bigints as JSON numbers for u64). */
export async function callStdbReducer(
  apiFetch: LumiereHttpFetch,
  reducer: string,
  args: unknown[],
): Promise<void> {
  const body = stringifyReducerCallBody(args)
  const r = await apiFetch(`/api/call/${encodeURIComponent(reducer)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })
  if (!r.ok) {
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>
    throw new Error((json.error as string | undefined) ?? `Reducer ${reducer} failed`)
  }
}
