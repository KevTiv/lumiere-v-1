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
import { createStdbSdk, type StdbSdk } from "./sdk"

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

/** Build the domain SDK with the browser's authenticated API transport. */
export function createBrowserStdbSdk(): StdbSdk {
  return createStdbSdk(resolveApiFetch())
}

export async function stdbBrowserQuery(resource: string): Promise<Record<string, unknown>[]> {
  return queryStdbList(resolveApiFetch(), resource)
}

/** Read every active user in the caller's organization through the server-owned private profile join. */
export async function stdbBrowserQueryOrganizationUsers(): Promise<Record<string, unknown>[]> {
  const apiFetch = resolveApiFetch()
  const pageSize = 100
  const rows: Record<string, unknown>[] = []

  for (let offset = 0; ; offset += pageSize) {
    const response = await apiFetch(`/api/settings/users?limit=${pageSize}&offset=${offset}`)
    if (!response.ok) {
      throw new Error("Failed to fetch organization users")
    }
    const body = (await response.json()) as {
      data?: unknown
      meta?: { total?: unknown }
    }
    const page = Array.isArray(body.data)
      ? body.data.filter(
          (row): row is Record<string, unknown> =>
            row !== null && typeof row === "object" && !Array.isArray(row),
        )
      : []
    rows.push(...page)

    const total = Number(body.meta?.total)
    if (page.length < pageSize || (Number.isFinite(total) && rows.length >= total)) {
      return rows
    }
  }
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
