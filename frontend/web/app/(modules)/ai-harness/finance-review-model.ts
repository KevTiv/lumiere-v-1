export const financeReviewSkills = [
  "finance_report_review",
  "bank_reconciliation_review",
  "period_close_review",
  "expense_evidence_review",
  "finance_variance_review",
] as const
export type FinanceReviewSkill = (typeof financeReviewSkills)[number]
export interface FinanceReviewFields {
  reportKey: string
  date: string
  baselineDate: string
  timezone: string
  recordId: string
  recordKind: string
  query: string
}

const financeReportKeys = [
  "cash_mobile_money_v1",
  "customer_balances_v1",
  "supplier_payables_v1",
] as const

type FinanceReportKey = (typeof financeReportKeys)[number]
export type FinanceReviewInput = { query?: string } & (
  | { reportKey: FinanceReportKey; date: string; timezone: string }
  | {
      reportKey: FinanceReportKey
      actualDate: string
      baselineDate: string
      timezone: string
    }
  | { statementId: number }
  | { periodId: number }
  | { recordId: number; recordKind: "expense" | "bill" }
)

export function financeReviewInput(
  skill: FinanceReviewSkill,
  fields: FinanceReviewFields,
): FinanceReviewInput | null {
  const query = fields.query.trim()
  if (query.length > 4000) return null
  const common = query ? { query } : {}
  if (
    skill === "finance_report_review" ||
    skill === "finance_variance_review"
  ) {
    const validDate = (value: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    const reportKey = financeReportKeys.find((key) => key === fields.reportKey)
    if (
      !reportKey ||
      !validDate(fields.date) ||
      !fields.timezone.trim()
    )
      return null
    try {
      new Intl.DateTimeFormat("en", { timeZone: fields.timezone }).format()
    } catch {
      return null
    }
    if (skill === "finance_report_review")
      return {
        ...common,
        reportKey,
        date: fields.date,
        timezone: fields.timezone,
      }
    if (!validDate(fields.baselineDate) || fields.date === fields.baselineDate)
      return null
    return {
      ...common,
      reportKey,
      actualDate: fields.date,
      baselineDate: fields.baselineDate,
      timezone: fields.timezone,
    }
  }
  const id = Number(fields.recordId)
  if (!/^[1-9]\d*$/.test(fields.recordId) || !Number.isSafeInteger(id))
    return null
  if (skill === "bank_reconciliation_review")
    return { ...common, statementId: id }
  if (skill === "period_close_review") return { ...common, periodId: id }
  if (fields.recordKind !== "expense" && fields.recordKind !== "bill") return null
  return { ...common, recordId: id, recordKind: fields.recordKind }
}
