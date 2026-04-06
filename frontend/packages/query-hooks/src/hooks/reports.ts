"use client"

/**
 * Reports hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Reports module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { toCreateFinancialReportParams } from "@lumiere/erp-shared/reports-create-params"
import { toCreateReportTemplateParams } from "@lumiere/erp-shared/reports-template-params"
import { toCreateScheduledReportParams } from "@lumiere/erp-shared/reports-scheduled-params"
import { toCreateAnalyticsMetricParams } from "@lumiere/erp-shared/reports-analytics-params"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useFinancialReports(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['financial-reports', organizationId.toString()],
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
    queryKey: ['trial-balances', organizationId.toString()],
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
    queryKey: ['report-templates', organizationId.toString()],
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
    queryKey: ['scheduled-reports', organizationId.toString()],
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
    queryKey: ['analytics-metrics', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/analytics-metrics', 'Failed to fetch analytics metrics'),
    staleTime: 30_000,
    initialData,
  })
}

function invalidateReportsModule(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const org = organizationId.toString()
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['financial-reports', org] }),
    qc.invalidateQueries({ queryKey: ['trial-balances', org] }),
    qc.invalidateQueries({ queryKey: ['report-templates', org] }),
    qc.invalidateQueries({ queryKey: ['scheduled-reports', org] }),
    qc.invalidateQueries({ queryKey: ['analytics-metrics', org] }),
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

      const createRes = await apiFetch('/api/call/create_financial_report?withCompany=true',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([stdbParamsToJson(params)]),
        },
      )
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

      const genRes = await apiFetch('/api/call/generate_financial_report?withCompany=true',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([String(created.id)]),
        },
      )
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
      const r = await apiFetch('/api/call/generate_financial_report?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([String(reportId)]),
      })
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
      const r = await apiFetch('/api/call/export_financial_report?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([String(reportId), { exportFormat }]),
      })
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
      const r = await apiFetch('/api/call/archive_financial_report?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([String(reportId)]),
      })
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
      const r = await apiFetch('/api/call/delete_financial_report?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([String(reportId)]),
      })
      if (!r.ok) throw new Error('Failed to delete report')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

// ── Mutations — templates, schedules, metrics ─────────────────────────────────

export function useCreateReportTemplate(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (formData) => {
      const params = toCreateReportTemplateParams(formData)
      if (!params) throw new Error('Invalid template parameters')
      const companyId =
        formData.companyId != null ? String(formData.companyId) : null
      const r = await apiFetch('/api/call/create_report_template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId, params]),
      })
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
      const r = await apiFetch('/api/call/update_report_template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), String(templateId), params]),
      })
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
      const companyId =
        formData.companyId != null ? String(formData.companyId) : null
      const r = await apiFetch('/api/call/create_scheduled_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          companyId,
          stdbParamsToJson(params),
        ]),
      })
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
      const companyId =
        formData.companyId != null ? String(formData.companyId) : null
      const r = await apiFetch('/api/call/create_analytics_metric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          companyId,
          stdbParamsToJson(params),
        ]),
      })
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
      const r = await apiFetch('/api/call/update_metric_values', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          String(metricId),
          stdbParamsToJson(params),
        ]),
      })
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

      const r = await apiFetch('/api/call/record_report_run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          params.reportId.toString(),
          nextRun,
        ]),
      })
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
        closingDebit: Number(formData.closingDebit ?? 0),
        closingCredit: Number(formData.closingCredit ?? 0),
        currencyId: Number(formData.currencyId ?? 1),
        parentId: formData.parentId != null && String(formData.parentId).trim() !== ''
          ? Number(formData.parentId)
          : null,
        level: Number(formData.level ?? 1),
        isLeaf: Boolean(formData.isLeaf),
      }
      const r = await apiFetch('/api/call/create_trial_balance_entry?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([stdbParamsToJson(params)]),
      })
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
    { reportId: string | number | bigint; params: Record<string, unknown> }
  >({
    mutationFn: async ({ reportId, params }) => {
      const r = await apiFetch('/api/call/update_financial_report?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([String(reportId), stdbParamsToJson(params)]),
      })
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
      const params = {
        name: String(formData.name ?? ''),
        description: formData.description ? String(formData.description) : null,
        isActive: Boolean(formData.isActive ?? true),
      }
      const companyId = formData.companyId != null ? String(formData.companyId) : null
      const r = await apiFetch('/api/call/create_dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId, stdbParamsToJson(params)]),
      })
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
      const params = {
        name: String(formData.name ?? ''),
        widgetType: String(formData.widgetType ?? 'kpi'),
        dataSource: String(formData.dataSource ?? ''),
        config: formData.config ? JSON.stringify(formData.config) : null,
      }
      const companyId = formData.companyId != null ? String(formData.companyId) : null
      const r = await apiFetch('/api/call/create_dashboard_widget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId, stdbParamsToJson(params)]),
      })
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
    mutationFn: async ({ dashboardId, widgetId, layout }) => {
      const r = await apiFetch('/api/call/add_widget_to_dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          String(dashboardId),
          String(widgetId),
          layout ? stdbParamsToJson(layout) : null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to add widget to dashboard')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useUpdateWidgetLayout(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      dashboardId: string | number | bigint
      widgetId: string | number | bigint
      layout: Record<string, unknown>
    }
  >({
    mutationFn: async ({ dashboardId, widgetId, layout }) => {
      const r = await apiFetch('/api/call/update_widget_layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          String(dashboardId),
          String(widgetId),
          stdbParamsToJson(layout),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update widget layout')
    },
    onSuccess: async () => {
      await invalidateReportsModule(qc, organizationId)
    },
  })
}

export function useShareDashboard(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      dashboardId: string | number | bigint
      userId?: string | number | bigint
      teamId?: string | number | bigint
      permissions?: string
    }
  >({
    mutationFn: async ({ dashboardId, userId, teamId, permissions = 'read' }) => {
      const r = await apiFetch('/api/call/share_dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          String(dashboardId),
          userId ? String(userId) : null,
          teamId ? String(teamId) : null,
          permissions,
        ]),
      })
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
      const res = await apiFetch('/api/call/import_report_template_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorReports(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['report-templates', organizationId.toString()] }),
  })
}

function useImportAnalyticsMetricCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch('/api/call/import_analytics_metric_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorReports(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['analytics-metrics', organizationId.toString()] }),
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
} from '@lumiere/stdb/generated/types'
