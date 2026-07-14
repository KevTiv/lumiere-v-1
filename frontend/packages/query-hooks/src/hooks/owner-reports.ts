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
  OwnerReportScheduleList,
  ReportKey,
  ReportPreview,
  ReportPreviewRequest,
} from "@lumiere/erp-shared/report-schemas"

import { apiFetch, rqBigIntKey } from "../http"

export type { ReportCatalogV1, ReportKey, ReportPreview, ReportPreviewRequest }
export type { GeneratedOwnerReportHistoryRow }
export type { OwnerReportScheduleList }
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

export interface OwnerReportScheduleInput {
  name: string
  companyId: number
  reportKey: ReportKey
  frequency: "daily" | "weekly" | "monthly"
  hour: number
  minute: number
  timezone: string
  recipientIdentities: string[]
  nextRun: string
  isActive?: boolean
}

export function useOwnerReportSchedules(organizationId: bigint, companyId?: number) {
  return useQuery<OwnerReportScheduleList>({
    queryKey: [OWNER_REPORTS_QUERY_KEY, "schedules", rqBigIntKey(organizationId), companyId ?? 0],
    enabled: Boolean(companyId && companyId > 0),
    queryFn: async () => {
      const response = await apiFetch(`/api/reports/schedules?companyId=${companyId}`)
      if (!response.ok) throw new Error("Failed to fetch owner-report schedules")
      return response.json() as Promise<OwnerReportScheduleList>
    },
  })
}

export function useCreateOwnerReportSchedule(organizationId: bigint) {
  return useMutation<void, Error, OwnerReportScheduleInput>({
    mutationKey: [OWNER_REPORTS_QUERY_KEY, "schedule-create", rqBigIntKey(organizationId)],
    mutationFn: async (input) => {
      const response = await apiFetch("/api/reports/schedules", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(await response.text())
    },
  })
}

export function useRunOwnerReportSchedule() {
  return useMutation<void, Error, number>({
    mutationFn: async (scheduleId) => {
      const response = await apiFetch(`/api/reports/schedules/${scheduleId}/run`, { method: "POST" })
      if (!response.ok) throw new Error(await response.text())
    },
  })
}

export function useUpdateOwnerReportSchedule() {
  return useMutation<void, Error, { scheduleId: number; input: Partial<OwnerReportScheduleInput> }>({
    mutationFn: async ({ scheduleId, input }) => {
      const response = await apiFetch(`/api/reports/schedules/${scheduleId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(await response.text())
    },
  })
}

export function useOwnerReportScheduleRecipients(organizationId: bigint) {
  return useQuery<Array<{ userIdentity?: string; user_identity?: string }>>({
    queryKey: [OWNER_REPORTS_QUERY_KEY, "schedule-recipients", rqBigIntKey(organizationId)],
    queryFn: async () => {
      const response = await apiFetch("/api/reports/schedules/recipients")
      if (!response.ok) throw new Error("Failed to fetch owner-report recipients")
      return response.json() as Promise<Array<{ userIdentity?: string; user_identity?: string }>>
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
