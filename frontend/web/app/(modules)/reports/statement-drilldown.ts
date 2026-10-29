import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"
import { variantTag } from "@lumiere/erp-workflows"

export interface StatementReportProjection {
  id?: unknown
  organizationId?: unknown; organization_id?: unknown
  companyId?: unknown; company_id?: unknown
  dateFrom?: unknown; date_from?: unknown
  dateTo?: unknown; date_to?: unknown
  targetMove?: unknown; target_move?: unknown
  filterAccountIds?: unknown; filter_account_ids?: unknown
  filterAnalyticAccountIds?: unknown; filter_analytic_account_ids?: unknown
  filterPartnerIds?: unknown; filter_partner_ids?: unknown
  filterJournalIds?: unknown; filter_journal_ids?: unknown
}

export interface StatementJournalProjection {
  organizationId?: unknown; organization_id?: unknown
  companyId?: unknown; company_id?: unknown
  accountId?: unknown; account_id?: unknown
  parentState?: unknown; parent_state?: unknown
  analyticAccountId?: unknown; analytic_account_id?: unknown
  partnerId?: unknown; partner_id?: unknown
  journalId?: unknown; journal_id?: unknown
  date?: unknown
}

export interface StatementDrilldownContext {
  reportId: string
  companyId: string
  accountId: string
  fromMicros: string
  toMicros: string
  basis: "posted" | "all"
  dimensionSignature: string
  returnHref: string
}

const positiveId = (value: unknown) => {
  const id = parseStrictU64(value)
  return id != null && id > 0n ? String(id) : null
}

/** Restrict return navigation to the Reports workspace; never follow arbitrary URLs. */
export function statementReturnHref(raw: string): string | null {
  if (!/^\/reports(?:\?|$)/.test(raw) || /[\\\r\n#]/.test(raw)) return null
  const url = new URL(raw, "https://lumiere.invalid")
  return url.origin === "https://lumiere.invalid" && url.pathname === "/reports" ? `${url.pathname}${url.search}` : null
}

function reportScope(report: StatementReportProjection) {
  const reportId = positiveId(report.id)
  const companyId = positiveId(report.companyId ?? report.company_id)
  const from = stbTimestampMicros(report.dateFrom ?? report.date_from)
  const to = stbTimestampMicros(report.dateTo ?? report.date_to)
  const basis = report.targetMove ?? report.target_move
  return reportId && companyId && from != null && to != null && from > 0n && to >= from
    && (basis === "posted" || basis === "all")
    ? { reportId, companyId, fromMicros: String(from), toMicros: String(to), basis } : null
}

/** The URL captures reviewed report scope; the Accounting consumer revalidates the saved report. */
export function statementJournalHref(account: string | null, report: StatementReportProjection, returnHref: string): string | null {
  const accountId = positiveId(account)
  const scope = reportScope(report)
  const back = statementReturnHref(returnHref)
  const dimensionSignature = reportDimensionSignature(report)
  if (!accountId || !scope || !back || !dimensionSignature) return null
  const params = new URLSearchParams({
    tab: "move-lines", companyId: scope.companyId, statementReport: scope.reportId,
    statementAccount: accountId, statementFrom: scope.fromMicros, statementTo: scope.toMicros,
    statementBasis: scope.basis, statementFilters: dimensionSignature, statementReturn: back,
  })
  return `/accounting?${params.toString()}`
}

export type StatementDrilldownRead = { status: "none" } | { status: "invalid" } | { status: "ready"; context: StatementDrilldownContext }

export function parseStatementDrilldown(params: Pick<URLSearchParams, "get" | "getAll" | "has">): StatementDrilldownRead {
  const keys = ["statementReport", "statementAccount", "statementFrom", "statementTo", "statementBasis", "statementFilters", "statementReturn"]
  if (!keys.some((key) => params.has(key))) return { status: "none" }
  if ([...keys, "companyId"].some((key) => params.getAll(key).length !== 1)) return { status: "invalid" }
  const reportId = positiveId(params.get("statementReport"))
  const companyId = positiveId(params.get("companyId"))
  const accountId = positiveId(params.get("statementAccount"))
  const from = params.get("statementFrom") ?? ""
  const to = params.get("statementTo") ?? ""
  const basis = params.get("statementBasis")
  const dimensionSignature = params.get("statementFilters") ?? ""
  const returnHref = statementReturnHref(params.get("statementReturn") ?? "")
  if (!reportId || !companyId || !accountId || !/^\d{1,18}$/.test(from) || !/^\d{1,18}$/.test(to)
    || BigInt(from) <= 0n || BigInt(to) < BigInt(from) || !returnHref || dimensionSignature.length > 16_000
    || !validDimensionSignature(dimensionSignature) || (basis !== "posted" && basis !== "all")) return { status: "invalid" }
  return { status: "ready", context: { reportId, companyId, accountId, fromMicros: from, toMicros: to, basis, dimensionSignature, returnHref } }
}

function ids(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const parsed = value.map(positiveId)
  return parsed.every((id): id is string => id != null) ? parsed : null
}

function reportDimensionSignature(report: StatementReportProjection): string | null {
  const values = [
    ids(report.filterAccountIds ?? report.filter_account_ids),
    ids(report.filterAnalyticAccountIds ?? report.filter_analytic_account_ids),
    ids(report.filterPartnerIds ?? report.filter_partner_ids),
    ids(report.filterJournalIds ?? report.filter_journal_ids),
  ]
  return values.every((value) => value != null) ? JSON.stringify(values.map((value) => [...new Set(value)].sort())) : null
}

function validDimensionSignature(raw: string): boolean {
  try {
    const values: unknown = JSON.parse(raw)
    return Array.isArray(values) && values.length === 4 && values.every((value) => ids(value) != null)
      && JSON.stringify(values.map((value) => [...new Set(ids(value)!)].sort())) === raw
  } catch { return false }
}

export type StatementDrilldownResult<T> = { status: "ready"; rows: T[] } | { status: "invalid" | "unavailable"; rows: T[] }

/** Current authorized rows, not the immutable snapshot used to generate the saved statement. */
export function filterStatementJournalItems<T extends StatementJournalProjection>(
  rows: readonly T[], reports: readonly StatementReportProjection[], context: StatementDrilldownContext,
  organizationId: bigint, companyId: bigint,
): StatementDrilldownResult<T> {
  if (String(companyId) !== context.companyId) return { status: "invalid", rows: [] }
  const matches = reports.filter((report) => positiveId(report.id) === context.reportId
    && positiveId(report.organizationId ?? report.organization_id) === String(organizationId)
    && positiveId(report.companyId ?? report.company_id) === String(companyId))
  if (matches.length !== 1) return { status: "unavailable", rows: [] }
  const report = matches[0]!
  const scope = reportScope(report)
  if (!scope || scope.fromMicros !== context.fromMicros || scope.toMicros !== context.toMicros || scope.basis !== context.basis)
    return { status: "invalid", rows: [] }
  const dimensionsSignature = reportDimensionSignature(report)
  if (!dimensionsSignature) return { status: "unavailable", rows: [] }
  if (dimensionsSignature !== context.dimensionSignature) return { status: "invalid", rows: [] }
  const dimensions = [
    [ids(report.filterAccountIds ?? report.filter_account_ids), "accountId", "account_id"],
    [ids(report.filterAnalyticAccountIds ?? report.filter_analytic_account_ids), "analyticAccountId", "analytic_account_id"],
    [ids(report.filterPartnerIds ?? report.filter_partner_ids), "partnerId", "partner_id"],
    [ids(report.filterJournalIds ?? report.filter_journal_ids), "journalId", "journal_id"],
  ] as const
  if (dimensions.some(([values]) => values == null)) return { status: "unavailable", rows: [] }
  const selected: T[] = []
  for (const row of rows) {
    const rowOrg = positiveId(row.organizationId ?? row.organization_id)
    const rowCompany = positiveId(row.companyId ?? row.company_id)
    if (!rowOrg || !rowCompany) return { status: "unavailable", rows: [] }
    if (rowOrg !== String(organizationId) || rowCompany !== context.companyId) continue
    const account = positiveId(row.accountId ?? row.account_id)
    const date = stbTimestampMicros(row.date)
    const state = variantTag(row.parentState ?? row.parent_state).toLowerCase()
    if (!account || date == null || !state) return { status: "unavailable", rows: [] }
    if (account !== context.accountId || date < BigInt(context.fromMicros) || date > BigInt(context.toMicros)
      || (context.basis === "posted" && state !== "posted")) continue
    let included = true
    for (const [values, camel, snake] of dimensions) {
      if (!values?.length) continue
      if (!(camel in row) && !(snake in row)) return { status: "unavailable", rows: [] }
      if (!values.includes(positiveId(row[camel] ?? row[snake]) ?? "")) included = false
    }
    if (included) selected.push(row)
  }
  return { status: "ready", rows: selected }
}
