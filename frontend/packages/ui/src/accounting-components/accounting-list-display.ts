import { i18n } from "@lumiere/i18n"
import type { AccountMove } from "../lib/accounting-types"
import { microsSinceEpochToDate, stbEnumTag } from "../lib/accounting-move-utils"
import { formatInvoiceMoney } from "./invoice-document"

export interface AccountingListCurrencyOption { value: string; code?: string; label?: string }
export interface AccountingListDisplayProps {
  currencyOptions?: readonly AccountingListCurrencyOption[]
  /** Controlled canonical URL filters; kept separate from local search and status controls. */
  initialFilters?: Record<string, string>
  /** Removes one canonical filter; "*" clears all canonical filters. */
  onInitialFilterClear?: (key: string) => void
}
export type AccountingListStatus = "draft" | "sent" | "pending" | "approved" | "partial" | "paid" | "overdue" | "cancelled"

export function accountingListStatus(move: AccountMove, kind: "invoice" | "bill", now = new Date()): AccountingListStatus {
  const state = stbEnumTag(move.state).toLowerCase()
  const payment = stbEnumTag(move.paymentState).toLowerCase()
  if (state === "cancelled" || state === "cancel") return "cancelled"
  if (state === "draft") return "draft"
  if (payment === "paid") return "paid"
  const due = microsSinceEpochToDate(move.invoiceDateDue)
  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)
  if (state === "posted" && Number(move.amountResidual) > 0 && due && due.getTime() < today.getTime()) return "overdue"
  if (payment === "inpayment" || payment === "partial") return "partial"
  return kind === "bill" ? "pending" : "sent"
}

export function matchesAccountingListFilters(move: AccountMove, filters: Record<string, string>, kind: "invoice" | "bill", now = new Date()): boolean {
  return Object.entries(filters).every(([key, value]) => {
    if (key === "id") return String(move.id) === value
    if (key === "queue") {
      if (value === "open") return stbEnumTag(move.state).toLowerCase() === "posted" && Number(move.amountResidual) > 0
      if (value === "overdue") return accountingListStatus(move, kind, now) === "overdue"
      return false
    }
    if (key === "status") return accountingListStatus(move, kind, now) === value.toLowerCase()
    const fields: Record<string, keyof AccountMove> = { payment_state: "paymentState", move_type: "moveType", partner_id: "partnerId" }
    const actual = move[(fields[key] ?? key) as keyof AccountMove]
    return stbEnumTag(actual).toLowerCase() === value.toLowerCase()
  })
}

export function accountingDocumentHref(move: AccountMove): string {
  return `/accounting/invoices/${encodeURIComponent(String(move.id))}`
}

function currencyId(move: AccountMove): string {
  const row = move as AccountMove & { currencyId?: unknown; currency_id?: unknown }
  return String(row.currencyId ?? row.currency_id ?? "")
}
export function accountingListCurrency(move: AccountMove, options: readonly AccountingListCurrencyOption[]) {
  const id = currencyId(move)
  return { id: id || undefined, code: options.find((option) => option.value === id)?.code }
}
export function accountingListMoney(amount: number | undefined, move: AccountMove, options: readonly AccountingListCurrencyOption[]): string {
  return amount == null || !Number.isFinite(amount) ? "—" : formatInvoiceMoney(amount, accountingListCurrency(move, options))
}

export interface AccountingCurrencySummary {
  key: string
  label: string
  total: number | null
  residual: number | null
  currency: { id?: string; code?: string }
}
/** Missing currency IDs are never assumed to represent the same currency. */
export function accountingCurrencySummaries(moves: readonly AccountMove[], options: readonly AccountingListCurrencyOption[]): AccountingCurrencySummary[] {
  const groups = new Map<string, AccountingCurrencySummary>()
  for (const move of moves) {
    const id = currencyId(move)
    const key = id || `unknown-${String(move.id)}`
    const option = options.find((currency) => currency.value === id)
    const group = groups.get(key) ?? { key, label: option?.label || option?.code || (id ? i18n.t("accounting.accountingListDisplay.currencyValue", { defaultValue: "Currency #{{id}}", id: id }) : i18n.t("accounting.accountingListDisplay.documentValueCurrencyNotAvailable", { defaultValue: "Document #{{value1}} · Currency not available", value1: move.id })), total: 0, residual: 0, currency: accountingListCurrency(move, options) }
    group.total = group.total != null && move.amountTotal != null && Number.isFinite(move.amountTotal) ? group.total + move.amountTotal : null
    group.residual = group.residual != null && move.amountResidual != null && Number.isFinite(move.amountResidual) ? group.residual + move.amountResidual : null
    groups.set(key, group)
  }
  return [...groups.values()]
}

export function accountingSummaryValue(groups: readonly AccountingCurrencySummary[], field: "total" | "residual"): string {
  if (!groups.length) return "—"
  if (groups.some((group) => !group.currency.id)) return i18n.t("accounting.accountingListDisplay.currencyNotAvailable", { defaultValue: "Currency not available" })
  if (groups.length > 1) return i18n.t("accounting.accountingListDisplay.currencyCount", { defaultValue: "{{count}} currencies", count: groups.length })
  const group = groups[0]!
  return group[field] == null ? "—" : formatInvoiceMoney(group[field], group.currency)
}
