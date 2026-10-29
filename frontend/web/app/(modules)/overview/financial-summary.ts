import { kpiDate } from "@lumiere/ui/lib/kpi-tiles"
import { variantTag } from "@lumiere/erp-workflows"

/** Only projected fields used by the owner overview; missing financial values stay unknown. */
export interface OverviewFinancialRow {
  state?: unknown
  moveType?: unknown
  move_type?: unknown
  currencyId?: unknown
  currency_id?: unknown
  amountTotal?: unknown
  amountResidual?: unknown
  invoiceDateDue?: unknown
  dateOrder?: unknown
  createDate?: unknown
  writeDate?: unknown
}

export function confirmedOrder(row: OverviewFinancialRow): boolean {
  return ["sale", "done"].includes(variantTag(row.state).toLowerCase())
}

export function orderDate(row: OverviewFinancialRow): Date | null {
  return kpiDate(row.dateOrder ?? row.createDate ?? row.writeDate)
}

/** Required eligibility fields cannot be redacted into a reassuring zero-valued queue. */
export function overviewFinancialInputsComplete(rows: readonly OverviewFinancialRow[], kind: "orders" | "invoices"): boolean {
  return rows.every((row) => {
    const state = variantTag(row.state).toLowerCase()
    if (!state) return false
    if (kind === "orders") return !confirmedOrder(row) || orderDate(row) != null
    const moveType = variantTag(row.moveType ?? row.move_type).toLowerCase()
    if (!moveType) return false
    if (state !== "posted" || moveType !== "outinvoice") return true
    return row.amountResidual != null && row.amountResidual !== "" && Number.isFinite(Number(row.amountResidual))
      && "invoiceDateDue" in row && (row.invoiceDateDue == null || kpiDate(row.invoiceDateDue) != null)
  })
}

/** Match Accounting's calendar-day definition: posted, positive balance, known past due date. */
export function overduePostedInvoices<T extends OverviewFinancialRow>(rows: readonly T[], now = new Date()): T[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return rows.filter((row) => {
    const residual = row.amountResidual
    const due = kpiDate(row.invoiceDateDue)
    return variantTag(row.state).toLowerCase() === "posted"
      && variantTag(row.moveType ?? row.move_type).toLowerCase() === "outinvoice"
      && residual != null && residual !== "" && Number.isFinite(Number(residual)) && Number(residual) > 0
      && due != null && due.getTime() < today
  })
}

/** No FX conversion is implied: every amount is kept in its explicit transaction currency. */
export function overviewMoneySummary(
  rows: readonly OverviewFinancialRow[],
  currencies: ReadonlyMap<string, string>,
  amount: "amountTotal" | "amountResidual",
  locale: string,
): string | null {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const code = currencies.get(String(row.currencyId ?? row.currency_id ?? ""))
    const value = row[amount]
    if (!code || !/^[A-Z]{3}$/.test(code) || value == null || value === "" || !Number.isFinite(Number(value))) return null
    const total = (totals.get(code) ?? 0) + Number(value)
    if (!Number.isFinite(total)) return null
    totals.set(code, total)
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "code" }).format(value),
  ).join(" · ")
}

/** Year-aware UTC buckets exclude same-month orders from earlier years and unknown dates. */
export function confirmedOrderTrend(rows: readonly OverviewFinancialRow[], now: Date, locale: string) {
  const months = Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1)))
  const monthKey = (date: Date) => `${date.getUTCFullYear()}-${date.getUTCMonth()}`
  const counts = new Map(months.map((date) => [monthKey(date), 0]))
  for (const row of rows) {
    if (!confirmedOrder(row)) continue
    const date = orderDate(row)
    if (!date || date.getTime() > now.getTime()) continue
    const key = monthKey(date)
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1)
  }
  return months.map((date) => ({
    label: new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(date),
    value: counts.get(monthKey(date))!,
  }))
}
