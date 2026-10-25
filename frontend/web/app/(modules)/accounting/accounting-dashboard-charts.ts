/**
 * Pure data behind the accounting dashboard charts. Every figure comes from the subscribed
 * account_move / account_payment rows the dashboard already loads; nothing here talks to the server.
 */
import { variantTag } from "@lumiere/erp-workflows"
import type { AccountMoveQueryRow, ResourceQueryRowMap } from "@lumiere/stdb/resource-reads"
import type { RankedBarItem, ShareBarRow, TabbedTableRow } from "@lumiere/ui"
import { detectAnomalies, monthBuckets, type ChartDatum } from "@lumiere/ui/lib/chart-format"
import { percentChange } from "@lumiere/ui/lib/dashboard-time-range"
import { invoiceStatus } from "./invoice-status"

type Translate = Parameters<typeof invoiceStatus>[1]

export type AccountPaymentQueryRow = ResourceQueryRowMap["account-payments"]

export interface MsRange {
  startMs: number
  endMs: number
}

const DAY_MS = 86_400_000

/** Milliseconds since the epoch of a timestamp cell (`{ microsSinceUnixEpoch }`, micros or millis). */
export function timestampMs(value: unknown): number | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  let raw: unknown = value
  let isMicros = false
  if (typeof value === "object") {
    isMicros = "microsSinceUnixEpoch" in value || "__timestamp_micros_since_unix_epoch__" in value
    if ("microsSinceUnixEpoch" in value) raw = (value as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch
    else if ("__timestamp_micros_since_unix_epoch__" in value) {
      raw = (value as { __timestamp_micros_since_unix_epoch__: unknown }).__timestamp_micros_since_unix_epoch__
    }
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return isMicros || n > 1e15 ? n / 1000 : n
}

function inRange(ms: number | null, range: MsRange): boolean {
  return ms != null && ms >= range.startMs && ms <= range.endMs
}

/** The document date an invoice or bill is reported under. */
export function moveDateMs(move: AccountMoveQueryRow): number | null {
  return timestampMs(move.invoiceDate) ?? timestampMs(move.date) ?? timestampMs(move.createDate)
}

export function isPosted(move: AccountMoveQueryRow): boolean {
  return variantTag(move.state) === "Posted"
}

function amountTotal(move: AccountMoveQueryRow): number {
  const total = Number(move.amountTotal ?? 0)
  return Number.isFinite(total) ? total : 0
}

function amountResidual(move: AccountMoveQueryRow): number {
  const residual = Number(move.amountResidual ?? 0)
  return Number.isFinite(residual) ? residual : 0
}

// ─── Revenue vs expenses ─────────────────────────────────────────────────────

/** Posted invoice and bill totals per month for the last `months` months, with the net between them. */
export function revenueVsExpensesByMonth(
  invoices: readonly AccountMoveQueryRow[],
  bills: readonly AccountMoveQueryRow[],
  now: Date,
  months = 6,
  locale?: string,
): ChartDatum[] {
  return monthBuckets(months, now, locale).map((bucket) => {
    const range = { startMs: bucket.startMs, endMs: bucket.endMs }
    const sum = (rows: readonly AccountMoveQueryRow[]) =>
      rows.filter((move) => isPosted(move) && inRange(moveDateMs(move), range)).reduce((total, move) => total + amountTotal(move), 0)
    const revenue = Math.round(sum(invoices))
    const expenses = Math.round(sum(bills))
    return { month: bucket.label, revenue, expenses, net: revenue - expenses }
  })
}

// ─── AR / AP aging ───────────────────────────────────────────────────────────

export const AGING_BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

/** Days past due → aging bucket; not yet due (or no due date) is "Current". */
export function agingBucketFor(move: AccountMoveQueryRow, nowMs: number): AgingBucket {
  const dueMs = timestampMs(move.invoiceDateDue)
  if (dueMs == null || dueMs >= nowMs) return "Current"
  const days = Math.floor((nowMs - dueMs) / DAY_MS)
  if (days <= 0) return "Current"
  if (days <= 30) return "1-30"
  if (days <= 60) return "31-60"
  if (days <= 90) return "61-90"
  return "90+"
}

/** Open (residual) AR and AP per aging bucket, rounded to whole units. */
export function agingTotals(
  invoices: readonly AccountMoveQueryRow[],
  bills: readonly AccountMoveQueryRow[],
  nowMs: number,
): Array<{ bucket: AgingBucket; AR: number; AP: number }> {
  const totals = new Map(AGING_BUCKETS.map((bucket) => [bucket, { AR: 0, AP: 0 }]))
  for (const move of invoices) {
    if (!isPosted(move)) continue
    const residual = amountResidual(move)
    if (residual > 0) totals.get(agingBucketFor(move, nowMs))!.AR += residual
  }
  for (const move of bills) {
    if (!isPosted(move)) continue
    const residual = amountResidual(move)
    if (residual > 0) totals.get(agingBucketFor(move, nowMs))!.AP += residual
  }
  return AGING_BUCKETS.map((bucket) => ({
    bucket,
    AR: Math.round(totals.get(bucket)!.AR),
    AP: Math.round(totals.get(bucket)!.AP),
  }))
}

/** The aging totals as share-bar rows (one bar for AR, one for AP). */
export function agingShareRows(aging: ReturnType<typeof agingTotals>, labels: { ar: string; ap: string }): ShareBarRow[] {
  const row = (side: "AR" | "AP", label: string): ShareBarRow => ({
    label,
    values: Object.fromEntries(aging.map((entry) => [entry.bucket, entry[side]])),
  })
  return [row("AR", labels.ar), row("AP", labels.ap)]
}

// ─── Collection rate ─────────────────────────────────────────────────────────

export interface CollectionRate {
  invoiced: number
  collected: number
  outstanding: number
  /** Collected share of invoiced, 0..100; 0 when nothing was invoiced. */
  rate: number
}

/** How much of the period's posted invoicing has been paid (total minus what is still open). */
export function collectionRate(invoices: readonly AccountMoveQueryRow[], range: MsRange): CollectionRate {
  let invoiced = 0
  let outstanding = 0
  for (const move of invoices) {
    if (!isPosted(move) || !inRange(moveDateMs(move), range)) continue
    invoiced += amountTotal(move)
    outstanding += Math.max(0, Math.min(amountResidual(move), amountTotal(move)))
  }
  const collected = invoiced - outstanding
  return { invoiced, collected, outstanding, rate: invoiced > 0 ? (collected / invoiced) * 100 : 0 }
}

// ─── Top customers ───────────────────────────────────────────────────────────

/** Display name of an invoice's customer: the live partner label, then the snapshot on the move. */
export function customerName(move: AccountMoveQueryRow, partnerLabels: ReadonlyMap<string, string>): string {
  const partnerId = move.partnerId != null ? String(move.partnerId) : ""
  return (
    (partnerId ? partnerLabels.get(partnerId) : undefined) ??
    move.invoicePartnerDisplayName?.trim() ??
    (partnerId ? `Partner #${partnerId}` : "No customer")
  ) || "No customer"
}

/** Posted invoicing per customer in the period, with the change against the previous period. */
export function topCustomers(
  invoices: readonly AccountMoveQueryRow[],
  partnerLabels: ReadonlyMap<string, string>,
  current: MsRange,
  previous: MsRange,
): RankedBarItem[] {
  const now = new Map<string, { value: number; count: number }>()
  const before = new Map<string, number>()
  for (const move of invoices) {
    if (!isPosted(move)) continue
    const ms = moveDateMs(move)
    const name = customerName(move, partnerLabels)
    if (inRange(ms, current)) {
      const entry = now.get(name) ?? { value: 0, count: 0 }
      entry.value += amountTotal(move)
      entry.count += 1
      now.set(name, entry)
    } else if (inRange(ms, previous)) {
      before.set(name, (before.get(name) ?? 0) + amountTotal(move))
    }
  }
  return [...now.entries()].map(([label, entry]) => ({
    label,
    value: Math.round(entry.value),
    change: percentChange(entry.value, before.get(label) ?? 0),
    hint: `${entry.count} ${entry.count === 1 ? "invoice" : "invoices"}`,
  }))
}

// ─── Cash movements ──────────────────────────────────────────────────────────

/** Net cash moved per week (inbound minus outbound payments) over the last `weeks` weeks. */
export function weeklyCashMovements(
  payments: readonly AccountPaymentQueryRow[],
  now: Date,
  weeks = 12,
): { values: ChartDatum[]; anomalies: string[] } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1
  const start = end + 1 - weeks * 7 * DAY_MS
  const nets = new Array<number>(weeks).fill(0)
  for (const payment of payments) {
    if (variantTag(payment.state) !== "Paid") continue
    const ms = timestampMs(payment.date) ?? timestampMs(payment.createdAt)
    if (ms == null || ms < start || ms > end) continue
    const index = Math.min(weeks - 1, Math.floor((ms - start) / (7 * DAY_MS)))
    const amount = Number(payment.amount ?? 0)
    if (!Number.isFinite(amount)) continue
    const direction = variantTag(payment.paymentType).toLowerCase()
    if (direction !== "inbound" && direction !== "outbound") continue
    nets[index]! += direction === "outbound" ? -amount : amount
  }
  const label = (index: number) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(start + index * 7 * DAY_MS))
  const values = nets.map((net, index) => ({ week: label(index), net: Math.round(net) }))
  const hasMovement = nets.some((net) => net !== 0)
  const anomalies = hasMovement ? detectAnomalies(nets).map((index) => values[index]!.week) : []
  return { values, anomalies }
}

// ─── Recent invoices ─────────────────────────────────────────────────────────

export type InvoiceTab = "all" | "overdue" | "draft" | "paid"

/** Which dashboard tabs an invoice belongs to. */
export function invoiceTabs(move: AccountMoveQueryRow, nowMs: number): InvoiceTab[] {
  const tabs: InvoiceTab[] = ["all"]
  const state = variantTag(move.state)
  if (state === "Draft") tabs.push("draft")
  if (variantTag(move.paymentState) === "Paid") tabs.push("paid")
  const dueMs = timestampMs(move.invoiceDateDue)
  if (state === "Posted" && amountResidual(move) > 0 && dueMs != null && dueMs < nowMs) tabs.push("overdue")
  return tabs
}

export interface RecentInvoiceRow extends TabbedTableRow {
  number: string
  customer: string
  date: string
  due: string
  amount: number
  currency: string
  status: string
  statusVariant: string
}

/** The latest invoices for the dashboard table, newest first. */
export function recentInvoiceRows(
  invoices: readonly AccountMoveQueryRow[],
  partnerLabels: ReadonlyMap<string, string>,
  currencyCodeById: ReadonlyMap<string, string>,
  t: Translate,
  nowMs: number,
  limit = 50,
): RecentInvoiceRow[] {
  const day = (ms: number | null) =>
    ms == null ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(ms))
  return [...invoices]
    .filter((move) => variantTag(move.state) !== "Cancelled" && variantTag(move.state) !== "Cancel")
    .sort((a, b) => (moveDateMs(b) ?? 0) - (moveDateMs(a) ?? 0))
    .slice(0, limit)
    .map((move) => {
      const status = invoiceStatus(move, t, nowMs)
      return {
        id: String(move.id),
        tabIds: invoiceTabs(move, nowMs),
        number: move.name?.trim() || `#${String(move.id)}`,
        customer: customerName(move, partnerLabels),
        date: day(moveDateMs(move)),
        due: day(timestampMs(move.invoiceDateDue)),
        amount: amountTotal(move),
        currency: (move.currencyId != null ? currencyCodeById.get(String(move.currencyId)) : undefined) ?? "",
        status: status.badge.label,
        statusVariant: status.badge.variant,
      }
    })
}

/** The currency most of the company's documents are kept in, for chart labels. */
export function dominantCurrencyCode(
  moves: readonly AccountMoveQueryRow[],
  currencyCodeById: ReadonlyMap<string, string>,
  fallback = "USD",
): string {
  const counts = new Map<string, number>()
  for (const move of moves) {
    const id = move.currencyId
    const code = id != null ? currencyCodeById.get(String(id)) : undefined
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  let best = fallback
  let bestCount = 0
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code
      bestCount = count
    }
  }
  return best
}

/** Aggregates need one known denomination; formatted bare numbers do not make mixed currencies additive. */
export function singleCurrencyId(rows: readonly { currencyId?: unknown }[]): string | null {
  const ids = new Set(rows.map((row) => row.currencyId == null ? "" : String(row.currencyId)))
  return ids.size === 1 && !ids.has("") ? [...ids][0]! : null
}
