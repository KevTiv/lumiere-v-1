import { expenseVariantTag } from "../../../lib/expense-state"

export interface ExpenseWorkflowRow {
  id?: unknown
  name?: unknown
  code?: unknown
  externalRef?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  employeeId?: unknown
  currencyId?: unknown
  totalAmount?: unknown
  amount?: unknown
  state?: unknown
  status?: unknown
  paymentMode?: unknown
  merchantKey?: unknown
  residual?: unknown
}

/** Never turn a missing/foreign company relation into a selectable record. */
export function companyWorkflowRows<T extends ExpenseWorkflowRow>(rows: readonly T[], orgId: bigint, companyId: bigint): T[] {
  if (orgId <= 0n || companyId <= 0n) return []
  return rows.filter(row => String(row.organizationId ?? row.organization_id) === String(orgId)
    && String(row.companyId ?? row.company_id) === String(companyId))
}

export function workflowOptions(rows: readonly ExpenseWorkflowRow[]) {
  return rows.filter(row => row.id != null).map(row => ({
    value: String(row.id),
    label: [row.code, row.name ?? row.externalRef].filter(Boolean).map(String).join(" · ") || `#${String(row.id)}`,
  }))
}

/** An expense can only join a draft report for the same employee and currency. */
export function eligibleExpenseReports(rows: readonly ExpenseWorkflowRow[], expense: ExpenseWorkflowRow) {
  return rows.filter(row => expenseVariantTag(row.state) === "Draft"
    && expense.employeeId != null && String(row.employeeId) === String(expense.employeeId)
    && expense.currencyId != null && String(row.currencyId) === String(expense.currencyId))
}

/** Report totals remain separate by currency; unknown currency/amount cannot become a dollar total. */
export function reportCurrencyTotals(rows: readonly ExpenseWorkflowRow[], codes: ReadonlyMap<string, string>, locale: string | undefined, unavailable: string) {
  if (rows.length === 0) return "—"
  const totals = new Map<string, number>()
  for (const row of rows) {
    const code = codes.get(String(row.currencyId))
    if (!code || !/^[A-Za-z]{3}$/.test(code) || row.totalAmount == null || row.totalAmount === "" || !Number.isFinite(Number(row.totalAmount))) return unavailable
    totals.set(code, (totals.get(code) ?? 0) + Number(row.totalAmount))
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "code" }).format(amount),
  ).join(" · ")
}

/** Show candidates that satisfy the visible card-match contract; the reducer remains authoritative. */
export function cardMatchCandidates(rows: readonly ExpenseWorkflowRow[], line: ExpenseWorkflowRow) {
  return rows.filter(row => expenseVariantTag(row.paymentMode) === "CorporateCard"
    && row.currencyId != null && String(row.currencyId) === String(line.currencyId)
    && row.totalAmount != null && line.amount != null && Number.isFinite(Number(row.totalAmount)) && Number.isFinite(Number(line.amount))
    && Math.abs(Number(row.totalAmount) - Number(line.amount)) <= 0.05
    && (!line.merchantKey || !row.merchantKey || String(line.merchantKey) === String(row.merchantKey)))
}
