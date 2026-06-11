/**
 * Maps Reports module form payloads to SpacetimeDB `create_financial_report` params.
 */

import type {
  CreateFinancialReportParams,
  ReportType,
} from '@lumiere/stdb/types'
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "./stb-timestamp"

function parseU64(v: unknown, fallback: bigint): bigint {
  if (typeof v === 'bigint' && v >= 0n) return v
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return BigInt(Math.trunc(v))
  const t = String(v ?? '').trim()
  if (t === '') return fallback
  try {
    const b = BigInt(t)
    return b >= 0n ? b : fallback
  } catch {
    return fallback
  }
}

/** Account hierarchy depth allowed by the backend (0–9). */
function parseHierarchyLevel(v: unknown, fallback = 2): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(9, Math.max(0, Math.trunc(n)))
}

function timestampFromDateField(v: unknown): Timestamp | null {
  if (v == null || String(v).trim() === '') return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return stbTimestampFromDate(d)
}

function toReportType(raw: unknown): ReportType {
  const s = String(raw ?? "trialBalance")
  switch (s) {
    case "balanceSheet":
      return { tag: "BalanceSheet" }
    case "profitAndLoss":
      return { tag: "ProfitAndLoss" }
    case "cashFlow":
      return { tag: "CashFlow" }
    case "trialBalance":
      return { tag: "TrialBalance" }
    case "generalLedger":
      return { tag: "GeneralLedger" }
    case "agedReceivable":
      return { tag: "AgedReceivable" }
    case "agedPayable":
      return { tag: "AgedPayable" }
    case "partnerBalance":
      return { tag: "PartnerBalance" }
    default:
      return { tag: "TrialBalance" }
  }
}

/**
 * @returns Params for `create_financial_report`, or `null` if required fields are invalid.
 */
export function toCreateFinancialReportParams(
  formData: Record<string, unknown>,
): CreateFinancialReportParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  const dateFrom = timestampFromDateField(formData.dateFrom)
  const dateTo = timestampFromDateField(formData.dateTo)
  if (!dateFrom || !dateTo) return null
  if (dateTo.microsSinceUnixEpoch <= dateFrom.microsSinceUnixEpoch) return null

  const targetMoveRaw = String(formData.targetMove ?? 'posted').toLowerCase()
  const targetMove = targetMoveRaw === 'all' ? 'all' : 'posted'

  const comparisonRaw = String(formData.comparisonMode ?? 'none')
  const comparisonMode = ['none', 'previous_period', 'previous_year'].includes(comparisonRaw)
    ? comparisonRaw
    : 'none'

  const currencyId = parseU64(formData.currencyId, 1n)
  const resultCurrencyId = parseU64(formData.resultCurrencyId, currencyId)
  const hierarchyLevel = parseHierarchyLevel(formData.hierarchyLevel, 2)

  return {
    name,
    reportType: toReportType(formData.reportType),
    dateFrom,
    dateTo,
    currencyId,
    targetMove,
    comparisonMode,
    filterAnalyticAccountIds: [],
    filterAccountIds: [],
    filterPartnerIds: [],
    filterJournalIds: [],
    hierarchyLevel,
    showZeroLines: Boolean(formData.showZeroLines),
    showHierarchy: Boolean(formData.showHierarchy),
    showPercentage: Boolean(formData.showPercentage),
    showDebitCredit: Boolean(formData.showDebitCredit ?? true),
    reportData: undefined,
    exportFormat: undefined,
    exportedFileUrl: undefined,
    resultCurrencyId,
    metadata: undefined,
  }
}

/** Normalize API row state (sum type or string) to a lowercase tag for filters and KPIs. */
export function reportStateTag(state: unknown): string {
  if (state == null) return ''
  if (typeof state === 'object' && !Array.isArray(state)) {
    const keys = Object.keys(state as object)
    if (keys.length === 1) return keys[0]!.toLowerCase()
  }
  return String(state).toLowerCase()
}
