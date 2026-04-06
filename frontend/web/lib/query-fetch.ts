/**
 * Typed helpers for GET /api/query/* list responses.
 * Centralizes JSON parsing so hooks can use useQuery<QueryRows>() without per-row casts.
 */
"use client"

import type { QueryRows } from "@lumiere/api-client"
import { getLumiereApiClient } from "@lumiere/api-client"

import { webApi } from "./lumiere-web-http"

export type { QueryRow, QueryRows } from "@lumiere/api-client"

function clientOrWeb() {
  return getLumiereApiClient() ?? webApi
}

export function parseQueryListResponse(json: unknown) {
  return clientOrWeb().parseQueryListResponse(json)
}

export async function fetchQueryList(path: string, errorMessage: string) {
  return clientOrWeb().fetchQueryList(path, errorMessage)
}

/** Same as {@link fetchQueryList} but returns [] when the response is not OK (e.g. optional map resources). */
export async function fetchQueryListAllowEmpty(path: string) {
  return clientOrWeb().fetchQueryListAllowEmpty(path)
}

export async function emptyQueryRows(): Promise<QueryRows> {
  return []
}

export { apiFetch } from "./api-fetch"
