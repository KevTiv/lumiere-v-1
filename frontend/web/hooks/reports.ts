/**
 * Reports hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Reports module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'

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

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateReportTemplate(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const companyId =
        params.companyId != null ? String(params.companyId) : null

      const payload =
        companyId === null ? params : { ...params, companyId: undefined }

      const r = await fetch('/api/call/create_report_template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId, payload]),
      })
      if (!r.ok) throw new Error('Failed to create report template')
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['financial-reports', organizationId.toString()] })
    },
  })
}

export function useCreateScheduledReport(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const companyId =
        params.companyId != null ? String(params.companyId) : null

      const payload =
        companyId === null ? params : { ...params, companyId: undefined }

      const r = await fetch('/api/call/create_scheduled_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId, payload]),
      })
      if (!r.ok) throw new Error('Failed to create scheduled report')
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['financial-reports', organizationId.toString()] })
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

      const r = await fetch('/api/call/record_report_run', {
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
      await qc.invalidateQueries({ queryKey: ['financial-reports', organizationId.toString()] })
    },
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateReportTemplateParams,
  CreateScheduledReportParams,
} from '@lumiere/stdb'
