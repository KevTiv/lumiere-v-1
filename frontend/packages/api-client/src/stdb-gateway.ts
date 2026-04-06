import type { LumiereApiClient } from "./create-client"

/** Same contract as {@link LumiereApiClient.apiFetch}. */
export type LumiereHttpFetch = LumiereApiClient["apiFetch"]

function serializeArg(a: unknown): unknown {
  if (typeof a === "bigint") return a.toString()
  return a
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

/** POST `/api/call/:reducer` with JSON body (bigints stringified). */
export async function callStdbReducer(
  apiFetch: LumiereHttpFetch,
  reducer: string,
  args: unknown[],
): Promise<void> {
  const body = JSON.stringify(args.map(serializeArg))
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
