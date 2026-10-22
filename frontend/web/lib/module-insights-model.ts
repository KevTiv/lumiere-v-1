import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { normalizedTag } from "@lumiere/erp-workflows"
import { kpiDate } from "@lumiere/ui/lib/kpi-tiles"
import { mergeModuleStates, type ModuleDataState } from "@lumiere/ui/lib/module-data-state"

export type InsightModule = "sales" | "crm" | "purchasing" | "expenses" | "reports"
export type InsightPeriod = 30 | 90 | 180
/** Read projection only; never a command or a catch-all record. */
export interface InsightRecord {
  id?: unknown; organizationId?: unknown; organization_id?: unknown
  companyId?: unknown; company_id?: unknown; name?: unknown; state?: unknown
  currencyId?: unknown; currency_id?: unknown; companyCurrencyId?: unknown; company_currency_id?: unknown
  code?: unknown; decimalPlaces?: unknown; decimal_places?: unknown
  amountTotal?: unknown; amount_total?: unknown; totalAmount?: unknown; total_amount?: unknown
  expectedRevenue?: unknown; expected_revenue?: unknown
  dateOrder?: unknown; date_order?: unknown; createdAt?: unknown; created_at?: unknown
  createDate?: unknown; create_date?: unknown; dateDeadline?: unknown; date_deadline?: unknown
  datePlanned?: unknown; date_planned?: unknown; receiptStatus?: unknown; receipt_status?: unknown
  isWon?: unknown; is_won?: unknown; isLost?: unknown; is_lost?: unknown
  deletedAt?: unknown; deleted_at?: unknown
}
export interface InsightSource { rows: readonly InsightRecord[]; state: ModuleDataState }
export interface ModuleInsightInput {
  module: InsightModule; organizationId: string | number | bigint; companyId: string | number | bigint
  records: InsightSource; currencies: InsightSource
}
export interface InsightValue<T> { state: ModuleDataState; value: T | null }
export interface InsightCurrency { id: string; label: string; decimals: number | null }
export interface InsightQueue { key: string; records: Array<{ id: string; name: string; status: string }> }

const DAY = 86_400_000
const unavailable: ModuleDataState = { status: "partial" }
const ready: ModuleDataState = { status: "ready" }
export const insightDefinitions = {
  sales: { model: "sale_order", tab: "orders", states: ["draft", "sent", "toapprove", "sale", "done", "cancelled"], eligible: ["sale", "done"], current: ["draft", "sent"], dateField: "dateOrder", more: ["ops", "deliveries", "returns", "commission-plans"] },
  crm: { model: "opportunity", tab: "opportunities", states: ["open", "won", "lost"], eligible: ["open", "won"], current: ["open"], dateField: "createdAt", more: ["leads", "activities", "contacts"] },
  purchasing: { model: "purchase_order", tab: "orders", states: ["draft", "sent", "toapprove", "purchase", "done", "cancelled"], eligible: ["purchase", "done"], current: ["purchase"], dateField: "dateOrder", more: ["requisitions", "vendors", "lines"] },
  expenses: { model: "expense_sheet", tab: "expense-sheets", states: ["draft", "submitted", "approved", "posted", "done", "refused"], eligible: ["submitted", "approved", "posted", "done"], current: ["submitted"], dateField: "createdAt", more: ["expenses", "operations"] },
  reports: { model: "financial_report", tab: "reports", states: ["draft", "generated", "exported", "archived"], eligible: ["draft", "generated", "exported", "archived"], current: ["generated", "exported"], dateField: "createDate", more: ["statements", "trial-balance", "scheduled-reports", "dashboards"] },
} satisfies { [K in InsightModule]: { model: string; tab: string; states: string[]; eligible: string[]; current: string[]; dateField: string; more: string[] } }

export function insightId(value: unknown): string {
  const parsed = parseStrictU64(value)
  return parsed !== undefined && parsed > 0n ? String(parsed) : ""
}
function requireValue<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("missing insight field")
  return value
}
function panel<T>(state: ModuleDataState, calculate: () => T): InsightValue<T> {
  if (state.status !== "ready") return { state, value: null }
  try { return { state, value: calculate() } } catch { return { state: unavailable, value: null } }
}
function minor(value: unknown, decimals: number): bigint {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) throw new Error("invalid amount")
  const scaled = Number(value) * 10 ** decimals
  const rounded = Math.round(scaled)
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) >= 0.000001) throw new Error("unsafe amount")
  return BigInt(rounded)
}
function major(value: bigint, decimals: number): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("unsafe total")
  return Number(value) / 10 ** decimals
}
function scope(input: ModuleInsightInput): InsightSource {
  if (!insightId(input.organizationId) || !insightId(input.companyId)) return { rows: [], state: unavailable }
  if (input.records.state.status !== "ready") return { rows: [], state: input.records.state }
  const rows: InsightRecord[] = [], ids = new Set<string>()
  for (const row of input.records.rows) {
    const org = insightId(row.organizationId ?? row.organization_id)
    const company = insightId(row.companyId ?? row.company_id)
    if (org && org !== insightId(input.organizationId) || company && company !== insightId(input.companyId)) continue
    // CRM explicitly unassigned opportunities are organization-level, not this company's pipeline.
    if (input.module === "crm" && (row.companyId === null || row.company_id === null)) continue
    const id = insightId(row.id)
    if (!org || !company || !id || ids.has(id)) return { rows: [], state: unavailable }
    ids.add(id)
    if (row.deletedAt != null || row.deleted_at != null) continue
    rows.push(row)
  }
  return { rows, state: ready }
}
function recordState(row: InsightRecord, module: InsightModule): string {
  if (module !== "crm") return normalizedTag(row.state)
  const won = row.isWon ?? row.is_won, lost = row.isLost ?? row.is_lost
  if (typeof won !== "boolean" || typeof lost !== "boolean" || won && lost) throw new Error("invalid opportunity outcome")
  return won ? "won" : lost ? "lost" : "open"
}
export function insightRecordHref(module: InsightModule, id: string): string {
  if (module === "sales" || module === "purchasing") return `/${module}/orders/${id}`
  if (module === "expenses") return `/expenses/reports/${id}`
  return `/${module}?tab=${insightDefinitions[module].tab}&filter=${encodeURIComponent(`id:${id}`)}`
}

export function buildModuleInsights(input: ModuleInsightInput, days: InsightPeriod = 90, requestedCurrency?: string, now = new Date()) {
  const definition = insightDefinitions[input.module]
  const source = scope(input)
  const monetary = input.module !== "reports"
  const currencyId = (row: InsightRecord) => insightId(input.module === "crm" ? row.companyCurrencyId ?? row.company_currency_id : row.currencyId ?? row.currency_id)
  const catalog = input.currencies.state.status === "ready" ? input.currencies.rows.filter((row) => !insightId(row.organizationId ?? row.organization_id) || insightId(row.organizationId ?? row.organization_id) === insightId(input.organizationId)) : []
  const ids = [...new Set([...source.rows.map(currencyId), ...catalog.map((row) => insightId(row.id))].filter(Boolean))].sort()
  const currencies: InsightCurrency[] = ids.map((id) => {
    const matches = catalog.filter((row) => insightId(row.id) === id)
    const row = matches.length === 1 ? matches[0] : undefined
    const decimals = row?.decimalPlaces ?? row?.decimal_places
    return { id, label: row ? String(row.code ?? row.name ?? `#${id}`) : `#${id}`, decimals: typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 6 ? decimals : null }
  })
  const selectedId = requestedCurrency ?? source.rows.map(currencyId).filter(Boolean).sort()[0] ?? currencies[0]?.id ?? ""
  const currency = currencies.find((item) => item.id === selectedId)
  let state = monetary ? mergeModuleStates([source.state, input.currencies.state]) : source.state
  if (state.status === "ready" && monetary && (!selectedId || source.rows.some((row) => !currencyId(row)))) state = unavailable
  const selected = monetary ? source.rows.filter((row) => currencyId(row) === selectedId) : source.rows
  const classified = panel(state, () => selected.map((row) => {
    const status = recordState(row, input.module)
    if (!(definition.states as readonly string[]).includes(status)) throw new Error("unavailable state")
    return { row, status }
  }))
  const decimals = currency?.decimals
  const moneyState = monetary && decimals == null && classified.state.status === "ready" ? unavailable : classified.state
  const amountOf = (row: InsightRecord) => input.module === "crm" ? row.expectedRevenue ?? row.expected_revenue : input.module === "expenses" ? row.totalAmount ?? row.total_amount : row.amountTotal ?? row.amount_total
  const dateOf = (row: InsightRecord) => requireValue(kpiDate(input.module === "sales" || input.module === "purchasing" ? row.dateOrder ?? row.date_order : input.module === "reports" ? row.createDate ?? row.create_date : row.createdAt ?? row.created_at)).getTime()
  const endMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  const startMs = endMs - days * DAY, previousStartMs = startMs - days * DAY
  const current = classified.value?.filter((item) => (definition.current as readonly string[]).includes(item.status)) ?? []
  const totals = panel(moneyState, () => ({ amount: monetary ? major(current.reduce((total, item) => total + minor(amountOf(item.row), requireValue(decimals)), 0n), requireValue(decimals)) : current.length }))
  const counts = panel(classified.state, () => ({ current: input.module === "reports" ? classified.value!.filter((item) => item.status === "draft").length : current.length, total: selected.length, states: definition.states.map((status) => ({ status, count: classified.value!.filter((item) => item.status === status).length })) }))
  const activity = panel(classified.state, () => {
    const eligible = classified.value!.filter((item) => (definition.eligible as readonly string[]).includes(item.status)).map((item) => ({ ...item, time: dateOf(item.row) }))
    const currentPeriod = eligible.filter((item) => item.time >= startMs && item.time <= now.getTime())
    const previous = eligible.filter((item) => item.time >= previousStartMs && item.time < startMs)
    return { current: currentPeriod, previous }
  })
  const period = panel(mergeModuleStates([moneyState, activity.state]), () => {
    const sum = (items: NonNullable<typeof activity.value>["current"]) => monetary ? major(items.reduce((total, item) => total + minor(amountOf(item.row), requireValue(decimals)), 0n), requireValue(decimals)) : items.length
    const currentValue = sum(activity.value!.current), previousValue = sum(activity.value!.previous)
    const months: Array<{ startMs: number; value: number; count: number }> = []
    for (let month = Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), 1); month < endMs;) {
      const stamp = new Date(month), next = Date.UTC(stamp.getUTCFullYear(), stamp.getUTCMonth() + 1, 1)
      const items = activity.value!.current.filter((item) => item.time >= month && item.time < next)
      months.push({ startMs: month, value: sum(items), count: items.length })
      month = next
    }
    return { current: currentValue, previous: previousValue, percent: previousValue === 0 ? null : (currentValue - previousValue) / Math.abs(previousValue) * 100, months }
  })
  const periodCounts = panel(activity.state, () => {
    const count = (items: NonNullable<typeof activity.value>["current"]) => input.module === "reports" ? items.filter((item) => ["generated", "exported"].includes(item.status)).length : items.length
    return { current: count(activity.value!.current), previous: count(activity.value!.previous) }
  })
  const queues = panel(classified.state, (): InsightQueue[] => {
    const items = classified.value!
    const queue = (key: string, matches: typeof items): InsightQueue => ({ key, records: matches.map((item) => ({ id: insightId(item.row.id), name: typeof item.row.name === "string" && item.row.name.trim() ? item.row.name : `#${insightId(item.row.id)}`, status: item.status })).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1) })
    const stateQueue = (status: string) => queue(status, items.filter((item) => item.status === status))
    if (input.module === "sales") return [stateQueue("draft"), stateQueue("sent"), stateQueue("toapprove")]
    if (input.module === "expenses") return [stateQueue("draft"), stateQueue("submitted"), stateQueue("approved")]
    if (input.module === "reports") return [stateQueue("draft"), stateQueue("generated"), stateQueue("exported")]
    if (input.module === "crm") {
      const overdue = current.filter((item) => {
        const raw = item.row.dateDeadline ?? item.row.date_deadline
        if (raw == null && !("dateDeadline" in item.row) && !("date_deadline" in item.row)) throw new Error("missing deadline")
        return raw != null && requireValue(kpiDate(raw)).getTime() < endMs - DAY
      })
      return [queue("open", current), queue("overdue", overdue), stateQueue("won")]
    }
    const late = current.filter((item) => {
      const receipt = item.row.receiptStatus ?? item.row.receipt_status
      if (typeof receipt !== "string") throw new Error("missing receipt state")
      if (["full", "received"].includes(receipt.toLowerCase())) return false
      const raw = item.row.datePlanned ?? item.row.date_planned
      if (raw == null && !("datePlanned" in item.row) && !("date_planned" in item.row)) throw new Error("missing planned date")
      return raw != null && requireValue(kpiDate(raw)).getTime() < endMs - DAY
    })
    return [stateQueue("draft"), stateQueue("toapprove"), queue("late", late)]
  })
  const recent = panel(classified.state, () => classified.value!.map((item) => ({ id: insightId(item.row.id), name: typeof item.row.name === "string" && item.row.name.trim() ? item.row.name : `#${insightId(item.row.id)}`, status: item.status, time: dateOf(item.row) })).filter((item) => item.time <= now.getTime()).sort((a, b) => b.time - a.time || a.id.localeCompare(b.id)).slice(0, 5))
  return { module: input.module, definition, monetary, currency, currencies, selectedId, startMs, endMs, previousStartMs, asOfMs: now.getTime(), totals, counts, period, periodCounts, queues, recent }
}
