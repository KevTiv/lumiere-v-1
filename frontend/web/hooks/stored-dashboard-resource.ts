import {
  decodeQueryListResponse,
  type QueryRow,
  type QueryRows,
} from "@lumiere/api-client"
import { z } from "zod"

import { StoredDashboardSourceQueryError } from "./stored-dashboard-source-state"
import { STORED_DASHBOARD_RESOURCE_SCOPES } from "./stored-dashboard-resource-scope.generated"

export type StoredDashboardIncompleteReason =
  | "company-scope"
  | "read-limit"
  | "source-incomplete"

export interface StoredDashboardResource {
  rows: QueryRows
  complete: boolean
  incompleteReason?: StoredDashboardIncompleteReason
}

const MAX_PAGES = 40
const MAX_ROWS = 20_000
const paginationSchema = z.object({
  nextCursor: z.string().max(4096).nullish(),
  next_cursor: z.string().max(4096).nullish(),
  hasMore: z.boolean().optional(),
  has_more: z.boolean().optional(),
  complete: z.boolean().optional(),
})

function companyId(value: unknown): string | undefined {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    return undefined
  const id =
    typeof value === "bigint" || typeof value === "number"
      ? String(value)
      : value
  return typeof id === "string" &&
    /^[1-9][0-9]{0,19}$/.test(id) &&
    BigInt(id) <= 18446744073709551615n
    ? id
    : undefined
}

/** Undefined is unknown/redacted scope; only an explicit nullable null is shared. */
function rowCompany(row: {
  companyId?: unknown
  company_id?: unknown
}): string | null | undefined {
  const hasCamel = Object.hasOwn(row, "companyId")
  const hasSnake = Object.hasOwn(row, "company_id")
  const decode = (value: unknown) => (value === null ? null : companyId(value))
  const camel = hasCamel ? decode(row.companyId) : undefined
  const snake = hasSnake ? decode(row.company_id) : undefined
  if (hasCamel && hasSnake && camel !== snake) return undefined
  return hasCamel ? camel : snake
}

/** Consume cursor envelopes before aggregating; bounded reads report incomplete coverage. */
export async function fetchStoredDashboardResource(
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  resource: string,
  options: { companyId?: string; signal?: AbortSignal } = {},
): Promise<StoredDashboardResource> {
  const rows: QueryRows = []
  const cursors = new Set<string>()
  const scope =
    options.companyId === undefined
      ? "native"
      : (STORED_DASHBOARD_RESOURCE_SCOPES[resource] ?? "unknown")
  const selectedCompany = companyId(options.companyId)
  let scopeIncomplete =
    scope === "unknown" || (scope !== "native" && !selectedCompany)
  let scannedRows = 0
  const result = (
    reason?: StoredDashboardIncompleteReason,
  ): StoredDashboardResource => {
    const incompleteReason = scopeIncomplete ? "company-scope" : reason
    return {
      rows,
      complete: incompleteReason === undefined,
      ...(incompleteReason ? { incompleteReason } : {}),
    }
  }
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    options.signal?.throwIfAborted()
    const query = new URLSearchParams()
    if (options.companyId) query.set("companyId", options.companyId)
    if (cursor) query.set("cursor", cursor)
    const response = await fetcher(
      `/api/query/${encodeURIComponent(resource)}${query.size ? `?${query}` : ""}`,
      { signal: options.signal },
    )
    const payload: unknown = await response.json().catch((error: unknown) => {
      options.signal?.throwIfAborted()
      if (error instanceof Error && error.name === "AbortError") throw error
      return null
    })
    options.signal?.throwIfAborted()
    if (!response.ok) {
      const detail =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : `Query ${resource} failed`
      throw new StoredDashboardSourceQueryError(
        resource,
        response.status,
        detail,
      )
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      !("data" in payload) ||
      !Array.isArray(payload.data)
    ) {
      throw new StoredDashboardSourceQueryError(
        resource,
        response.status,
        `Query ${resource} returned invalid data`,
      )
    }
    // Dynamic ERP rows use the established query transport boundary. Per-model
    // values stay unknown until the metric resolver validates their bindings.
    const data = decodeQueryListResponse({ data: payload.data }, (row) => {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new StoredDashboardSourceQueryError(
          resource,
          response.status,
          `Query ${resource} returned invalid data`,
        )
      return row as QueryRow
    })
    const pagination = paginationSchema.safeParse(payload)
    if (!pagination.success) {
      throw new StoredDashboardSourceQueryError(
        resource,
        502,
        "Dashboard source returned an invalid pagination cursor or coverage flag",
      )
    }
    const envelope = pagination.data
    const remaining = MAX_ROWS - scannedRows
    const truncated = data.length > remaining
    const pageRows = data.slice(0, remaining)
    scannedRows += pageRows.length
    for (const row of pageRows) {
      if (scope === "native") {
        rows.push(row)
        continue
      }
      if (scope === "unknown" || !selectedCompany) continue
      const company = rowCompany(row)
      if (
        company === undefined ||
        (company === null && scope !== "optional-company")
      ) {
        scopeIncomplete = true
      } else if (company === selectedCompany || company === null) {
        rows.push(row)
      }
    }
    const next = envelope.nextCursor ?? envelope.next_cursor
    const hasMore =
      envelope.hasMore === true ||
      envelope.has_more === true ||
      envelope.complete === false
    if (next == null || next === "") {
      return result(
        truncated ? "read-limit" : hasMore ? "source-incomplete" : undefined,
      )
    }
    if (cursors.has(next)) {
      throw new StoredDashboardSourceQueryError(
        resource,
        502,
        "Dashboard source returned an invalid pagination cursor",
      )
    }
    if (scannedRows >= MAX_ROWS) return result("read-limit")
    cursors.add(next)
    cursor = next
  }
  return result("read-limit")
}
