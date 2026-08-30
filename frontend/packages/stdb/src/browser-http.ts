/**
 * Browser helpers for Next.js typed query and operation endpoints.
 * Uses {@link getLumiereApiClient} when {@link LumiereApiProvider} is mounted (correct API gateway rewrite + Bearer on Expo);
 * otherwise falls back to same-origin `fetch` with cookies (tests / rare early calls).
 */
"use client"

import {
  getLumiereApiClient,
  queryStdbList,
  type LumiereHttpFetch,
} from "@lumiere/api-client"
import {
  stdbBffCommandPost,
  type StdbBffCommandInput,
  type StdbBffNamedReducerKey,
} from "./commands/stdb-http"

function resolveApiFetch(): LumiereHttpFetch {
  const c = getLumiereApiClient()
  if (c) return c.apiFetch
  return (input, init) => {
    if (typeof input === "string") {
      return fetch(input, { credentials: "include", ...init })
    }
    return fetch(input, { credentials: "include", ...init })
  }
}

export async function stdbBrowserQuery(resource: string): Promise<Record<string, unknown>[]> {
  return queryStdbList(resolveApiFetch(), resource)
}

/** Invoke a session-exposed operation through its generated immutable contract ID. */
export async function stdbBrowserCommand<K extends StdbBffNamedReducerKey>(
  operation: K,
  input: StdbBffCommandInput<K>,
): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost(operation, input)
  const response = await resolveApiFetch()(urlPath, init)
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
    throw new Error((json.error as string | undefined) ?? `Operation ${operation} failed`)
  }
}
