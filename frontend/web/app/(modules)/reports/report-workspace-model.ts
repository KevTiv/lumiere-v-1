import {
  entityEnumTag,
  entityScalarText,
  formatEntityReference,
} from "@lumiere/ui/lib/entity-row-values"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"

export type ReportContextProjection = {
  dateFrom?: unknown
  date_from?: unknown
  dateTo?: unknown
  date_to?: unknown
  targetMove?: unknown
  target_move?: unknown
}

/** Fields consumed by the report workspace; absent projections stay unknown. */
export type ReportRow = ReportContextProjection & {
  id?: unknown
  name?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  state?: unknown
  reportType?: unknown
  createDate?: unknown
  currencyId?: unknown
  resultCurrencyId?: unknown
  comparisonMode?: unknown
}

export function reportTag(value: unknown): string {
  return (entityEnumTag(value) ?? "").replaceAll(/[_-]/g, "").toLowerCase()
}

export function scopedReports<Row extends ReportRow>(rows: readonly Row[], organizationId: bigint, companyId: bigint | undefined): Row[] {
  if (!companyId) return []
  return rows.filter((row) => parseStrictU64(row.organizationId ?? row.organization_id) === organizationId && parseStrictU64(row.companyId ?? row.company_id) === companyId)
}

export function selectedReport<Row extends ReportRow>(rows: readonly Row[], id: string | null): Row | null {
  const exact = parseStrictU64(id)
  if (!exact || exact <= 0n) return null
  const matches = rows.filter((row) => parseStrictU64(row.id) === exact)
  return matches.length === 1 ? matches[0]! : null
}

export { reportWorkspaceHref } from "@lumiere/erp-shared/record-links"

export function reportAccountingBasis(report: ReportContextProjection): "posted" | "all" | null {
  const basis = entityEnumTag(report.targetMove ?? report.target_move)?.toLowerCase()
  return basis === "posted" || basis === "all" ? basis : null
}

export function reportBasisKey(report: ReportContextProjection) {
  switch (reportAccountingBasis(report)) {
    case "posted": return "reports.workspace.posted"
    case "all": return "reports.workspace.allEntries"
    default: return "reports.workspace.unknown"
  }
}

export function reportPeriodBounds(report: ReportContextProjection) {
  return {
    from: stbTimestampMicros(report.dateFrom ?? report.date_from),
    to: stbTimestampMicros(report.dateTo ?? report.date_to),
  }
}

function formatReportDate(micros: bigint | null, locale: string): string | null {
  if (micros == null) return null
  const date = new Date(Number(micros / 1000n))
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(locale, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" })
    : null
}

export function reportPeriod(report: ReportContextProjection, locale: string): string | null {
  const { from, to } = reportPeriodBounds(report)
  if (from !== null && to !== null && from > to) return null
  const start = formatReportDate(from, locale)
  const end = formatReportDate(to, locale)
  return start || end ? `${start ?? "—"} – ${end ?? "—"}` : null
}

export function reportCanDownload(row: ReportRow): boolean {
  return ["generated", "exported"].includes(reportTag(row.state))
}

/** A readable name or exact record identifier; malformed values remain unavailable. */
export function reportDisplayName(row: ReportRow, missing: string): string {
  return formatEntityReference(row.id, {
    label: entityScalarText(row.name),
    missing,
  })
}
