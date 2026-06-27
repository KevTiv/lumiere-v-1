"use client"

/**
 * Reports hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Reports module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { reportsBffPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { toCreateFinancialReportParams } from "@lumiere/erp-shared/reports-create-params"
import { toCreateReportTemplateParams } from "@lumiere/erp-shared/reports-template-params"
import { toCreateScheduledReportParams } from "@lumiere/erp-shared/reports-scheduled-params"
import { toCreateAnalyticsMetricParams } from "@lumiere/erp-shared/reports-analytics-params"
import { toUpdateFinancialReportParams } from "@lumiere/erp-shared/reports-update-params"
import {
  companyIdFromDashboardForm,
  companyIdFromDashboardWidgetForm,
  toCreateDashboardParams,
  toCreateDashboardWidgetParams,
} from "@lumiere/erp-shared/reports-dashboard-params"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useFinancialReports(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['financial-reports', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/financial-reports', 'Failed to fetch financial reports'),
    staleTime: 30_000,
    initialData,
  })
}

export function useTrialBalances(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['trial-balances', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/trial-balances', 'Failed to fetch trial balances'),
    staleTime: 30_000,
    initialData,
  })
}

export function useReportTemplates(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['report-templates', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/report-templates', 'Failed to fetch report templates'),
    staleTime: 30_000,
    initialData,
  })
}

export function useScheduledReports(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['scheduled-reports', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/scheduled-reports', 'Failed to fetch scheduled reports'),
    staleTime: 30_000,
    initialData,
  })
}

export function useAnalyticsMetrics(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['analytics-metrics', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/analytics-metrics', 'Failed to fetch analytics metrics'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDashboards(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['dashboards', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/dashboards', 'Failed to fetch dashboards'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDashboardWidgets(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
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
    qc.invalidateQueries({ queryKey: ['dashboards', k] }),
    qc.invalidateQueries({ queryKey: ['dashboard-widgets', k] }),
  ])
}

// ── Mutations — financial reports lifecycle ───────────────────────────────────

/**
 * Creates a draft `FinancialReport`, resolves its id from SQL, then calls
 * `generate_financial_report` to build trial balance lines.
 */
export function useCreateFinancialReportFlow(organizationId: bigint) {
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

      const createCall = reportsBffPost("create_financial_report", [stdbParamsToJson(params)])
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

      const genCall = reportsBffPost("generate_financial_report", [Number(created.id)])
      const genRes = await apiFetch(genCall.urlPath, genCall.init)
      if (!genRes.ok) throw new Error('Failed to generate financial report')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useGenerateFinancialReport(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string | number | bigint>({
    mutationFn: async (reportId) => {
      const { urlPath, init } = reportsBffPost("generate_financial_report", [reportId])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to regenerate report')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useExportFinancialReport(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { reportId: string | number | bigint; exportFormat: 'pdf' | 'xlsx' | 'csv' }
  >({
    mutationFn: async ({ reportId, exportFormat }) => {
      const { urlPath, init } = reportsBffPost("export_financial_report", [
        reportId,
        stdbParamsToJson({ exportFormat }),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to export report')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useArchiveFinancialReport(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string | number | bigint>({
    mutationFn: async (reportId) => {
      const { urlPath, init } = reportsBffPost("archive_financial_report", [reportId])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to archive report')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useDeleteFinancialReport(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string | number | bigint>({
    mutationFn: async (reportId) => {
      const { urlPath, init } = reportsBffPost("delete_financial_report", [reportId])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete report')
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
      const { urlPath, init } = reportsBffPost("create_report_template", [
        organizationId,
        companyId,
        stdbParamsToJson(params),
      ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create report template')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useUpdateReportTemplate(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { templateId: string | number | bigint; params: Record<string, unknown> }
  >({
    mutationFn: async ({ templateId, params }) => {
      const { urlPath, init } = reportsBffPost("update_report_template", [
        organizationId,
        templateId,
        stdbParamsToJson(params as object),
      ])

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
      const { urlPath, init } = reportsBffPost("create_scheduled_report", [
          organizationId,
          companyId,
          stdbParamsToJson(params),
        ])

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
      const { urlPath, init } = reportsBffPost("create_analytics_metric", [
          organizationId,
          companyId,
          stdbParamsToJson(params),
        ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create analytics metric')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useUpdateMetricValues(organizationId: bigint) {
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
      const { urlPath, init } = reportsBffPost("update_metric_values", [
          organizationId,
          metricId,
          stdbParamsToJson(params),
        ])

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
  return useMutation({
    mutationFn: async (params: {
      reportId: string | number | bigint
      nextRun: string | number | Date
    }) => {
      const nextRun =
        params.nextRun instanceof Date
          ? params.nextRun.toISOString()
          : String(params.nextRun)

      const { urlPath, init } = reportsBffPost("record_report_run", [
          organizationId,
          params.reportId,
          nextRun,
        ])


      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to record report run')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useCreateTrialBalanceEntry(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = {
        reportId: Number(formData.reportId),
        accountId: Number(formData.accountId),
        accountCode: String(formData.accountCode ?? ''),
        accountName: String(formData.accountName ?? ''),
        openingDebit: Number(formData.openingDebit ?? 0),
        openingCredit: Number(formData.openingCredit ?? 0),
        periodDebit: Number(formData.periodDebit ?? 0),
        periodCredit: Number(formData.periodCredit ?? 0),
        currencyId: Number(formData.currencyId ?? 1),
        parentId: formData.parentId != null && String(formData.parentId).trim() !== ''
          ? Number(formData.parentId)
          : null,
        level: Number(formData.level ?? 1),
        isLeaf: Boolean(formData.isLeaf),
      }
      const { urlPath, init } = reportsBffPost("create_trial_balance_entry", [stdbParamsToJson(params)])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create trial balance entry')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

// ── Mutations — dashboard & widgets (6 missing reducers) ────────────────────

export function useUpdateFinancialReport(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { reportId: string | number | bigint; patch: Record<string, unknown> }
  >({
    mutationFn: async ({ reportId, patch }) => {
      const params = toUpdateFinancialReportParams(patch)
      const { urlPath, init } = reportsBffPost("update_financial_report", [reportId, stdbParamsToJson(params)])

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
      const { urlPath, init } = reportsBffPost("create_dashboard", [organizationId, companyId, stdbParamsToJson(params)])

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
      const { urlPath, init } = reportsBffPost("create_dashboard_widget", [organizationId, companyId, stdbParamsToJson(params)])

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
      const { urlPath, init } = reportsBffPost("add_widget_to_dashboard", [organizationId, dashboardId, widgetId])

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

export function useUpdateWidgetLayout(organizationId: bigint) {
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
      const { urlPath, init } = reportsBffPost("update_widget_layout", [
          organizationId,
          widgetId,
          stdbParamsToJson(recordToWidgetLayoutParams(layout)),
        ])

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
      const { urlPath, init } = reportsBffPost("share_dashboard", [
        organizationId,
        dashboardId,
        stdbParamsToJson({
          shareWith: params.shareWith,
          shareWithGroups: params.shareWithGroups.map((id) =>
            typeof id === "bigint" ? id : BigInt(String(id)),
          ),
        }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to share dashboard')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

async function parseCallErrorReports(r: Response): Promise<string> {
  try {
    const body = (await r.json()) as { error?: string; message?: string }
    return body.error ?? body.message ?? r.statusText
  } catch {
    return r.statusText
  }
}

function useImportReportTemplateCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = reportsBffPost("import_report_template_csv", [organizationId, csvData])

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
      const { urlPath, init } = reportsBffPost("import_analytics_metric_csv", [organizationId, csvData])

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
  CreateReportTemplateParams,
  CreateScheduledReportParams,
  CreateFinancialReportParams,
} from '@lumiere/stdb/types'
