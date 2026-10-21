import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { kpiDate } from "@lumiere/ui/lib/kpi-tiles"
import { mergeModuleStates, type ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { overviewTag, type AccountantOverviewData, type OverviewCollection, type OverviewRow } from "./accountant-overview-model"

const DAY = 86_400_000
const unavailable: ModuleDataState = { status: "partial" }
export type InsightDays = 30 | 90 | 180
export interface InsightCurrency { id: string; label: string; decimals: number | null }
export interface InsightPanel<T> { state: ModuleDataState; value: T | null }
export interface InsightComparison { current: number; previous: number; percent: number | null }
export interface InsightTrend { startMs: number; invoices: number; bills: number }
export interface InsightAging { bucket: "current" | "1-30" | "31-60" | "61-90" | "90+" | "undated"; invoices: number; bills: number }
export interface InsightBudget { id: string; name: string; planned: number; actual: number; variance: number }

function key(value: unknown): string {
  const parsed = parseStrictU64(value)
  return parsed !== undefined && parsed > 0n ? String(parsed) : ""
}
function amount(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}
function minor(value: unknown, decimals: number): bigint | null {
  const valueNumber = amount(value)
  if (valueNumber === null) return null
  const scaled = valueNumber * 10 ** decimals
  const rounded = Math.round(scaled)
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 0.000001 ? BigInt(rounded) : null
}
function major(value: bigint, decimals: number): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("unsafe chart amount")
  return Number(value) / 10 ** decimals
}
function panel<T>(state: ModuleDataState, calculate: () => T): InsightPanel<T> {
  if (state.status !== "ready") return { state, value: null }
  try { return { state, value: calculate() } } catch { return { state: unavailable, value: null } }
}
/** Unknown scope is not an empty successful company. Exact IDs never pass through Number. */
function scoped(source: OverviewCollection | undefined, data: AccountantOverviewData): OverviewCollection {
  if (!key(data.organizationId) || !key(data.companyId)) return { rows: [], state: unavailable }
  if (!source || source.state.status !== "ready") return { rows: [], state: source?.state ?? unavailable }
  const rows: OverviewRow[] = []
  const ids = new Set<string>()
  for (const row of source.rows) {
    const org = key(row.organizationId ?? row.organization_id)
    const company = key(row.companyId ?? row.company_id)
    if (org && org !== key(data.organizationId) || company && company !== key(data.companyId)) continue
    if (!org || !company || !key(row.id) || ids.has(key(row.id))) return { rows: [], state: unavailable }
    ids.add(key(row.id))
    if (row.deletedAt != null || row.deleted_at != null) continue
    rows.push(row)
  }
  return { rows, state: source.state }
}
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("required financial field unavailable")
  return value
}

export function buildAccountantInsights(data: AccountantOverviewData, days: InsightDays = 90, requestedCurrency?: string, now = new Date()) {
  const endMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  const startMs = endMs - days * DAY
  const previousStartMs = startMs - days * DAY
  const moves = scoped(data.moves, data)
  const companies = data.companies
  const companyRows = companies?.state.status === "ready" ? companies.rows.filter((row) => key(row.id) === key(data.companyId) && key(row.organizationId ?? row.organization_id) === key(data.organizationId)) : []
  const companyCurrencyId = companyRows.length === 1 ? key(companyRows[0]!.currencyId ?? companyRows[0]!.currency_id) : ""
  const catalog = data.currencies.state.status === "ready" ? data.currencies.rows.filter((row) => !key(row.organizationId ?? row.organization_id) || key(row.organizationId ?? row.organization_id) === key(data.organizationId)) : []
  const ids = new Set([...catalog.map((row) => key(row.id)), ...moves.rows.map((row) => key(row.currencyId ?? row.currency_id)), companyCurrencyId].filter(Boolean))
  const currencies: InsightCurrency[] = [...ids].sort().map((id) => {
    const matches = catalog.filter((row) => key(row.id) === id)
    const row = matches.length === 1 ? matches[0] : undefined
    const dp = row?.decimalPlaces ?? row?.decimal_places
    return { id, label: row ? String(row.code ?? row.name ?? `Currency #${id}`) : `Currency #${id}`, decimals: typeof dp === "number" && Number.isInteger(dp) && dp >= 0 && dp <= 6 ? dp : null }
  })
  const selectedId = requestedCurrency ?? (companyCurrencyId || currencies[0]?.id || "")
  const currency = currencies.find((item) => item.id === selectedId)
  const decimals = currency?.decimals ?? null
  const currencyState = data.currencies.state.status !== "ready" ? data.currencies.state : currency && decimals !== null ? { status: "ready" as const } : unavailable
  let documentState = mergeModuleStates([moves.state, currencyState])
  const knownTypes = ["outinvoice", "ininvoice", "outrefund", "inrefund", "entry", "outreceipt", "inreceipt"]
  if (moves.rows.some((row) => !["draft", "posted", "cancelled", "cancel"].includes(overviewTag(row.state)) || !knownTypes.includes(overviewTag(row.moveType ?? row.move_type)))) documentState = unavailable
  const posted = moves.rows.filter((row) => overviewTag(row.state) === "posted" && ["outinvoice", "ininvoice"].includes(overviewTag(row.moveType ?? row.move_type)))
  if (posted.some((row) => !key(row.currencyId ?? row.currency_id))) documentState = unavailable
  const selected = posted.filter((row) => key(row.currencyId ?? row.currency_id) === selectedId)
  const isInvoice = (row: OverviewRow) => overviewTag(row.moveType ?? row.move_type) === "outinvoice"
  const balances = panel(documentState, () => {
    let invoices = 0n, bills = 0n
    for (const row of selected) {
      const residual = required(minor(row.amountResidual ?? row.amount_residual, required(decimals)))
      if (residual < 0n) throw new Error("negative open invoice balance")
      if (isInvoice(row)) invoices += residual; else bills += residual
    }
    return { invoices: major(invoices, required(decimals)), bills: major(bills, required(decimals)) }
  })
  const period = panel(documentState, () => {
    const totals = { invoices: [0n, 0n], bills: [0n, 0n] }
    const months: Array<{ startMs: number; invoices: bigint; bills: bigint }> = []
    for (let month = Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), 1); month < endMs;) {
      months.push({ startMs: month, invoices: 0n, bills: 0n })
      const date = new Date(month)
      month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
    }
    for (const row of selected) {
      const date = required(kpiDate(row.invoiceDate ?? row.invoice_date ?? row.date)).getTime()
      if (date < previousStartMs || date > now.getTime()) continue
      const value = required(minor(row.amountTotal ?? row.amount_total, required(decimals)))
      const metric = isInvoice(row) ? "invoices" : "bills"
      totals[metric][date >= startMs ? 0 : 1]! += value
      if (date >= startMs) {
        const stamp = new Date(date)
        const month = required(months.find((item) => item.startMs === Date.UTC(stamp.getUTCFullYear(), stamp.getUTCMonth(), 1)))
        month[metric] += value
      }
    }
    const comparison = (values: bigint[]): InsightComparison => {
      const current = major(values[0]!, required(decimals)), previous = major(values[1]!, required(decimals))
      return { current, previous, percent: previous === 0 ? null : (current - previous) / Math.abs(previous) * 100 }
    }
    return { invoices: comparison(totals.invoices), bills: comparison(totals.bills), months: months.map((point): InsightTrend => ({ startMs: point.startMs, invoices: major(point.invoices, required(decimals)), bills: major(point.bills, required(decimals)) })) }
  })
  const aging = panel(documentState, () => {
    const buckets = ["current", "1-30", "31-60", "61-90", "90+", "undated"] as const
    const points = buckets.map((bucket) => ({ bucket, invoices: 0n, bills: 0n }))
    const today = endMs - DAY
    for (const row of selected) {
      const residual = required(minor(row.amountResidual ?? row.amount_residual, required(decimals)))
      if (residual < 0n) throw new Error("negative open invoice balance")
      if (residual === 0n) continue
      const raw = row.invoiceDateDue !== undefined ? row.invoiceDateDue : row.invoice_date_due
      if (raw === undefined && !Object.hasOwn(row, "invoiceDateDue") && !Object.hasOwn(row, "invoice_date_due")) throw new Error("due-date field unavailable")
      const due = raw == null ? null : required(kpiDate(raw))
      const daysLate = due ? Math.floor((today - Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())) / DAY) : null
      const index = daysLate === null ? 5 : daysLate <= 0 ? 0 : daysLate <= 30 ? 1 : daysLate <= 60 ? 2 : daysLate <= 90 ? 3 : 4
      points[index]![isInvoice(row) ? "invoices" : "bills"] += residual
    }
    return points.map((point): InsightAging => ({ bucket: point.bucket, invoices: major(point.invoices, required(decimals)), bills: major(point.bills, required(decimals)) }))
  })
  const budgetSource = scoped(data.budgets, data)
  const budgetState = mergeModuleStates([budgetSource.state, companies?.state ?? unavailable, currencyState])
  const budgets = panel(budgetState, () => {
    if (!companyCurrencyId || companyCurrencyId !== selectedId) throw new Error("select the company currency for budgets")
    const rows: InsightBudget[] = []
    for (const row of budgetSource.rows) {
      const state = overviewTag(row.state)
      if (!["draft", "confirm", "validate", "done", "cancel"].includes(state)) throw new Error("budget state unavailable")
      if (!["confirm", "validate", "done"].includes(state)) continue
      const from = required(kpiDate(row.dateFrom ?? row.date_from)).getTime()
      const to = required(kpiDate(row.dateTo ?? row.date_to)).getTime()
      if (from > to) throw new Error("invalid budget period")
      if (from > now.getTime() || to < startMs) continue
      const planned = required(minor(row.totalPlanned ?? row.total_planned, required(decimals)))
      const actual = required(minor(row.totalPractical ?? row.total_practical, required(decimals)))
      if (typeof row.name !== "string" || !row.name.trim()) throw new Error("budget name unavailable")
      rows.push({ id: key(row.id), name: row.name, planned: major(planned, required(decimals)), actual: major(actual, required(decimals)), variance: major(actual - planned, required(decimals)) })
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  })
  return { currencies, currency, selectedId, companyCurrencyId, days, startMs, endMs, previousStartMs, asOfMs: now.getTime(), balances, period, aging, budgets }
}
