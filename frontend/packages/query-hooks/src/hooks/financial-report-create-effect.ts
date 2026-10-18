import type { CreateFinancialReportParams } from "@lumiere/stdb/types"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"
import { AmbiguousOperationEffectError } from "./operation-effect"

type Row = Record<string, unknown>
const value = (row: Row, camel: string, snake: string) => row[camel] ?? row[snake]
const optional = (raw: unknown) => raw != null && typeof raw === "object" && "some" in raw ? (raw as { some: unknown }).some : raw
function tag(raw: unknown): string {
  if (raw != null && typeof raw === "object") {
    const record = raw as Row
    if (typeof record.tag === "string") return record.tag.replaceAll("_", "").toLowerCase()
    const keys = Object.keys(record)
    if (keys.length === 1) return keys[0]!.replaceAll("_", "").toLowerCase()
  }
  return String(raw ?? "").replaceAll("_", "").toLowerCase()
}

export function financialReportInputKey(params: CreateFinancialReportParams): string {
  return JSON.stringify({ ...params, metadata: undefined }, (_key, raw) => typeof raw === "bigint" ? raw.toString() : raw)
}

export function resolveFinancialReportCreation(before: readonly Row[], after: readonly Row[], scope: { organizationId: bigint; companyId: bigint }, params: CreateFinancialReportParams, requestId: string): Row | null {
  const known = new Set(before.map((row) => parseStrictU64(row.id)?.toString()))
  const expected = params as unknown as Row
  const matches = after.filter((row) => {
    const id = parseStrictU64(row.id)
    if (id == null || id <= 0n || known.has(id.toString()) || parseStrictU64(value(row, "organizationId", "organization_id")) !== scope.organizationId || parseStrictU64(value(row, "companyId", "company_id")) !== scope.companyId) return false
    let metadata: unknown
    try { metadata = JSON.parse(String(optional(row.metadata) ?? "")) } catch { return false }
    if (metadata == null || typeof metadata !== "object" || (metadata as Row).lumiere_report_request !== requestId || (metadata as Row).input_fingerprint !== financialReportInputKey(params)) return false
    if (String(row.name ?? "").trim() !== params.name.trim() || tag(value(row, "reportType", "report_type")) !== tag(params.reportType) || stbTimestampMicros(value(row, "dateFrom", "date_from")) !== stbTimestampMicros(params.dateFrom) || stbTimestampMicros(value(row, "dateTo", "date_to")) !== stbTimestampMicros(params.dateTo)) return false
    for (const [camel, snake] of [["currencyId", "currency_id"], ["resultCurrencyId", "result_currency_id"]]) if (parseStrictU64(value(row, camel!, snake!)) !== parseStrictU64(expected[camel!])) return false
    for (const [camel, snake] of [["targetMove", "target_move"], ["comparisonMode", "comparison_mode"], ["hierarchyLevel", "hierarchy_level"], ["showZeroLines", "show_zero_lines"], ["showHierarchy", "show_hierarchy"], ["showPercentage", "show_percentage"], ["showDebitCredit", "show_debit_credit"]]) if (value(row, camel!, snake!) !== expected[camel!]) return false
    for (const [camel, snake] of [["filterAnalyticAccountIds", "filter_analytic_account_ids"], ["filterAccountIds", "filter_account_ids"], ["filterPartnerIds", "filter_partner_ids"], ["filterJournalIds", "filter_journal_ids"]]) {
      const actual = value(row, camel!, snake!)
      const wanted = expected[camel!]
      if (!Array.isArray(actual) || !Array.isArray(wanted) || actual.length !== wanted.length || actual.some((entry, at) => parseStrictU64(entry) !== parseStrictU64(wanted[at]))) return false
    }
    return true
  })
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one created report for this request; found ${matches.length}`)
  return matches[0] ?? null
}

export const financialReportReady = (row: Row) => ["generated", "exported", "archived"].includes(tag(row.state))
