"use client"


import { decodeOperationDispatch } from "@lumiere/api-client"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
/**
 * Reports hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Reports module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { responseErrorMessage } from "@lumiere/api-client/response-error"
import type {
  AnalyticsMetric,
  Dashboard,
  DashboardWidget,
  FinancialReport,
  ReportTemplate,
  ScheduledReport,
  TrialBalance,
} from "@lumiere/stdb/types"
import { encodeTimestampMicros, stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { i18n } from "@lumiere/i18n"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import { downloadDocumentExport } from "./templates"
import { resolveReportRunEffect, scheduledReportRunCount } from "./report-run-effect"
import { toCreateFinancialReportParams, toCreateTrialBalanceEntryParams } from "@lumiere/erp-shared/reports-create-params"
import { toCreateReportTemplateParams } from "@lumiere/erp-shared/reports-template-params"
import { toCreateScheduledReportParams } from "@lumiere/erp-shared/reports-scheduled-params"
import { toCreateSavedReportParams } from "@lumiere/erp-shared/reports-saved-params"
import { toCreateAnalyticsMetricParams } from "@lumiere/erp-shared/reports-analytics-params"
import { toUpdateFinancialReportParams } from "@lumiere/erp-shared/reports-update-params"
import {
  companyIdFromDashboardForm,
  companyIdFromDashboardWidgetForm,
  toCreateDashboardParams,
  toCreateDashboardWidgetParams,
} from "@lumiere/erp-shared/reports-dashboard-params"
import {
  AmbiguousOperationEffectError,
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  type CanonicalRecordRef,
  type ResolvedOperationEffectOutcome,
} from "./operation-effect"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useFinancialReports(
  organizationId: bigint,
  initialData?: FinancialReport[],
) {
  return useQuery<FinancialReport[]>({
    queryKey: ['financial-reports', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/financial-reports', 'Failed to fetch financial reports'),
    staleTime: 30_000,
    initialData,
  })
}

export function useTrialBalances(
  organizationId: bigint,
  initialData?: TrialBalance[],
) {
  return useQuery<TrialBalance[]>({
    queryKey: ['trial-balances', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/trial-balances', 'Failed to fetch trial balances'),
    staleTime: 30_000,
    initialData,
  })
}

export function useReportTemplates(
  organizationId: bigint,
  initialData?: ReportTemplate[],
) {
  return useQuery<ReportTemplate[]>({
    queryKey: ['report-templates', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/report-templates', 'Failed to fetch report templates'),
    staleTime: 30_000,
    initialData,
  })
}

export function useScheduledReports(
  organizationId: bigint,
  initialData?: ScheduledReport[],
) {
  return useQuery<ScheduledReport[]>({
    queryKey: ['scheduled-reports', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/scheduled-reports', 'Failed to fetch scheduled reports'),
    staleTime: 30_000,
    initialData,
  })
}

export function useAnalyticsMetrics(
  organizationId: bigint,
  initialData?: AnalyticsMetric[],
) {
  return useQuery<AnalyticsMetric[]>({
    queryKey: ['analytics-metrics', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/analytics-metrics', 'Failed to fetch analytics metrics'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSavedReports(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['saved-reports', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/saved-reports', 'Failed to fetch saved reports'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDashboards(organizationId: bigint, initialData?: Dashboard[]) {
  return useQuery<Dashboard[]>({
    queryKey: ['dashboards', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/dashboards', 'Failed to fetch dashboards'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDashboardWidgets(organizationId: bigint, initialData?: DashboardWidget[]) {
  return useQuery<DashboardWidget[]>({
    queryKey: ['dashboard-widgets', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/dashboard-widgets', 'Failed to fetch dashboard widgets'),
    staleTime: 30_000,
    initialData,
  })
}

function invalidateReportsModule(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const k = rqBigIntKey(organizationId)
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['financial-reports', k] }),
    qc.invalidateQueries({ queryKey: ['trial-balances', k] }),
    qc.invalidateQueries({ queryKey: ['report-templates', k] }),
    qc.invalidateQueries({ queryKey: ['scheduled-reports', k] }),
    qc.invalidateQueries({ queryKey: ['analytics-metrics', k] }),
    qc.invalidateQueries({ queryKey: ['saved-reports', k] }),
    qc.invalidateQueries({ queryKey: ['dashboards', k] }),
    qc.invalidateQueries({ queryKey: ['dashboard-widgets', k] }),
  ])
}

function requireOperatingCompany(companyId: bigint | undefined): bigint {
  if (companyId == null || companyId <= 0n) {
    throw new Error("Operating company is required for this report action")
  }
  return companyId
}

// ── Mutations — financial reports lifecycle ───────────────────────────────────

/**
 * Creates a draft `FinancialReport`, resolves its id from SQL, then calls
 * `generate_financial_report` to build trial balance lines.
 */
export function useCreateFinancialReportFlow(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = toCreateFinancialReportParams(formData)
      if (!params) throw new Error('Invalid report parameters')

      const name = params.name.trim()
      const listBefore = await fetchQueryList(
        '/api/query/financial-reports',
        'Failed to load financial reports',
      )
      const maxIdBefore = listBefore.reduce(
        (m, row) => Math.max(m, Number(row.id) || 0),
        0,
      )

      const createCall = stdbBffCommandPost("create_financial_report", {
        companyId: requireOperatingCompany(companyId),
        params: stdbParamsToJson(params),
      })
      const createRes = await apiFetch(createCall.urlPath, createCall.init)
      if (!createRes.ok) throw new Error('Failed to create financial report')

      const listAfter = await fetchQueryList(
        '/api/query/financial-reports',
        'Failed to load financial reports',
      )
      const created = listAfter.find(
        (row) =>
          Number(row.id) > maxIdBefore && String(row.name ?? '').trim() === name,
      )
      if (created?.id == null) {
        throw new Error(
          'Report was created but could not be resolved; refresh and generate manually if needed.',
        )
      }

      const genCall = stdbBffCommandPost("generate_financial_report", {
        companyId: requireOperatingCompany(companyId),
        reportId: Number(created.id),
      })
      const genRes = await apiFetch(genCall.urlPath, genCall.init)
      if (!genRes.ok) throw new Error('Failed to generate financial report')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useGenerateFinancialReport(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string | number | bigint>({
    mutationFn: async (reportId) => {
      const { urlPath, init } = stdbBffCommandPost("generate_financial_report", {
        companyId: requireOperatingCompany(companyId),
        reportId,
      })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to regenerate report')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useExportFinancialReport(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { reportId: string | number | bigint; exportFormat: 'pdf' | 'xlsx' | 'csv' }
  >({
    mutationFn: async ({ reportId, exportFormat }) => {
      const { urlPath, init } = stdbBffCommandPost("export_financial_report", {
        companyId: requireOperatingCompany(companyId),
        reportId,
        params: stdbParamsToJson({ exportFormat }),
      })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to export report')
      await downloadDocumentExport(
        exportFormat,
        "financial-report",
        Number(reportId),
        `financial_report_${reportId}.${exportFormat === "pdf" ? "pdf" : exportFormat}`,
      )
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export interface FinancialReportArchiveProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
}

function financialReportState(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) {
      return String((value as { tag?: unknown }).tag ?? "").toLowerCase()
    }
    const keys = Object.keys(value)
    if (keys.length === 1) return keys[0]!.toLowerCase()
  }
  return ""
}

/** COV-08e: resolve only the same scoped report after Exported → Archived. */
export function resolveArchivedFinancialReportEffect(
  rows: readonly FinancialReportArchiveProjection[],
  organizationId: bigint,
  companyId: bigint,
  reportId: bigint,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === reportId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one financial report, found ${matches.length}`,
    )
  }

  const row = matches[0]
  if (
    !row ||
    parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId ||
    parseStrictU64(row.companyId ?? row.company_id) !== companyId ||
    financialReportState(row.state) !== "archived"
  ) {
    return null
  }

  return { resource: "financial-reports", id: reportId.toString() }
}

export function useArchiveFinancialReport(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    ResolvedOperationEffectOutcome<CanonicalRecordRef>,
    Error,
    string | number | bigint
  >({
    mutationFn: async (reportIdInput) => {
      const activeCompanyId = requireOperatingCompany(companyId)
      const reportId = parseStrictU64(reportIdInput)
      if (reportId == null) throw new Error("Invalid financial report id")

      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveArchivedFinancialReportEffect(
            await fetchQueryList(
              "/api/query/financial-reports",
              "Failed to read financial report",
            ),
            organizationId,
            activeCompanyId,
            reportId,
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost(
            "archive_financial_report",
            {
              companyId: activeCompanyId,
              reportId,
            },
          )
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to archive financial report",
          )
        },
        afterDispatch: async () => {
          await invalidateReportsModule(qc, organizationId)
        },
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })

      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function useDeleteFinancialReport(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string | number | bigint>({
    mutationFn: async (reportId) => {
      const { urlPath, init } = stdbBffCommandPost("delete_financial_report", {
        companyId: requireOperatingCompany(companyId),
        reportId,
      })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete report')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useGenerateEuVatReport(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const name = String(formData.name ?? "").trim()
      const dateFromRaw = formData.dateFrom ?? formData.date_from
      const dateToRaw = formData.dateTo ?? formData.date_to
      const currencyId = Number(formData.currencyId ?? formData.currency_id)
      const locale = String(formData.locale ?? "EU").trim() || "EU"
      if (!name || dateFromRaw == null || dateToRaw == null || !Number.isSafeInteger(currencyId) || currencyId <= 0) {
        throw new Error("Name, date range, and currency are required")
      }
      const dateFrom = stbTimestampFromDate(new Date(String(dateFromRaw)))
      const dateTo = stbTimestampFromDate(new Date(String(dateToRaw)))
      const { urlPath, init } = stdbBffCommandPost("generate_eu_vat_report", {
        companyId: requireOperatingCompany(companyId),
        params: stdbParamsToJson({
          name,
          dateFrom,
          dateTo,
          currencyId,
          locale,
        }),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorReports(r))
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useCreateSavedReport(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = toCreateSavedReportParams(formData)
      if (!params) throw new Error("Invalid saved report params")
      const encodedParams = stdbParamsToJson(
        params as object,
        "CreateSavedReportParams",
      )
      const { urlPath, init } = stdbBffCommandPost("create_saved_report", {
        companyId: requireOperatingCompany(companyId),
        params: encodedParams,
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorReports(r))
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useUpdateSavedReport(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { savedReportId: string | number | bigint; formData: Record<string, unknown> }>({
    mutationFn: async ({ savedReportId, formData }) => {
      const { urlPath, init } = stdbBffCommandPost("update_saved_report", {
        companyId: requireOperatingCompany(companyId),
        savedReportId,
        params: stdbParamsToJson({
          name: formData.name != null ? String(formData.name).trim() : undefined,
          rowDimension:
            formData.rowDimension != null ? String(formData.rowDimension) : undefined,
          columnDimension:
            formData.columnDimension !== undefined
              ? formData.columnDimension == null || String(formData.columnDimension).trim() === ""
                ? null
                : String(formData.columnDimension)
              : undefined,
          measureField:
            formData.measureField != null ? String(formData.measureField) : undefined,
          measureOp: formData.measureOp != null ? String(formData.measureOp) : undefined,
          filterJson:
            formData.filterJson !== undefined
              ? formData.filterJson == null || String(formData.filterJson).trim() === ""
                ? null
                : String(formData.filterJson)
              : undefined,
          isActive: formData.isActive != null ? Boolean(formData.isActive) : undefined,
          metadata: undefined,
        }),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorReports(r))
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useDeleteSavedReport(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string | number | bigint>({
    mutationFn: async (savedReportId) => {
      const { urlPath, init } = stdbBffCommandPost("delete_saved_report", {
        companyId: requireOperatingCompany(companyId),
        savedReportId,
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorReports(r))
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

// ── Mutations — templates, schedules, metrics ─────────────────────────────────

function companyIdStringOrNull(formData: Record<string, unknown>): string | null {
  if (formData.companyId == null) return null
  const s = String(formData.companyId).trim()
  return s !== "" ? s : null
}

function companyIdNumberOrNull(formData: Record<string, unknown>): number | null {
  const s = companyIdStringOrNull(formData)
  if (s == null) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}

export function useCreateReportTemplate(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = toCreateReportTemplateParams(formData)
      if (!params) throw new Error('Invalid template parameters')
      const companyId = companyIdStringOrNull(formData)
      const { urlPath, init } = stdbBffCommandPost("create_report_template", { companyId: companyId, params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create report template')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useUpdateReportTemplate(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { templateId: string | number | bigint; params: Record<string, unknown> }
  >({
    mutationFn: async ({ templateId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("update_report_template", { companyId: requireOperatingCompany(companyId), templateId: templateId, params: stdbParamsToJson(params as object) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update report template')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useCreateScheduledReport(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = toCreateScheduledReportParams(formData)
      if (!params) throw new Error('Invalid scheduled report parameters')
      const companyId = companyIdNumberOrNull(formData)
      const { urlPath, init } = stdbBffCommandPost("create_scheduled_report", { companyId: companyId, params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create scheduled report')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useCreateAnalyticsMetric(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = toCreateAnalyticsMetricParams(formData)
      if (!params) throw new Error('Invalid metric parameters')
      const companyId = companyIdNumberOrNull(formData)
      const { urlPath, init } = stdbBffCommandPost("create_analytics_metric", { companyId: companyId, params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create analytics metric')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useUpdateMetricValues(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      metricId: string | number | bigint
      params: Record<string, unknown>
    }
  >({
    mutationFn: async ({ metricId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("update_metric_values", { companyId: requireOperatingCompany(companyId), metricId: metricId, params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update metric values')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useRecordReportRun(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    CanonicalRecordRef,
    Error,
    { reportId: string | number | bigint; nextRun: string | number | Date }
  >({
    mutationFn: async (params) => {
      const nextRunDate =
        params.nextRun instanceof Date
          ? params.nextRun
          : new Date(String(params.nextRun))
      if (Number.isNaN(nextRunDate.getTime())) throw new Error("Invalid next run timestamp")
      const nextRun = encodeTimestampMicros(stbTimestampFromDate(nextRunDate))
      const reportId = BigInt(params.reportId)

      const before = await fetchQueryList("/api/query/scheduled-reports", "Failed to read scheduled reports")
      const runCountBefore = scheduledReportRunCount(before, organizationId, reportId)
      if (runCountBefore == null) throw new Error("Scheduled report not found")

      const { urlPath, init } = stdbBffCommandPost("record_report_run", { reportId: params.reportId, nextRun: nextRun })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await responseErrorMessage(r))

      const after = await fetchQueryList("/api/query/scheduled-reports", "Failed to read scheduled reports")
      const effect = resolveReportRunEffect(after, organizationId, reportId, runCountBefore)
      if (!effect) throw new Error("Report run did not read back")
      return effect
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useCreateTrialBalanceEntry(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params =
        toCreateTrialBalanceEntryParams(formData) ??
        (() => {
          throw new Error(i18n.t("common.paramsMapper.invalidTrialBalanceEntry"))
        })()
      const { urlPath, init } = stdbBffCommandPost("create_trial_balance_entry", {
        companyId: requireOperatingCompany(companyId),
        params: stdbParamsToJson(params as object),
      })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create trial balance entry')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

// ── Mutations — dashboard & widgets (6 missing reducers) ────────────────────

export function useUpdateFinancialReport(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { reportId: string | number | bigint; patch: Record<string, unknown> }
  >({
    mutationFn: async ({ reportId, patch }) => {
      const params = toUpdateFinancialReportParams(patch)
      const { urlPath, init } = stdbBffCommandPost("update_financial_report", {
        companyId: requireOperatingCompany(companyId),
        reportId,
        params: stdbParamsToJson(params),
      })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update financial report')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useCreateDashboard(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = toCreateDashboardParams(formData)
      if (!params.name.trim()) throw new Error('Dashboard name is required')
      const companyId = companyIdFromDashboardForm(formData)
      const { urlPath, init } = stdbBffCommandPost("create_dashboard", { companyId: companyId, params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create dashboard')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useCreateDashboardWidget(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = toCreateDashboardWidgetParams(formData)
      if (!params.name.trim()) throw new Error('Widget name is required')
      if (!params.model.trim()) throw new Error('Data source / model is required')
      const companyId = companyIdFromDashboardWidgetForm(formData)
      const { urlPath, init } = stdbBffCommandPost("create_dashboard_widget", { companyId: companyId, params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create dashboard widget')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useAddWidgetToDashboard(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { dashboardId: string | number | bigint; widgetId: string | number | bigint; layout?: Record<string, unknown> }
  >({
    mutationFn: async ({ dashboardId, widgetId }) => {
      const { urlPath, init } = stdbBffCommandPost("add_widget_to_dashboard", { dashboardId: dashboardId, widgetId: widgetId })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add widget to dashboard')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

function toU32(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(0xffff_ffff, Math.floor(n))
}

function recordToWidgetLayoutParams(layout: Record<string, unknown>) {
  const x = Number(layout.positionX ?? layout.x ?? 0)
  const y = Number(layout.positionY ?? layout.y ?? 0)
  let w = Number(layout.width ?? layout.w ?? 4)
  if (!Number.isFinite(w) || w <= 0) w = 4
  const h = Number(layout.height ?? layout.h ?? 200)
  return {
    positionX: toU32(x),
    positionY: toU32(y),
    width: Math.max(1, toU32(w)),
    height: Math.max(1, toU32(h)),
  }
}

export function useUpdateWidgetLayout(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      widgetId: string | number | bigint
      layout: Record<string, unknown>
    }
  >({
    mutationFn: async ({ widgetId, layout }) => {
      const { urlPath, init } = stdbBffCommandPost("update_widget_layout", { companyId: requireOperatingCompany(companyId), widgetId: widgetId, params: stdbParamsToJson(recordToWidgetLayoutParams(layout)) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update widget layout')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export type ShareDashboardParamsInput = {
  /** SpacetimeDB identity hex strings. */
  shareWith: string[]
  shareWithGroups: (bigint | number | string)[]
}

export function useShareDashboard(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      dashboardId: string | number | bigint
      params: ShareDashboardParamsInput
    }
  >({
    mutationFn: async ({ dashboardId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("share_dashboard", { dashboardId: dashboardId, params: stdbParamsToJson({
          shareWith: params.shareWith,
          shareWithGroups: params.shareWithGroups.map((id) =>
            typeof id === "bigint" ? id : BigInt(String(id)),
          ),
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to share dashboard')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

import { responseErrorMessage as parseCallErrorReports } from "@lumiere/api-client/response-error"

function useImportReportTemplateCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_report_template_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorReports(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['report-templates', rqBigIntKey(organizationId)] }),
  })
}

function useImportAnalyticsMetricCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_analytics_metric_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorReports(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['analytics-metrics', rqBigIntKey(organizationId)] }),
  })
}

/** Report templates / analytics metrics CSV import (same org id as module query hooks). */
export function useReportsCsvImportMutations(organizationId: bigint) {
  return {
    importReportTemplate: useImportReportTemplateCsv(organizationId),
    importAnalyticsMetric: useImportAnalyticsMetricCsv(organizationId),
  }
}

export type ReportsCsvImportMutations = ReturnType<typeof useReportsCsvImportMutations>

// ── Types (re-exported so client components import from one place) ────────────
export type {
  AnalyticsMetric,
  CreateReportTemplateParams,
  CreateScheduledReportParams,
  CreateFinancialReportParams,
  Dashboard,
  DashboardWidget,
  FinancialReport,
  ReportTemplate,
  ScheduledReport,
  TrialBalance,
} from '@lumiere/stdb/types'
