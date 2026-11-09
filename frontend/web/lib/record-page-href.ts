import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { entityScalarText } from "@lumiere/ui/lib/entity-row-values"

/** The page of a record, by the model name notes and attachments are filed under. */
const RECORD_PAGE: Record<string, (id: string) => string> = {
  sale_order: (id) => `/sales/orders/${id}`,
  purchase_order: (id) => `/purchasing/orders/${id}`,
  account_move: (id) => `/accounting/invoices/${id}`,
  stock_picking: (id) => `/inventory/transfers/${id}`,
  subscription: (id) => `/subscriptions/${id}`,
  document: (id) => `/documents/${id}`,
  fleet_vehicle: (id) => `/fleet/vehicles/${id}`,
  calendar_event: (id) => `/calendar/events/${id}`,
  pos_session: (id) => `/pos/sessions/${id}`,
  mrp_production: (id) => `/manufacturing/orders/${id}`,
  hr_expense_sheet: (id) => `/expenses/reports/${id}`,
  project_project: (id) => `/projects/${id}`,
}

/** Where a record of `model` has a page of its own, or undefined when it has none. */
export function recordPageHref(
  model: unknown,
  id: unknown,
): string | undefined {
  const key = entityScalarText(model)
  if (!key || !Object.hasOwn(RECORD_PAGE, key)) return undefined
  const recordId = parseStrictU64(id)
  return recordId ? RECORD_PAGE[key]?.(recordId.toString()) : undefined
}
