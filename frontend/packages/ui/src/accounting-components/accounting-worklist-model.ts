import type { AccountMove } from "../lib/accounting-types"
import type { EntityRow } from "../lib/entity-view-types"
import {
  readSavedFilters,
  readTableView,
  type SavedTableFilter,
} from "../lib/entity-table-view"
import { stbEnumTag } from "../lib/accounting-move-utils"
import {
  accountingListStatus,
  type AccountingListStatus,
} from "./accounting-list-display"

export interface AccountingWorklistScope {
  organizationId: bigint | number | string
  companyId: bigint | number | string
  /** Without a stable authenticated identity, preferences stay in memory. */
  userId?: string | null
}
export interface AccountingWorklistUrlFilters {
  search?: string
  status?: string
  currencyId?: string
  queue?: string
}
export interface AccountingWorklistFilters {
  status: string
  currencyId: string
  queue: string
}
export interface AccountingWorklistView {
  search: string
  filters: AccountingWorklistFilters
  hiddenColumns: string[]
}
export interface NamedAccountingWorklist extends AccountingWorklistView {
  name: string
}
export interface AccountingWorklistPreferences {
  current: AccountingWorklistView
  saved: NamedAccountingWorklist[]
}
export const WORKLIST_COLUMNS = [
  "name",
  "partner",
  "issueDate",
  "dueDate",
  "amountTotal",
  "amountResidual",
  "currency",
  "status",
] as const
export const EMPTY_WORKLIST: AccountingWorklistView = {
  search: "",
  filters: { status: "", currencyId: "", queue: "" },
  hiddenColumns: [],
}
const FILTER_KEYS = new Set(["status", "currencyId", "queue"])
const STATUSES = new Set([
  "draft",
  "sent",
  "pending",
  "approved",
  "partial",
  "paid",
  "overdue",
  "cancelled",
  "unavailable",
])

/** No lossy Number conversion or permissive separators at identity boundaries. */
export function worklistId(value: unknown): string | null {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0))
    return null
  if (
    typeof value !== "number" &&
    typeof value !== "bigint" &&
    typeof value !== "string"
  )
    return null
  const text = String(value)
  if (!/^[1-9][0-9]*$/.test(text)) return null
  try {
    return BigInt(text) <= 18446744073709551615n ? text : null
  } catch {
    return null
  }
}

export function accountingWorklistKey(
  scope: AccountingWorklistScope | undefined,
  kind: "invoice" | "bill"
): string | null {
  const org = worklistId(scope?.organizationId)
  const company = worklistId(scope?.companyId)
  if (!org || !company || !scope?.userId?.trim()) return null
  return `lumiere:accounting-worklist:v1:${org}:${company}:${encodeURIComponent(scope.userId)}:${kind}`
}

export function scopedAccountingMoves(
  rows: readonly AccountMove[],
  scope?: AccountingWorklistScope
): AccountMove[] {
  const org = worklistId(scope?.organizationId)
  const company = worklistId(scope?.companyId)
  if (!org || !company) return []
  return rows.filter(
    (row) =>
      worklistId(row.id) !== null &&
      worklistId(row.organizationId) === org &&
      worklistId(row.companyId) === company
  )
}

function object(value: unknown): value is EntityRow {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function sanitizeView(value: unknown): AccountingWorklistView {
  if (!object(value))
    return {
      ...EMPTY_WORKLIST,
      filters: { ...EMPTY_WORKLIST.filters },
      hiddenColumns: [],
    }
  const parsed = readSavedFilters(
    [{ name: "current", search: value.search, filters: value.filters }],
    FILTER_KEYS
  )[0]
  const filters = parsed?.filters ?? {}
  return {
    search: (parsed?.search ?? "").slice(0, 200),
    filters: {
      status: STATUSES.has(filters.status ?? "") ? filters.status! : "",
      currencyId: worklistId(filters.currencyId) ?? "",
      queue: ["open", "overdue", "pending"].includes(filters.queue ?? "")
        ? filters.queue!
        : "",
    },
    hiddenColumns: readTableView(
      value,
      WORKLIST_COLUMNS,
      []
    ).hiddenColumns.filter((key) => key !== "name"),
  }
}

/** Reuses EntityTable's filter and column sanitizers; never persists rows, selection, or URL IDs. */
export function readAccountingWorklistPreferences(
  value: unknown
): AccountingWorklistPreferences {
  if (!object(value) || value.version !== 1)
    return { current: sanitizeView(null), saved: [] }
  const saved: NamedAccountingWorklist[] = []
  if (Array.isArray(value.saved)) {
    const names = new Set<string>()
    for (const entry of value.saved.slice(0, 20)) {
      if (!object(entry) || typeof entry.name !== "string") continue
      const name = entry.name.trim().slice(0, 60)
      if (!name || names.has(name.toLowerCase())) continue
      names.add(name.toLowerCase())
      saved.push({ name, ...sanitizeView(entry) })
    }
  }
  return { current: sanitizeView(value.current), saved }
}

export function saveAccountingWorklist(
  saved: readonly NamedAccountingWorklist[],
  name: string,
  view: AccountingWorklistView
): NamedAccountingWorklist[] {
  const cleanName = name.trim().slice(0, 60)
  if (!cleanName) return [...saved]
  // SavedTableFilter is the same named-search/filter contract as EntityTable, extended with columns.
  const entry: SavedTableFilter = {
    name: cleanName,
    search: view.search,
    filters: { ...view.filters },
  }
  return [
    ...saved.filter(
      (item) => item.name.toLowerCase() !== cleanName.toLowerCase()
    ),
    {
      ...sanitizeView({ ...entry, hiddenColumns: view.hiddenColumns }),
      name: cleanName,
    },
  ].slice(-20)
}

export function worklistTimestamp(value: unknown): number | undefined {
  if (!object(value)) return undefined
  const raw = value.microsSinceUnixEpoch
  if (
    typeof raw !== "bigint" &&
    typeof raw !== "number" &&
    typeof raw !== "string"
  )
    return undefined
  if (typeof raw === "number" && !Number.isSafeInteger(raw)) return undefined
  try {
    const ms = Number(BigInt(raw) / 1000n)
    return ms !== 0 && Number.isFinite(new Date(ms).getTime()) ? ms : undefined
  } catch {
    return undefined
  }
}

export interface AccountingWorklistRow extends EntityRow {
  id: string
  source: AccountMove
  name: string
  partner: string
  issueDate?: number
  dueDate?: number
  amountTotal?: number
  amountResidual?: number
  currencyId: string
  currency: string
  status: AccountingListStatus | "unavailable"
}

export function accountingWorklistRow(
  move: AccountMove,
  kind: "invoice" | "bill",
  currency: string
): AccountingWorklistRow {
  const due = worklistTimestamp(move.invoiceDateDue)
  const state = stbEnumTag(move.state).toLowerCase()
  const knownPayment = [
    "paid",
    "notpaid",
    "inpayment",
    "partial",
    "reversed",
  ].includes(stbEnumTag(move.paymentState).toLowerCase())
  const knownState =
    ["draft", "cancelled", "cancel"].includes(state) ||
    (state === "posted" &&
      knownPayment &&
      typeof move.amountResidual === "number" &&
      Number.isFinite(move.amountResidual))
  const safeMove = {
    ...move,
    invoiceDateDue:
      due === undefined ? null : { microsSinceUnixEpoch: BigInt(due) * 1000n },
  }
  return {
    id: String(move.id),
    source: move,
    name: move.name || `#${move.id}`,
    partner: move.invoicePartnerDisplayName || "—",
    issueDate: worklistTimestamp(move.invoiceDate),
    dueDate: due,
    amountTotal: Number.isFinite(move.amountTotal)
      ? move.amountTotal
      : undefined,
    amountResidual: Number.isFinite(move.amountResidual)
      ? move.amountResidual
      : undefined,
    currencyId: worklistId(move.currencyId) ?? "",
    currency,
    status: knownState ? accountingListStatus(safeMove, kind) : "unavailable",
  }
}
