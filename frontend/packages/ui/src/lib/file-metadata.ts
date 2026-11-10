import type { TFunction } from "i18next"
import { formatTimestampLike } from "./entity-row-values"

/** File cards and record tables share the same date shape and selected locale. */
export function formatFileDate(value: unknown, locale?: string): string {
  const date = formatTimestampLike(value)
  return date
    ? date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })
    : "—"
}

const RELATED_RECORD_LABELS: Readonly<Record<string, string>> = {
  sale_order: "Sales order",
  purchase_order: "Purchase order",
  account_move: "Accounting entry",
  stock_picking: "Inventory transfer",
  subscription: "Subscription",
  document: "Document",
  fleet_vehicle: "Vehicle",
  calendar_event: "Calendar event",
  pos_session: "Point of sale session",
  mrp_production: "Manufacturing order",
  hr_expense: "Expense",
  hr_expense_sheet: "Expense report",
  project_project: "Project",
  helpdesk_ticket: "Helpdesk ticket",
  lead: "Lead",
  opportunity: "Opportunity",
  contact: "Contact",
}

/** Product label for a record a document was attached to; unknown models stay generic. */
export function documentRelatedRecordLabel(model: unknown, t: TFunction): string {
  const key = typeof model === "string" ? model : ""
  if (key && Object.hasOwn(RELATED_RECORD_LABELS, key)) {
    return t(`documents.relatedRecord.${key}`, { defaultValue: RELATED_RECORD_LABELS[key]! })
  }
  return t("documents.relatedRecord.generic", { defaultValue: "Related record" })
}
