import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { normalizedTag } from "@lumiere/erp-workflows"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { kpiDate } from "@lumiere/ui/lib/kpi-tiles"
import { percentChange } from "@lumiere/ui/lib/dashboard-time-range"
import { overviewMoneySummary } from "../overview/financial-summary"
import { completeScopedPurchaseReviewRows, type PurchaseDiscrepancyRow } from "./purchase-discrepancies"

interface PurchasingMoneyRow extends PurchaseDiscrepancyRow {
  currencyId?: unknown
  currency_id?: unknown
  amountTotal?: unknown
  amount_total?: unknown
  dateOrder?: unknown
  date_order?: unknown
  datePlanned?: unknown
  date_planned?: unknown
  partnerId?: unknown
  partner_id?: unknown
}
interface Period { startMs: number; endMs: number }
interface VendorValue { vendorId: string; currency: string; amount: number; value: string }
interface OpenOrderValue { id: string; name: string; vendorId: string; value: string; ordered: Date | null; expected: Date | null; state: string }
export interface PurchasingFinancialSummary {
  status: "ready" | "unavailable"
  vendorsStatus: "ready" | "unavailable"
  value: string
  change?: number
  vendors: VendorValue[]
  openOrders: OpenOrderValue[]
}

const unavailable = (): PurchasingFinancialSummary => ({ status: "unavailable", vendorsStatus: "unavailable", value: "—", vendors: [], openOrders: [] })
function amount(row: PurchasingMoneyRow): number | undefined {
  const raw = row.amountTotal ?? row.amount_total
  if (typeof raw !== "number" && (typeof raw !== "string" || raw.trim() === "")) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}
function inPeriod(date: Date, period: Period) { return date.getTime() >= period.startMs && date.getTime() <= period.endMs }

interface ReviewRead { rows: readonly PurchasingMoneyRow[]; state: ModuleDataState }
const orderStates = ["draft", "sent", "toapprove", "purchase", "done", "cancelled", "cancel"]
const openStates = ["purchase", "draft", "sent", "toapprove"]
const receiptStates = ["nothing", "partial", "full"]
function reviewedRows(read: ReviewRead, scope: { organizationId: bigint; companyId: bigint }) {
  return read.state.status === "ready" ? completeScopedPurchaseReviewRows(read.rows, scope) : null
}

/** Operational counts depend on identity/status admission, independently of monetary fields. */
export function purchasingReviewCounts(
  reads: { orders: ReviewRead; toApprove: ReviewRead; partialReceipt: ReviewRead; overBilled: ReviewRead },
  scope: { organizationId: bigint; companyId: bigint }, period: Period, previous: Period, nowMs: number,
) {
  const candidates = reviewedRows(reads.orders, scope)
  const orders = candidates?.every((row) => orderStates.includes(normalizedTag(row.state))) ? candidates : null
  const open = orders?.filter((row) => openStates.includes(normalizedTag(row.state))) ?? null
  const openDates = open?.map((row) => kpiDate(row.dateOrder ?? row.date_order))
  const change = openDates?.every((date) => date !== null)
    ? percentChange(openDates.filter((date) => date && inPeriod(date, period)).length,
      openDates.filter((date) => date && date.getTime() < period.startMs && inPeriod(date, previous)).length) : undefined
  const confirmed = orders?.filter((row) => ["purchase", "done"].includes(normalizedTag(row.state))) ?? null
  const receiptComplete = orders?.every((row) => normalizedTag(row.state) !== "purchase"
    || receiptStates.includes(normalizedTag(row.receiptStatus ?? row.receipt_status)))
  const plannedComplete = confirmed?.every((row) => kpiDate(row.datePlanned ?? row.date_planned) !== null
    && receiptStates.includes(normalizedTag(row.receiptStatus ?? row.receipt_status)))
  const receivedOrNotDue = plannedComplete && confirmed && confirmed.length > 0
    ? Math.round(100 * confirmed.filter((row) => normalizedTag(row.receiptStatus ?? row.receipt_status) === "full"
      || nowMs <= (kpiDate(row.datePlanned ?? row.date_planned)?.getTime() ?? 0)).length / confirmed.length) : null
  const approval = reviewedRows(reads.toApprove, scope)
  const partial = reviewedRows(reads.partialReceipt, scope)
  const overBilled = reviewedRows(reads.overBilled, scope)
  return {
    open: open?.length ?? null, change,
    pendingReceipt: receiptComplete && orders ? orders.filter((row) => normalizedTag(row.state) === "purchase"
      && normalizedTag(row.receiptStatus ?? row.receipt_status) !== "full").length : null,
    toApprove: approval?.every((row) => normalizedTag(row.state) === "toapprove") ? approval.length : null,
    partialReceipt: partial?.every((row) => normalizedTag(row.state) === "purchase"
      && normalizedTag(row.receiptStatus ?? row.receipt_status) === "partial") ? partial.length : null,
    overBilled: overBilled?.every((row) => ["draft", "confirmed"].includes(normalizedTag(row.state))
      && Boolean(parseStrictU64(row.orderId ?? row.order_id))) ? overBilled.length : null,
    receivedOrNotDue,
  }
}

/** Confirmed order value is not paid spend. Keep transaction currencies and comparisons separate. */
export function purchasingFinancialSummary(
  rows: readonly PurchasingMoneyRow[], currencyCodes: ReadonlyMap<string, string>,
  scope: { organizationId: bigint; companyId: bigint }, period: Period, previous: Period, locale: string,
  states: { orders: ModuleDataState; currencies: ModuleDataState },
): PurchasingFinancialSummary {
  if (states.orders.status !== "ready" || states.currencies.status !== "ready" || scope.organizationId <= 0n || scope.companyId <= 0n) return unavailable()
  const currentRows = completeScopedPurchaseReviewRows(rows, scope)
  if (currentRows === null) return unavailable()
  const confirmed: PurchasingMoneyRow[] = []
  const prior: PurchasingMoneyRow[] = []
  const vendors = new Map<string, { vendorId: string; currency: string; rows: PurchasingMoneyRow[]; amount: number }>()
  let vendorsAvailable = true
  for (const row of currentRows) {
    const state = normalizedTag(row.state)
    if (!orderStates.includes(state)) return unavailable()
    if (!["purchase", "done"].includes(state)) continue
    const date = kpiDate(row.dateOrder ?? row.date_order)
    if (!date) return unavailable()
    const inPrevious = date.getTime() < period.startMs && inPeriod(date, previous)
    if (!inPeriod(date, period) && !inPrevious) continue
    const value = amount(row)
    const currencyId = parseStrictU64(row.currencyId ?? row.currency_id)
    const currency = currencyId && currencyCodes.get(String(currencyId))
    if (value === undefined || !currency || !/^[A-Z]{3}$/.test(currency)) return unavailable()
    const exact = { ...row, amountTotal: value, currencyId: String(currencyId) }
    if (inPrevious) prior.push(exact)
    if (!inPeriod(date, period)) continue
    confirmed.push(exact)
    const vendor = parseStrictU64(row.partnerId ?? row.partner_id)
    if (!vendor) { vendorsAvailable = false; continue }
    const vendorId = String(vendor)
    const key = `${currency}:${vendorId}`
    const group = vendors.get(key) ?? { vendorId, currency, rows: [], amount: 0 }
    group.rows.push(exact)
    group.amount += value
    if (!Number.isFinite(group.amount)) return unavailable()
    vendors.set(key, group)
  }
  const summary = overviewMoneySummary(confirmed, currencyCodes, "amountTotal", locale)
  if (summary === null) return unavailable()
  const groups: VendorValue[] = []
  const perCurrency = new Map<string, number>()
  for (const group of [...vendors.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.amount - a.amount || a.vendorId.localeCompare(b.vendorId))) {
    if ((perCurrency.get(group.currency) ?? 0) >= 5) continue
    const value = overviewMoneySummary(group.rows, currencyCodes, "amountTotal", locale)
    if (value === null) return unavailable()
    groups.push({ vendorId: group.vendorId, currency: group.currency, amount: group.amount, value })
    perCurrency.set(group.currency, (perCurrency.get(group.currency) ?? 0) + 1)
  }
  const currentCurrencies = new Set(confirmed.map((row) => currencyCodes.get(String(row.currencyId))))
  const priorCurrencies = new Set(prior.map((row) => currencyCodes.get(String(row.currencyId))))
  let change: number | undefined
  if (currentCurrencies.size === 1 && priorCurrencies.size === 1 && [...currentCurrencies][0] === [...priorCurrencies][0]) {
    const current = confirmed.reduce((total, row) => total + (amount(row) ?? 0), 0)
    const baseline = prior.reduce((total, row) => total + (amount(row) ?? 0), 0)
    if (Number.isFinite(current) && Number.isFinite(baseline) && baseline > 0) {
      const percent = ((current - baseline) / baseline) * 100
      if (Number.isFinite(percent)) change = Math.round(percent)
    }
  }
  const openOrders = currentRows.filter((row) => ["purchase", "draft", "sent", "toapprove"].includes(normalizedTag(row.state))).slice(0, 4).map((row): OpenOrderValue => {
    const value = amount(row)
    return { id: String(row.id), name: String(row.name ?? row.id), vendorId: String(parseStrictU64(row.partnerId ?? row.partner_id) ?? ""),
      value: value === undefined ? "—" : overviewMoneySummary([{ currencyId: row.currencyId ?? row.currency_id, amountTotal: value }], currencyCodes, "amountTotal", locale) || "—",
      ordered: kpiDate(row.dateOrder ?? row.date_order), expected: kpiDate(row.datePlanned ?? row.date_planned), state: normalizedTag(row.state) }
  })
  return { status: "ready", vendorsStatus: vendorsAvailable ? "ready" : "unavailable", value: summary || "—",
    ...(change === undefined ? {} : { change }), vendors: vendorsAvailable ? groups : [], openOrders }
}
