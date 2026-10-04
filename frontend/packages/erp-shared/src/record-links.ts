/**
 * Canonical in-app record links. A record link opens the owning module's tab focused on
 * exactly one record: `/{module}?tab={tab}&filter=id:{id}`. The module tab applies the
 * `filter` (`useModuleUrlFilters`), so no query parameter other than `tab` and `filter` is
 * ever a record link — ad-hoc parameters such as `?so=` or `?highlight=` are not read by
 * any module and only land on the default tab.
 */

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
export const purchaseOrderHref = byId("purchasing", "orders")
export const stockPickingHref = byId("inventory", "transfers")
/**
 * Any account move (invoice, bill, entry, payment/reimbursement entry). The Accounting
 * "invoices" and "bills" tabs are custom lists that ignore `filter`; "journal-entries"
 * applies it over every move.
 */
export const accountMoveHref = byId("accounting", "journal-entries")
export const accountPaymentHref = byId("accounting", "payments")
export const expenseSheetHref = byId("expenses", "expense-sheets")
/** The timesheets of one project. */
export const projectTimesheetsHref = (projectId: RecordId) =>
  moduleTabHref("projects", "timesheets", { projectId: String(projectId) })
