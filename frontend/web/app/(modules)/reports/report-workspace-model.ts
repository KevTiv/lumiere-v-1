import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"

/** Fields consumed by the report workspace; absent projections stay unknown. */
export type ReportRow = {
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
  dateFrom?: unknown
  date_from?: unknown
  dateTo?: unknown
  date_to?: unknown
  targetMove?: unknown
  comparisonMode?: unknown
}

export function reportTag(value: unknown): string {
  if (value && typeof value === "object") {
    value = "tag" in value ? value.tag : Object.keys(value)[0]
  }
  return String(value ?? "").replaceAll(/[_-]/g, "").toLowerCase()
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

export function reportWorkspaceHref(query: string, id?: string): string {
  const params = new URLSearchParams(query)
  params.set("tab", "reports")
  params.delete("report")
  if (id) params.set("report", id)
  return `/reports?${params.toString()}`
}

export function reportDate(raw: unknown, locale: string): string {
  const micros = stbTimestampMicros(raw)
  if (micros == null) return "—"
  const date = new Date(Number(micros / 1000n))
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }) : "—"
}

export function reportCanDownload(row: ReportRow): boolean {
  return ["generated", "exported"].includes(reportTag(row.state))
}
