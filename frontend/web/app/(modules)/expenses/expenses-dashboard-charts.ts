/**
 * Pure data behind the Expenses dashboard charts: spend by category, monthly spend, and the
 * approval backlog, all from the expense and expense-report rows the module already loads.
 */
import { variantTag } from "@lumiere/erp-workflows"
import type { HrExpense, HrExpenseSheet } from "@lumiere/stdb/types"
import type { RankedBarItem, TabbedTableRow } from "@lumiere/ui"
import { monthBuckets, type ChartDatum } from "@lumiere/ui/lib/chart-format"
import { percentChange } from "@lumiere/ui/lib/dashboard-time-range"
import { timestampMs, type MsRange } from "../accounting/accounting-dashboard-charts"

const DAY_MS = 86_400_000

const LINE_KIND_LABELS: { [kind: string]: string } = {
  Standard: "Other expenses",
  Mileage: "Mileage",
  PerDiem: "Per diem",
}

/** Spend that counts: everything submitted onwards, never drafts or refused lines. */
export function countsAsSpend(expense: HrExpense): boolean {
  const state = variantTag(expense.state)
  return state !== "Draft" && state !== "Refused" && state !== ""
}

function expenseMs(expense: HrExpense): number | null {
  return timestampMs(expense.date) ?? timestampMs(expense.createdAt)
}

/** The category an expense is reported under: its expense product, else its line kind. */
export function expenseCategory(expense: HrExpense, productNames: ReadonlyMap<string, string>): string {
  const product = expense.productId != null ? productNames.get(String(expense.productId)) : undefined
  if (product) return product
  return LINE_KIND_LABELS[variantTag(expense.lineKind)] ?? "Other expenses"
}

/** Spend per category in the period, with the change against the previous period. */
export function spendByCategory(
  expenses: readonly HrExpense[],
  productNames: ReadonlyMap<string, string>,
  current: MsRange,
  previous: MsRange,
): RankedBarItem[] {
  const now = new Map<string, { value: number; count: number }>()
  const before = new Map<string, number>()
  for (const expense of expenses) {
    if (!countsAsSpend(expense)) continue
    const ms = expenseMs(expense)
    if (ms == null) continue
    const category = expenseCategory(expense, productNames)
    const amount = Number(expense.totalAmount ?? 0)
    if (!Number.isFinite(amount)) continue
    if (ms >= current.startMs && ms <= current.endMs) {
      const entry = now.get(category) ?? { value: 0, count: 0 }
      entry.value += amount
      entry.count += 1
      now.set(category, entry)
    } else if (ms >= previous.startMs && ms <= previous.endMs) {
      before.set(category, (before.get(category) ?? 0) + amount)
    }
  }
  return [...now.entries()].map(([label, entry]) => ({
    label,
    value: Math.round(entry.value),
    change: percentChange(entry.value, before.get(label) ?? 0),
    hint: `${entry.count} ${entry.count === 1 ? "expense" : "expenses"}`,
  }))
}

/** Monthly spend split by who paid (employee out of pocket vs corporate card), plus the line count. */
export function monthlySpend(expenses: readonly HrExpense[], now: Date, months = 6): ChartDatum[] {
  return monthBuckets(months, now).map((bucket) => {
    let outOfPocket = 0
    let corporateCard = 0
    let count = 0
    for (const expense of expenses) {
      if (!countsAsSpend(expense)) continue
      const ms = expenseMs(expense)
      if (ms == null || ms < bucket.startMs || ms > bucket.endMs) continue
      const amount = Number(expense.totalAmount ?? 0)
      if (!Number.isFinite(amount)) continue
      if (variantTag(expense.paymentMode) === "CorporateCard") corporateCard += amount
      else outOfPocket += amount
      count += 1
    }
    return {
      month: bucket.label,
      outOfPocket: Math.round(outOfPocket),
      corporateCard: Math.round(corporateCard),
      count,
    }
  })
}

export type BacklogTab = "all" | "awaiting-approval" | "awaiting-posting"

export interface BacklogRow extends TabbedTableRow {
  report: string
  employee: string
  submitted: string
  ageDays: number
  amount: number
  currency: string
  status: string
}

/** Expense reports still in flight (submitted or approved but not posted), oldest first. */
export function approvalBacklog(
  sheets: readonly HrExpenseSheet[],
  employeeNames: ReadonlyMap<string, string>,
  currencyCodeById: ReadonlyMap<string, string>,
  nowMs: number,
): BacklogRow[] {
  const day = (ms: number | null) =>
    ms == null ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(ms))
  return sheets
    .filter((sheet) => {
      const state = variantTag(sheet.state)
      return state === "Submitted" || state === "Approved"
    })
    .map((sheet) => ({ sheet, createdMs: timestampMs(sheet.createdAt) }))
    .sort((a, b) => (a.createdMs ?? 0) - (b.createdMs ?? 0))
    .map(({ sheet, createdMs }) => {
      const state = variantTag(sheet.state)
      const tab: BacklogTab = state === "Submitted" ? "awaiting-approval" : "awaiting-posting"
      return {
        id: String(sheet.id),
        tabIds: ["all", tab],
        report: sheet.name?.trim() || `Report #${String(sheet.id)}`,
        employee: employeeNames.get(String(sheet.employeeId)) ?? `Employee #${String(sheet.employeeId)}`,
        submitted: day(createdMs),
        ageDays: createdMs == null ? 0 : Math.max(0, Math.floor((nowMs - createdMs) / DAY_MS)),
        amount: Number(sheet.totalAmount ?? 0),
        currency: currencyCodeById.get(String(sheet.currencyId)) ?? "",
        status: state === "Submitted" ? "Awaiting approval" : "Awaiting posting",
      }
    })
}
