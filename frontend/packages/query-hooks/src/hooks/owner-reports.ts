"use client"

/**
 * Owner-report hooks for the typed report catalog and preview BFF.
 *
 * These call `/api/reports/*` endpoints backed by `api-server/src/reports`.
 * Organization scope is resolved server-side from the session; hooks only pass
 * the user-selected company, date, and timezone.
 */

import { useMutation, useQuery } from "@tanstack/react-query"

import type {
  DailyBusinessSummaryReportV1,
  ReportCatalogV1,
  GeneratedOwnerReportHistoryRow,
  ReportKey,
  ReportPreview,
  ReportPreviewRequest,
} from "@lumiere/erp-shared/report-schemas"

import { apiFetch, rqBigIntKey } from "../http"

export type { ReportCatalogV1, ReportKey, ReportPreview, ReportPreviewRequest }
export type { GeneratedOwnerReportHistoryRow }
export type { DailyBusinessSummaryReportV1 }

export interface ReportPreviewInput {
  reportKey: ReportKey
  companyId: number
  date: string
  timezone: string
}

const OWNER_REPORTS_QUERY_KEY = "owner-reports"

export function useReportCatalog(organizationId: bigint) {
  return useQuery<ReportCatalogV1>({
    queryKey: [OWNER_REPORTS_QUERY_KEY, "catalog", rqBigIntKey(organizationId)],
    queryFn: async () => {
      const response = await apiFetch("/api/reports/catalog")
      if (!response.ok) {
        throw new Error("Failed to fetch report catalog")
      }
      return response.json() as Promise<ReportCatalogV1>
    },
    staleTime: 60_000,
  })
}

export function useReportPreview(organizationId: bigint) {
  return useMutation<ReportPreview, Error, ReportPreviewInput>({
    mutationKey: [OWNER_REPORTS_QUERY_KEY, "preview", rqBigIntKey(organizationId)],
    mutationFn: async (input) => {
      const body: ReportPreviewRequest = {
        companyId: input.companyId,
        date: input.date,
        timezone: input.timezone,
      }
      const response = await apiFetch(`/api/reports/${encodeURIComponent(input.reportKey)}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => "Preview request failed")
        throw new Error(text)
      }
      return response.json() as Promise<ReportPreview>
    },
  })
}

export function useReportPdf() {
  return useMutation<Blob, Error, ReportPreviewInput>({
    mutationFn: async (input) => {
      const response = await apiFetch(`/api/reports/${encodeURIComponent(input.reportKey)}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: input.companyId, date: input.date, timezone: input.timezone }),
      })
      if (!response.ok) throw new Error(await response.text())
      return response.blob()
    },
  })
}

export function useGeneratedOwnerReportHistory(organizationId: bigint, companyId?: number) {
  return useQuery<GeneratedOwnerReportHistoryRow[]>({
    queryKey: [OWNER_REPORTS_QUERY_KEY, "history", rqBigIntKey(organizationId), companyId ?? 0],
    enabled: Boolean(companyId && companyId > 0),
    queryFn: async () => {
      const response = await apiFetch(`/api/reports/history?companyId=${companyId}`)
      if (!response.ok) throw new Error("Failed to fetch generated report history")
      return response.json() as Promise<GeneratedOwnerReportHistoryRow[]>
    },
  })
}

/**
 * Invalidate the owner-reports catalog query.
 */
export function invalidateOwnerReportsCatalog(queryClient: {
  invalidateQueries: (options: { queryKey: string[] }) => Promise<void>
}) {
  return queryClient.invalidateQueries({ queryKey: [OWNER_REPORTS_QUERY_KEY, "catalog"] })
}
