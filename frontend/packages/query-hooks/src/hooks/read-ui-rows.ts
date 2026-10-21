/**
 * Pure, tolerant row mappers for the pass-12 read-side screens
 * (statement lines, bank statement import lines, tax deadline reminders,
 * consolidation company rates).
 *
 * Rows arrive from `/api/query/<key>` as camelCase or snake_case JSON; every getter accepts
 * both. Absent / masked columns map to `null` (never a placeholder id) so the UI renders nothing.
 * Deliberately independent of the generated row types so it compiles against any contracts version.
 */

type RawRow = Record<string, unknown>

export type StatementKind = "profit-loss" | "balance-sheet" | "cash-flow"

export interface StatementLineRow {
  readonly id: string
  readonly reportId: string | null
  readonly sequence: number
  readonly name: string
  readonly accountId: string | null
  readonly lineType: string
  readonly parentId: string | null
  readonly level: number
  readonly isLeaf: boolean
  readonly amount: number
  readonly comparisonAmount: number
  readonly variance: number
  readonly variancePercentage: number
  readonly companyId: string | null
  readonly currencyId: string | null
}

export interface BankStatementImportLineRow {
  readonly id: string
  readonly importId: string | null
  readonly rowNumber: number
  /** Raw timestamp value; formatted by the table's date cell. */
  readonly date: unknown
  readonly amount: number | null
  readonly reference: string | null
  readonly description: string | null
  readonly validationError: string | null
  readonly createdStatementLineId: string | null
}

export interface TaxDeadlineReminderRow {
  readonly id: string
  readonly taxDeadlineId: string | null
  readonly reminderDate: unknown
  readonly daysBeforeDeadline: number | null
  readonly notificationType: string | null
  readonly status: string | null
  readonly sentAt: unknown
  readonly acknowledgedAt: unknown
}

export interface ConsolidationCompanyRateRow {
  readonly id: string
  readonly companyId: string | null
  readonly periodId: string | null
  readonly currencyId: string | null
  readonly exchangeRate: number | null
  readonly rateType: string | null
  readonly effectiveDate: unknown
}

function pick(row: RawRow, camel: string, snake: string): unknown {
  const v = row[camel]
  return v !== undefined ? v : row[snake]
}

/** Unwrap `{ some: x }` / `{ tag: 'x' }` shapes the JSON encoder may emit for options and enums. */
function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as RawRow
    if ("some" in o) return unwrap(o.some)
    if ("tag" in o) return o.tag
    if ("none" in o) return null
  }
  return value
}

export function idOrNull(value: unknown): string | null {
  const v = unwrap(value)
  if (typeof v === "bigint") return v.toString()
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null
  if (typeof v === "string") return /^\d+$/.test(v.trim()) ? v.trim() : null
  return null
}

export function numberOrNull(value: unknown): number | null {
  const v = unwrap(value)
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "bigint") return Number(v)
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function stringOrNull(value: unknown): string | null {
  const v = unwrap(value)
  if (typeof v === "string") return v.trim() === "" ? null : v
  return null
}

function boolOf(value: unknown, fallback: boolean): boolean {
  const v = unwrap(value)
  return typeof v === "boolean" ? v : fallback
}

/** Normalise an enum/tag value (string or `{tag}`) to a lower-case token with separators removed. */
export function tagToken(value: unknown): string {
  const v = unwrap(value)
  return typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9]/g, "") : ""
}

/** `ProfitAndLoss` / `BalanceSheet` / `CashFlow` -> statement kind; anything else -> null. */
export function statementKindForReportType(reportType: unknown): StatementKind | null {
  const token = tagToken(reportType)
  if (token === "profitandloss" || token === "profitloss" || token === "pnl") return "profit-loss"
  if (token === "balancesheet") return "balance-sheet"
  if (token === "cashflow") return "cash-flow"
  return null
}

export function toStatementLineRow(row: RawRow): StatementLineRow | null {
  const id = idOrNull(row.id)
  if (id == null) return null
  return {
    id,
    reportId: idOrNull(pick(row, "reportId", "report_id")),
    sequence: numberOrNull(row.sequence) ?? 0,
    name: stringOrNull(row.name) ?? "",
    accountId: idOrNull(pick(row, "accountId", "account_id")),
    lineType: tagToken(pick(row, "lineType", "line_type")),
    parentId: idOrNull(pick(row, "parentId", "parent_id")),
    level: numberOrNull(row.level) ?? 0,
    isLeaf: boolOf(pick(row, "isLeaf", "is_leaf"), true),
    amount: numberOrNull(row.amount) ?? 0,
    comparisonAmount: numberOrNull(pick(row, "comparisonAmount", "comparison_amount")) ?? 0,
    variance: numberOrNull(row.variance) ?? 0,
    variancePercentage: numberOrNull(pick(row, "variancePercentage", "variance_percentage")) ?? 0,
    companyId: idOrNull(pick(row, "companyId", "company_id")),
    currencyId: idOrNull(pick(row, "currencyId", "currency_id")),
  }
}

export function toBankStatementImportLineRow(row: RawRow): BankStatementImportLineRow | null {
  const id = idOrNull(row.id)
  if (id == null) return null
  return {
    id,
    importId: idOrNull(pick(row, "importId", "import_id")),
    rowNumber: numberOrNull(pick(row, "rowNumber", "row_number")) ?? 0,
    date: unwrap(row.date) ?? null,
    amount: numberOrNull(row.amount),
    reference: stringOrNull(row.reference),
    description: stringOrNull(row.description),
    validationError: stringOrNull(pick(row, "validationError", "validation_error")),
    createdStatementLineId: idOrNull(
      pick(row, "createdStatementLineId", "created_statement_line_id"),
    ),
  }
}

export function toTaxDeadlineReminderRow(row: RawRow): TaxDeadlineReminderRow | null {
  const id = idOrNull(row.id)
  if (id == null) return null
  // `user_id` is intentionally not mapped: reminders are shown per deadline, not per recipient.
  return {
    id,
    taxDeadlineId: idOrNull(pick(row, "taxDeadlineId", "tax_deadline_id")),
    reminderDate: unwrap(pick(row, "reminderDate", "reminder_date")) ?? null,
    daysBeforeDeadline: numberOrNull(pick(row, "daysBeforeDeadline", "days_before_deadline")),
    notificationType: stringOrNull(pick(row, "notificationType", "notification_type")),
    status: stringOrNull(row.status),
    sentAt: unwrap(pick(row, "sentAt", "sent_at")) ?? null,
    acknowledgedAt: unwrap(pick(row, "acknowledgedAt", "acknowledged_at")) ?? null,
  }
}

export function toConsolidationCompanyRateRow(row: RawRow): ConsolidationCompanyRateRow | null {
  const id = idOrNull(row.id)
  if (id == null) return null
  return {
    id,
    companyId: idOrNull(pick(row, "companyId", "company_id")),
    periodId: idOrNull(pick(row, "periodId", "period_id")),
    currencyId: idOrNull(pick(row, "currencyId", "currency_id")),
    exchangeRate: numberOrNull(pick(row, "exchangeRate", "exchange_rate")),
    rateType: stringOrNull(pick(row, "rateType", "rate_type")),
    effectiveDate: unwrap(pick(row, "effectiveDate", "effective_date")) ?? null,
  }
}

export function mapRows<T>(rows: readonly RawRow[], mapper: (row: RawRow) => T | null): T[] {
  const out: T[] = []
  for (const row of rows) {
    const mapped = mapper(row)
    if (mapped != null) out.push(mapped)
  }
  return out
}

/**
 * Import ids whose approved statement is `statementId` (bank statement import workspace rows).
 * A statement only shows import lines of imports that were approved into it.
 */
export function importIdsApprovedIntoStatement(
  imports: readonly RawRow[],
  statementId: string,
): Set<string> {
  const ids = new Set<string>()
  for (const imp of imports) {
    const approved = idOrNull(pick(imp, "approvedStatementId", "approved_statement_id"))
    const id = idOrNull(imp.id)
    if (approved != null && id != null && approved === statementId) ids.add(id)
  }
  return ids
}

export function remindersForDeadline(
  reminders: readonly TaxDeadlineReminderRow[],
  deadlineId: string,
): TaxDeadlineReminderRow[] {
  return reminders.filter((r) => r.taxDeadlineId === deadlineId)
}
