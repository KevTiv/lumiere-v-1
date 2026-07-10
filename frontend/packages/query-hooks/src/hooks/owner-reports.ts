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
  ReportEnvelope,
  ReportKey,
  ReportPreviewRequest,
} from "@lumiere/erp-shared/report-schemas"

import { apiFetch, rqBigIntKey } from "../http"

export type { ReportCatalogV1, ReportEnvelope, ReportKey, ReportPreviewRequest }
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
  return useMutation<ReportEnvelope<DailyBusinessSummaryReportV1>, Error, ReportPreviewInput>({
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
      return response.json() as Promise<ReportEnvelope<DailyBusinessSummaryReportV1>>
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
