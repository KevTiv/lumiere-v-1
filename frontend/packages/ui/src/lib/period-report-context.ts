import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stbTimestampToExactIso } from "@lumiere/erp-shared/stb-timestamp"
import { stbEnumTag } from "./accounting-move-utils"
import { mergeModuleStates, type ModuleDataState } from "./module-data-state"

export interface PeriodReportContext {
  organizationId: string
  companyId: string
  periodId: string
  dateFrom: string
  dateTo: string
  reportType: "trial-balance" | "vat-report"
}

export interface PeriodReportRow {
  id?: unknown
  organizationId?: unknown; organization_id?: unknown
  companyId?: unknown; company_id?: unknown
  dateFrom?: unknown; date_from?: unknown
  dateTo?: unknown; date_to?: unknown
  reportType?: unknown; report_type?: unknown
}

function positiveId(value: unknown): string | null {
  const id = parseStrictU64(value)
  return id != null && id > 0n ? String(id) : null
}

function isoDate(value: unknown): string | null {
  return stbTimestampToExactIso(value)
}

export function periodReportHref(context: PeriodReportContext): string {
  const params = new URLSearchParams({
    tab: context.reportType === "vat-report" ? "vat-report" : "reports",
    source: "period-close",
    organizationId: context.organizationId,
    companyId: context.companyId,
    periodId: context.periodId,
    dateFrom: context.dateFrom,
    dateTo: context.dateTo,
    reportType: context.reportType,
  })
  return `/reports?${params}`
}

/** Untrusted navigation context is applied only after canonical period and active-scope checks. */
export function readPeriodReportContext(params: { get: (key: string) => string | null }): PeriodReportContext | null {
  if (params.get("source") !== "period-close") return null
  const organizationId = positiveId(params.get("organizationId"))
  const companyId = positiveId(params.get("companyId"))
  const periodId = positiveId(params.get("periodId"))
  const dateFrom = isoDate(params.get("dateFrom"))
  const dateTo = isoDate(params.get("dateTo"))
  const reportType = params.get("reportType")
  if (!organizationId || !companyId || !periodId || !dateFrom || !dateTo || dateFrom > dateTo || !["trial-balance", "vat-report"].includes(reportType ?? "")) return null
  return { organizationId, companyId, periodId, dateFrom, dateTo, reportType: reportType as PeriodReportContext["reportType"] }
}

export function periodReportContextState(context: PeriodReportContext | null, args: {
  organizationId: bigint | number | string
  companyId?: bigint | number | string
  periods: readonly PeriodReportRow[]
  periodState: ModuleDataState
  reportState: ModuleDataState
}): ModuleDataState {
  const invalid: ModuleDataState = { status: "error", message: "The report period context does not match the active organization, company or accounting period. Return to period close and select the period again." }
  if (!context || positiveId(args.organizationId) !== context.organizationId || positiveId(args.companyId) !== context.companyId) return invalid
  const sources = mergeModuleStates([args.periodState, args.reportState])
  if (sources.status !== "ready") return sources
  const periods = args.periods.filter((period) => positiveId(period.id) === context.periodId && positiveId(period.organizationId ?? period.organization_id) === context.organizationId && positiveId(period.companyId ?? period.company_id) === context.companyId)
  if (periods.length !== 1 || isoDate(periods[0]!.dateFrom ?? periods[0]!.date_from) !== context.dateFrom || isoDate(periods[0]!.dateTo ?? periods[0]!.date_to) !== context.dateTo) return invalid
  return { status: "ready" }
}

export function reportMatchesPeriodContext(row: PeriodReportRow, context: PeriodReportContext): boolean {
  const type = stbEnumTag(row.reportType ?? row.report_type).replaceAll("_", "").toLowerCase()
  return positiveId(row.organizationId ?? row.organization_id) === context.organizationId &&
    positiveId(row.companyId ?? row.company_id) === context.companyId &&
    isoDate(row.dateFrom ?? row.date_from) === context.dateFrom &&
    isoDate(row.dateTo ?? row.date_to) === context.dateTo &&
    (context.reportType === "trial-balance" ? type === "trialbalance" : type === "vatreturn" || type === "euvatreturn")
}

/** Keep source dates exact even when the date input only displays the calendar day. */
export function periodReportFormDefaults(context: PeriodReportContext) {
  return { dateFrom: context.dateFrom.slice(0, 10), dateTo: context.dateTo.slice(0, 10), reportType: "trialBalance", targetMove: "posted", name: `Trial balance ${context.dateFrom.slice(0, 10)} – ${context.dateTo.slice(0, 10)}` }
}

export function applyPeriodReportFormContext<T extends object>(formData: T, context: PeriodReportContext) {
  return { ...formData, dateFrom: context.dateFrom, dateTo: context.dateTo, reportType: "trialBalance", targetMove: "posted" }
}
