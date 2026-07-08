/**
 * Browser helpers for Next.js `/api/query/*` and `/api/call/*`.
 * Uses {@link getLumiereApiClient} when {@link LumiereApiProvider} is mounted (correct API gateway rewrite + Bearer on Expo);
 * otherwise falls back to same-origin `fetch` with cookies (tests / rare early calls).
 */
"use client"

import {
  callStdbReducer,
  getLumiereApiClient,
  queryStdbList,
  type LumiereHttpFetch,
} from "@lumiere/api-client"
import { encodeReducerCallArgs } from "./stdb-params-json"

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

export async function stdbBrowserCall(reducer: string, args: unknown[]): Promise<void> {
  return callStdbReducer(resolveApiFetch(), reducer, encodeReducerCallArgs(reducer, args))
}
