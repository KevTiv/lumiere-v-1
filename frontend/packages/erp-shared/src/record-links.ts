/**
 * Canonical in-app record links. A record link opens the owning module's tab focused on
 * exactly one record: `/{module}?tab={tab}&filter=id:{id}`. The module tab applies the
 * `filter` (`useModuleUrlFilters`). Dedicated result and record views have their own
 * explicit routes below.
 */

import { parseStrictU64 } from "./u64"

/** In-app module tab href; `?tab=` is omitted for the default tab, `filter` entries are `key:value`. */
export function moduleTabHref(
  moduleId: string,
  tabId: string,
  filter?: Record<string, string>,
  defaultTab = "dashboard",
): string {
  const base = `/${moduleId.replace(/^\/+/, "")}`
  const params = new URLSearchParams()
  if (tabId && tabId !== defaultTab) params.set("tab", tabId)
  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      if (key && value !== undefined && value !== "") params.append("filter", `${key}:${value}`)
    }
  }
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

type RecordId = bigint | number | string

const byId = (moduleId: string, tabId: string) => (id: RecordId) =>
  moduleTabHref(moduleId, tabId, { id: String(id) })

export const saleOrderHref = byId("sales", "orders")
export const returnOrderHref = byId("sales", "returns")
export const purchaseOrderHref = byId("purchasing", "orders")
export const stockPickingHref = byId("inventory", "transfers")
/**
 * Any account move (invoice, bill, entry, payment/reimbursement entry). The Accounting
 * "invoices" and "bills" tabs are custom lists that ignore `filter`; "journal-entries"
 * applies it over every move.
 */
export const accountMoveHref = byId("accounting", "journal-entries")
/** A verified import can link its batch without opening any records for editing. */
export function accountMoveBatchHref(ids: readonly string[], companyId: number): string {
  const params = new URLSearchParams({
    tab: "journal-entries",
    importEntryCompany: String(companyId),
    importEntryIds: ids.join(","),
  })
  return `/accounting?${params}`
}

export function accountMoveBatchSelection(ids: string | null, company: string | null): { ids: ReadonlySet<string>; companyId: string } | null {
  if (ids === null && company === null) return null
  const entries = ids?.split(",") ?? []
  const valid = (value: string) => /^[1-9]\d{0,19}$/.test(value) && parseStrictU64(value) !== undefined
  if (!company || !valid(company) || entries.length > 200 || !entries.every(valid)) {
    return { ids: new Set(), companyId: "" }
  }
  return { ids: new Set(entries), companyId: company }
}
export const accountPaymentHref = byId("accounting", "payments")
export const expenseSheetHref = byId("expenses", "expense-sheets")

export const ownerQueueRoutes = {
  overdueInvoices: { pathname: "/accounting", tab: "invoices", value: "overdue-invoices" },
  draftBills: { pathname: "/accounting", tab: "bills", value: "draft-bills" },
  lowStockProducts: { pathname: "/warehouse", tab: "stock", value: "low-stock" },
} as const

export type OwnerQueue = keyof typeof ownerQueueRoutes

export function ownerQueueHref(queue: OwnerQueue): string {
  const { pathname, tab, value } = ownerQueueRoutes[queue]
  return `${pathname}?tab=${tab}&ownerQueue=${value}`
}
/** Dedicated workspaces with native review and related-record controls. */
export const invoiceRecordPageHref = (id: RecordId) => `/accounting/invoices/${String(id)}`
export const saleOrderRecordPageHref = (id: RecordId) => `/sales/orders/${String(id)}`
export const purchaseOrderRecordPageHref = (id: RecordId) => `/purchasing/orders/${String(id)}`

/** Open a saved report on the native result view while preserving list or period scope. */
export function reportWorkspaceHref(query: string, id?: RecordId): string {
  const params = new URLSearchParams(query)
  params.set("tab", "reports")
  if (id == null) params.delete("report")
  else params.set("report", String(id))
  return `/reports?${params.toString()}`
}

/** Warehouse opens the exact transfer on its Inventory-owned detail page. */
export function stockTransferRecordPageHref(id: RecordId, tab?: "operations"): string {
  return moduleTabHref(`inventory/transfers/${id}`, tab ?? "overview", undefined, "overview")
}

export function fleetVehicleHref(id: RecordId, tab?: "service" | "inspections"): string {
  return moduleTabHref(`fleet/vehicles/${id}`, tab ?? "overview", undefined, "overview")
}

/** The timesheets of one project. */
export const projectTimesheetsHref = (projectId: RecordId) =>
  moduleTabHref("projects", "timesheets", { projectId: String(projectId) })
