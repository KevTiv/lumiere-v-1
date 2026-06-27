/**
 * Gateway-aware HTTP helpers for hooks. Requires {@link LumiereApiProvider}.
 */
"use client"

import type { QueryRows } from "@lumiere/api-client"
import { getLumiereApiClientOrThrow } from "@lumiere/api-client"

export type { QueryRow, QueryRows } from "@lumiere/api-client"

export function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return getLumiereApiClientOrThrow().apiFetch(input, init)
}

export function parseQueryListResponse(json: unknown) {
  return getLumiereApiClientOrThrow().parseQueryListResponse(json)
}

export async function fetchQueryList(path: string, errorMessage: string): Promise<QueryRows> {
  return getLumiereApiClientOrThrow().fetchQueryList(path, errorMessage)
}

export async function fetchQueryListAllowEmpty(path: string): Promise<QueryRows> {
  return getLumiereApiClientOrThrow().fetchQueryListAllowEmpty(path)
}

/** React Query hashes keys with JSON.stringify — BigInt is not JSON-serializable. */
export function rqBigIntKey(id: bigint): string {
  return id.toString()
}

/**
 * SSR pages often pass `[]` when RSC fetch fails or is empty. Treat that as "no seed"
 * so React Query still runs the client fetch instead of serving stale empty data for 30s.
 */
export function coalesceQueryInitialData<T extends QueryRows>(
  initialData?: T,
): T | undefined {
  if (initialData === undefined) return undefined
  if (Array.isArray(initialData) && initialData.length === 0) return undefined
  return initialData
}
