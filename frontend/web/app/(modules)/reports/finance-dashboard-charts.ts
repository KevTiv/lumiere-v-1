/**
 * Pure data behind the Reports dashboard finance charts: a P&L trend and expense breakdown from
 * posted journal lines in company currency.
 */
import { variantTag } from "@lumiere/erp-workflows"
import type {
  AccountAccountQueryRow,
  AccountMoveLineQueryRow,
} from "@lumiere/stdb/resource-reads"
import type { RankedBarItem } from "@lumiere/ui"
import { monthBuckets, type ChartDatum } from "@lumiere/ui/lib/chart-format"
import { percentChange } from "@lumiere/ui/lib/dashboard-time-range"
import {
  timestampMs,
  type MsRange,
} from "../accounting/accounting-dashboard-charts"

type PlGroup = "income" | "expense" | "other"

/** The P&L side of a journal line: its own group snapshot, else the account's group. */
export function lineGroup(
  line: AccountMoveLineQueryRow,
  accountsById: ReadonlyMap<string, AccountAccountQueryRow>,
): PlGroup {
  const raw = line.accountInternalGroup ?? variantTag(accountsById.get(String(line.accountId ?? ""))?.internalGroup)
  const group = String(raw ?? "").toLowerCase()
  if (group === "income") return "income"
  if (group === "expense") return "expense"
  return "other"
}

function linePosted(line: AccountMoveLineQueryRow): boolean {
  return variantTag(line.parentState) === "Posted"
}

/** Debit minus credit; uses `balance` when present. */
function lineBalance(line: AccountMoveLineQueryRow): number {
  const balance = line.balance ?? Number(line.debit ?? 0) - Number(line.credit ?? 0)
  return Number.isFinite(balance) ? balance : 0
}

/** Income, expenses and net margin per month from posted journal lines. */
export function profitAndLossByMonth(
  lines: readonly AccountMoveLineQueryRow[],
  accountsById: ReadonlyMap<string, AccountAccountQueryRow>,
  now: Date,
  months = 12,
): ChartDatum[] {
  const buckets = monthBuckets(months, now)
  const totals = buckets.map(() => ({ revenue: 0, expenses: 0 }))
  for (const line of lines) {
    if (!linePosted(line)) continue
    const ms = timestampMs(line.date)
    if (ms == null) continue
    const index = buckets.findIndex((bucket) => ms >= bucket.startMs && ms <= bucket.endMs)
    if (index < 0) continue
    const group = lineGroup(line, accountsById)
    // Income accounts carry credit balances, expense accounts debit balances.
    if (group === "income") totals[index]!.revenue -= lineBalance(line)
    else if (group === "expense") totals[index]!.expenses += lineBalance(line)
  }
  return buckets.map((bucket, index) => {
    const revenue = Math.round(totals[index]!.revenue)
    const expenses = Math.round(totals[index]!.expenses)
    const margin = revenue !== 0 ? Math.round(((revenue - expenses) / revenue) * 1000) / 10 : 0
    return { month: bucket.label, revenue, expenses, margin }
  })
}

/** Spend per expense account in a period, with the change against the previous period. */
export function expenseBreakdown(
  lines: readonly AccountMoveLineQueryRow[],
  accountsById: ReadonlyMap<string, AccountAccountQueryRow>,
  current: MsRange,
  previous: MsRange,
): RankedBarItem[] {
  const now = new Map<string, number>()
  const before = new Map<string, number>()
  for (const line of lines) {
    if (!linePosted(line) || lineGroup(line, accountsById) !== "expense") continue
    const ms = timestampMs(line.date)
    if (ms == null) continue
    const account = accountsById.get(String(line.accountId ?? ""))
    const label = account ? [account.code, account.name].filter(Boolean).join(" ") : `Account #${String(line.accountId ?? "?")}`
    if (ms >= current.startMs && ms <= current.endMs) now.set(label, (now.get(label) ?? 0) + lineBalance(line))
    else if (ms >= previous.startMs && ms <= previous.endMs) before.set(label, (before.get(label) ?? 0) + lineBalance(line))
  }
  return [...now.entries()].map(([label, value]) => ({
    label,
    value: Math.round(value),
    change: percentChange(value, before.get(label) ?? 0),
  }))
}
