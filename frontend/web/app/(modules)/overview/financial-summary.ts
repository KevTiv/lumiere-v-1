import { createHistoryBuckets, resolveHistoryPeriod, type HistoryPeriod, type HistoryPeriodOptions } from "@lumiere/erp-shared/history-period"
import { moduleHistoryDateValue, moduleHistoryTimestampMs } from "@lumiere/ui/lib/module-history-filter"
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
  date_order?: unknown
  createDate?: unknown
  writeDate?: unknown
}

export function confirmedOrder(row: OverviewFinancialRow): boolean {
  return ["sale", "done"].includes(variantTag(row.state).toLowerCase())
}

export function orderDate(row: OverviewFinancialRow, timeZone = "UTC"): Date | null {
  const ms = moduleHistoryTimestampMs(moduleHistoryDateValue(row, "dateOrder"), timeZone)
  return ms === null ? null : new Date(Math.floor(ms))
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

/** The same selected calendar period drives both metrics and the adaptive trend. */
export function confirmedOrderTrend(
  rows: readonly OverviewFinancialRow[],
  now: Date,
  locale: string,
  period: HistoryPeriod = "180d",
  options: Omit<HistoryPeriodOptions, "now"> = {},
) {
  const bounds = resolveHistoryPeriod(period, { ...options, now })
  const dates = rows.filter(confirmedOrder).map((row) => orderDate(row, options.timeZone)).filter((date): date is Date => date != null)
    .map((date) => date.getTime())
    .filter((time) => (bounds.startMs === null || time >= bounds.startMs) && (bounds.endMs === null || time < bounds.endMs))
  // Drawing extents come from these records only; the source-history API owns coverage totals.
  const extent = dates.reduce((result, time) => ({
    startMs: result.startMs === null ? time : Math.min(result.startMs, time),
    endMs: result.endMs === null ? time + 1 : Math.max(result.endMs, time + 1),
  }), { ...bounds })
  return createHistoryBuckets(extent, { timeZone: options.timeZone, locale, maxBuckets: 36 }).map((bucket) => ({
    label: bucket.label,
    value: dates.filter((time) => time >= bucket.startMs && time < bucket.endMs).length,
  }))
}
