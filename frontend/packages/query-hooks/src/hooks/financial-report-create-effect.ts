import type { CreateFinancialReportParams } from "@lumiere/stdb/types"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"
import { AmbiguousOperationEffectError } from "./operation-effect"

/** Only these canonical report fields participate in creation readback. */
interface Row {
  id?: unknown
  name?: unknown
  metadata?: unknown
  state?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  reportType?: unknown
  report_type?: unknown
  dateFrom?: unknown
  date_from?: unknown
  dateTo?: unknown
  date_to?: unknown
  currencyId?: unknown
  currency_id?: unknown
  resultCurrencyId?: unknown
  result_currency_id?: unknown
  targetMove?: unknown
  target_move?: unknown
  comparisonMode?: unknown
  comparison_mode?: unknown
  hierarchyLevel?: unknown
  hierarchy_level?: unknown
  showZeroLines?: unknown
  show_zero_lines?: unknown
  showHierarchy?: unknown
  show_hierarchy?: unknown
  showPercentage?: unknown
  show_percentage?: unknown
  showDebitCredit?: unknown
  show_debit_credit?: unknown
  filterAnalyticAccountIds?: unknown
  filter_analytic_account_ids?: unknown
  filterAccountIds?: unknown
  filter_account_ids?: unknown
  filterPartnerIds?: unknown
  filter_partner_ids?: unknown
  filterJournalIds?: unknown
  filter_journal_ids?: unknown
}
const value = (row: Row, camel: keyof Row, snake: keyof Row) => row[camel] ?? row[snake]
const optional = (raw: unknown) => raw != null && typeof raw === "object" && "some" in raw ? (raw as { some: unknown }).some : raw
function tag(raw: unknown): string {
  if (raw != null && typeof raw === "object") {
    if ("tag" in raw && typeof raw.tag === "string") return raw.tag.replaceAll("_", "").toLowerCase()
    const keys = Object.keys(raw)
    if (keys.length === 1) return keys[0]!.replaceAll("_", "").toLowerCase()
  }
  return String(raw ?? "").replaceAll("_", "").toLowerCase()
}

export function financialReportInputKey(params: CreateFinancialReportParams): string {
  return JSON.stringify({ ...params, metadata: undefined }, (_key, raw) => typeof raw === "bigint" ? raw.toString() : raw)
}

export function resolveFinancialReportCreation(before: readonly Row[], after: readonly Row[], scope: { organizationId: bigint; companyId: bigint }, params: CreateFinancialReportParams, requestId: string): Row | null {
  const known = new Set(before.map((row) => parseStrictU64(row.id)?.toString()))
  const expected = params
  const matches = after.filter((row) => {
    const id = parseStrictU64(row.id)
    if (id == null || id <= 0n || known.has(id.toString()) || parseStrictU64(value(row, "organizationId", "organization_id")) !== scope.organizationId || parseStrictU64(value(row, "companyId", "company_id")) !== scope.companyId) return false
    let metadata: unknown
    try { metadata = JSON.parse(String(optional(row.metadata) ?? "")) } catch { return false }
    if (metadata == null || typeof metadata !== "object" || !("lumiere_report_request" in metadata) || metadata.lumiere_report_request !== requestId || !("input_fingerprint" in metadata) || metadata.input_fingerprint !== financialReportInputKey(params)) return false
    if (String(row.name ?? "").trim() !== params.name.trim() || tag(value(row, "reportType", "report_type")) !== tag(params.reportType) || stbTimestampMicros(value(row, "dateFrom", "date_from")) !== stbTimestampMicros(params.dateFrom) || stbTimestampMicros(value(row, "dateTo", "date_to")) !== stbTimestampMicros(params.dateTo)) return false
    for (const [camel, snake] of [["currencyId", "currency_id"], ["resultCurrencyId", "result_currency_id"]] as const) if (parseStrictU64(value(row, camel!, snake!)) !== parseStrictU64(expected[camel!])) return false
    for (const [camel, snake] of [["targetMove", "target_move"], ["comparisonMode", "comparison_mode"], ["hierarchyLevel", "hierarchy_level"], ["showZeroLines", "show_zero_lines"], ["showHierarchy", "show_hierarchy"], ["showPercentage", "show_percentage"], ["showDebitCredit", "show_debit_credit"]] as const) if (value(row, camel!, snake!) !== expected[camel!]) return false
    for (const [camel, snake] of [["filterAnalyticAccountIds", "filter_analytic_account_ids"], ["filterAccountIds", "filter_account_ids"], ["filterPartnerIds", "filter_partner_ids"], ["filterJournalIds", "filter_journal_ids"]] as const) {
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
