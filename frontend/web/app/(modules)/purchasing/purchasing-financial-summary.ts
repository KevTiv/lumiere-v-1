import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { normalizedTag } from "@lumiere/erp-workflows"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { kpiDate } from "@lumiere/ui/lib/kpi-tiles"
import { overviewMoneySummary } from "../overview/financial-summary"
import { scopedPurchaseReviewRows, type PurchaseDiscrepancyRow } from "./purchase-discrepancies"

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
  value: string
  change?: number
  vendors: VendorValue[]
  openOrders: OpenOrderValue[]
}

const unavailable = (): PurchasingFinancialSummary => ({ status: "unavailable", value: "—", vendors: [], openOrders: [] })
function amount(row: PurchasingMoneyRow): number | undefined {
  const raw = row.amountTotal ?? row.amount_total
  if (typeof raw !== "number" && (typeof raw !== "string" || raw.trim() === "")) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}
function inPeriod(date: Date, period: Period) { return date.getTime() >= period.startMs && date.getTime() <= period.endMs }

/** Confirmed order value is not paid spend. Keep transaction currencies and comparisons separate. */
export function purchasingFinancialSummary(
  rows: readonly PurchasingMoneyRow[], currencyCodes: ReadonlyMap<string, string>,
  scope: { organizationId: bigint; companyId: bigint }, period: Period, previous: Period, locale: string,
  states: { orders: ModuleDataState; currencies: ModuleDataState },
): PurchasingFinancialSummary {
  if (states.orders.status !== "ready" || states.currencies.status !== "ready" || scope.organizationId <= 0n || scope.companyId <= 0n) return unavailable()
  // An omitted scope column is not evidence that a row belongs to another company.
  if (rows.some((row) => !parseStrictU64(row.id) || !parseStrictU64(row.organizationId ?? row.organization_id) || !parseStrictU64(row.companyId ?? row.company_id))) return unavailable()
  const currentRows = scopedPurchaseReviewRows(rows, scope)
  if (new Set(currentRows.map((row) => String(parseStrictU64(row.id)))).size !== currentRows.length) return unavailable()
  const confirmed: PurchasingMoneyRow[] = []
  const prior: PurchasingMoneyRow[] = []
  const vendors = new Map<string, { vendorId: string; currency: string; rows: PurchasingMoneyRow[]; amount: number }>()
  for (const row of currentRows) {
    const state = normalizedTag(row.state)
    if (!["draft", "sent", "toapprove", "purchase", "done", "cancelled", "cancel"].includes(state)) return unavailable()
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
    const vendorId = String(parseStrictU64(row.partnerId ?? row.partner_id) ?? "")
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
  return { status: "ready", value: summary || "—", ...(change === undefined ? {} : { change }), vendors: groups, openOrders }
}
