/**
 * Form → `UpdateFinancialReportParams` for `update_financial_report`.
 * Only draft reports accept updates on the server.
 */

import type { UpdateFinancialReportParams } from "@lumiere/stdb/generated/types"
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "./stb-timestamp"

function timestampFromDateField(v: unknown): Timestamp | null {
  if (v == null || String(v).trim() === "") return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return stbTimestampFromDate(d)
}

function parseHierarchyLevelU8(v: unknown): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const t = Math.trunc(n)
  if (t < 0 || t > 9) return null
  return t
}

/**
 * Maps edit-report form values to reducer params. Omits keys that are empty / unchanged intent
 * so optional fields stay omitted from JSON when not set.
 */
export function toUpdateFinancialReportParams(
  formData: Record<string, unknown>,
): UpdateFinancialReportParams {
  const out = {} as UpdateFinancialReportParams

  const nameRaw = String(formData.name ?? "").trim()
  if (nameRaw !== "") {
    out.name = nameRaw
  }

  const dateFrom = timestampFromDateField(formData.dateFrom)
  const dateTo = timestampFromDateField(formData.dateTo)
  if (dateFrom) out.dateFrom = dateFrom
  if (dateTo) out.dateTo = dateTo

  const tmRaw = String(formData.targetMove ?? "").toLowerCase()
  if (tmRaw === "posted" || tmRaw === "all") {
    out.targetMove = tmRaw
  }

  const comparisonRaw = String(formData.comparisonMode ?? "")
  if (["none", "previous_period", "previous_year"].includes(comparisonRaw)) {
    out.comparisonMode = comparisonRaw
  }

  const hl = parseHierarchyLevelU8(formData.hierarchyLevel)
  if (hl != null) {
    out.hierarchyLevel = hl
  }

  if (formData.showZeroLines !== undefined) {
    out.showZeroLines = Boolean(formData.showZeroLines)
  }
  if (formData.showHierarchy !== undefined) {
    out.showHierarchy = Boolean(formData.showHierarchy)
  }
  if (formData.showPercentage !== undefined) {
    out.showPercentage = Boolean(formData.showPercentage)
  }
  if (formData.showDebitCredit !== undefined) {
    out.showDebitCredit = Boolean(formData.showDebitCredit)
  }

  const meta = String(formData.metadata ?? "").trim()
  if (meta !== "") {
    out.metadata = meta
  }

  return out
}
