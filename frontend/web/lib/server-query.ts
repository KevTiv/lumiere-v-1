/**
 * RSC/SSR reads via the Rust api-server (`GET /v1/query/:resource`).
 *
 * Browser clients use same-origin `/api/query/*` (forwarded to api-server).
 * Server components call api-server directly with the session token so SQL/RBAC
 * stays centralized in `query_exec.rs` instead of duplicating `server.ts`.
 */
import "server-only"

import { parseQueryListResponse } from "@lumiere/api-client"
import type { QueryResourceKey } from "@lumiere/stdb/generated/query-registry"
import type { QueryRowFor } from "@lumiere/stdb/query-row-map"
import {
  decodeAccountAccountsQueryResponse,
  decodeAccountJournalsQueryResponse,
  decodeAccountMoveLinesQueryResponse,
  decodeAccountTaxesQueryResponse,
  decodeCompaniesQueryResponse,
  type AccountAccountQueryRow,
  type AccountJournalQueryRow,
  type AccountMoveLineQueryRow,
  type AccountTaxQueryRow,
  type CompanyQueryRow,
} from "@lumiere/stdb/resource-reads"

import type { ApiSession } from "@/lib/api-session"
import { resolveApiServerBaseUrl } from "@/lib/api-server-forward"
import { serverQueryUrl } from "@/lib/server-query-url"

export type ServerQueryCredentials = {
  stdbToken: string
  identityHex?: string
}

export type ServerQueryRowFor<K extends QueryResourceKey> =
  K extends "companies" ? CompanyQueryRow
    : K extends "account-accounts" ? AccountAccountQueryRow
      : K extends "account-journals" ? AccountJournalQueryRow
        : K extends "account-move-lines" ? AccountMoveLineQueryRow
          : K extends "account-taxes" ? AccountTaxQueryRow
            : QueryRowFor<K>

function requireApiServerBase(): string {
  const base = resolveApiServerBaseUrl()
  if (!base) {
    throw new Error(
      "serverFetchQueryList: api-server forwarding disabled. Set LUMIERE_API_SERVER_URL (dev defaults to http://127.0.0.1:8082).",
    )
  }
  return base
}

async function fetchFromApiServer<K extends QueryResourceKey>(
  creds: ServerQueryCredentials,
  resource: K,
): Promise<ServerQueryRowFor<K>[]> {
  const base = requireApiServerBase()
  const headers = new Headers()
  headers.set("Authorization", `Bearer ${creds.stdbToken}`)
  const identity = creds.identityHex
  if (identity && identity !== "unknown") {
    headers.set("x-stdb-identity", identity)
  }

  const res = await fetch(serverQueryUrl(base, resource), {
    headers,
    cache: "no-store",
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const detail = typeof json.error === "string" ? json.error : res.statusText
    throw new Error(detail || `Query ${resource} failed`)
  }
  const payload: unknown = await res.json()
  if (resource === "companies") {
    return decodeCompaniesQueryResponse(payload) as ServerQueryRowFor<K>[]
  }
  if (resource === "account-accounts") {
    return decodeAccountAccountsQueryResponse(payload) as ServerQueryRowFor<K>[]
  }
  if (resource === "account-journals") {
    return decodeAccountJournalsQueryResponse(payload) as ServerQueryRowFor<K>[]
  }
  if (resource === "account-move-lines") {
    return decodeAccountMoveLinesQueryResponse(payload) as ServerQueryRowFor<K>[]
  }
  if (resource === "account-taxes") {
    return decodeAccountTaxesQueryResponse(payload) as ServerQueryRowFor<K>[]
  }
  // Unmigrated Phase 6 resources retain their existing structural boundary.
  return parseQueryListResponse(payload) as ServerQueryRowFor<K>[]
}

function sessionCredentials(session: ApiSession): ServerQueryCredentials {
  return {
    stdbToken: session.stdbToken,
    identityHex: session.identityHex,
  }
}

/**
 * Fetch query rows for RSC initial data via api-server `query_exec.rs`.
 */
export async function serverFetchQueryList<K extends QueryResourceKey>(
  session: ApiSession,
  resource: K,
  errorMessage: string,
): Promise<ServerQueryRowFor<K>[]> {
  try {
    return await fetchFromApiServer(sessionCredentials(session), resource)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(errorMessage || msg)
  }
}

/** Like {@link serverFetchQueryList} but returns `[]` on failure (SSR seed pattern). */
export async function serverFetchQueryListAllowEmpty<K extends QueryResourceKey>(
  session: ApiSession,
  resource: K,
): Promise<ServerQueryRowFor<K>[]> {
  try {
    return await fetchFromApiServer(sessionCredentials(session), resource)
  } catch {
    return []
  }
}

/** Parallel batch of {@link serverFetchQueryListAllowEmpty} — order matches `resources`. */
export async function serverFetchQueryListsAllowEmpty<const T extends readonly QueryResourceKey[]>(
  session: ApiSession,
  resources: T,
): Promise<{
  [K in keyof T]: T[K] extends QueryResourceKey ? ServerQueryRowFor<T[K]>[] : never
}> {
  const rows = await Promise.all(
    resources.map((resource) => serverFetchQueryListAllowEmpty(session, resource)),
  )
  return rows as {
    [K in keyof T]: T[K] extends QueryResourceKey ? ServerQueryRowFor<T[K]>[] : never
  }
}

/** Token-based fetch for session bootstrap (e.g. `user-organization` before org id is known). */
export async function serverFetchQueryListWithCredentialsAllowEmpty<K extends QueryResourceKey>(
  creds: ServerQueryCredentials,
  resource: K,
): Promise<ServerQueryRowFor<K>[]> {
  try {
    return await fetchFromApiServer(creds, resource)
  } catch {
    return []
  }
}
