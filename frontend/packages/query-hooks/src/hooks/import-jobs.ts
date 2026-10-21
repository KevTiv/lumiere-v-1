"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import { dispatchNamedOperation } from "../operation-dispatch"
import { invalidateStdbQueryResources } from "./stdb"

export type ImportJobRow = {
  id?: number | string
  tableName?: string
  table_name?: string
  fileName?: string | null
  file_name?: string | null
  totalRows?: number
  total_rows?: number
  importedRows?: number
  imported_rows?: number
  errorRows?: number
  error_rows?: number
  status?: string
  metadata?: string | null
}

export type ImportJobErrorRow = {
  id?: number | string
  jobId?: number | string
  job_id?: number | string
  rowNumber?: number
  row_number?: number
  fieldName?: string | null
  field_name?: string | null
  rawValue?: string | null
  raw_value?: string | null
  errorMessage?: string
  error_message?: string
}

function jobTableName(row: ImportJobRow): string {
  return String(row.tableName ?? row.table_name ?? "")
}

function jobId(row: ImportJobRow): string {
  return String(row.id ?? "")
}

type AccountMoveBundleMarker = {
  version?: unknown
  role?: unknown
  token?: unknown
  parent_job_id?: unknown
}

type ImportJobMetadata = {
  company_id?: unknown
  account_move_bundle_rollback?: AccountMoveBundleMarker
}

function importJobMetadata(job: ImportJobRow | undefined): ImportJobMetadata | null {
  try {
    const metadata: unknown = JSON.parse(String(job?.metadata ?? ""))
    return metadata != null && typeof metadata === "object"
      ? (metadata as ImportJobMetadata)
      : null
  } catch {
    return null
  }
}

function accountMoveBundleMarker(job: ImportJobRow | undefined): AccountMoveBundleMarker | null {
  const marker = importJobMetadata(job)?.account_move_bundle_rollback
  return marker?.version === 1 &&
    (marker.role === "parent" || marker.role === "complete") &&
    typeof marker.token === "string" &&
    marker.token.trim().length > 0
    ? marker
    : null
}

function positiveId(value: unknown): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function useImportJobs(organizationId: bigint, enabled = true) {
  return useQuery({
    queryKey: ["import-jobs", rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList("/api/query/import-jobs", "Failed to fetch import jobs"),
    enabled: organizationId > 0n && enabled,
    refetchInterval: (query) => {
      const rows = (query.state.data ?? []) as unknown as ImportJobRow[]
      const pending = rows.some((row) => {
        const status = String(row.status ?? "")
        return status === "pending" || status === ""
      })
      return pending ? 2000 : false
    },
  })
}

export function useImportJobErrors(organizationId: bigint, enabled = true) {
  return useQuery({
    queryKey: ["import-job-errors", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList("/api/query/import-job-errors", "Failed to fetch import job errors"),
    enabled: organizationId > 0n && enabled,
    refetchInterval: enabled ? 2000 : false,
  })
}

export function findLatestImportJob(
  jobs: ImportJobRow[] | undefined,
  tableName: string,
): ImportJobRow | undefined {
  if (!jobs?.length) return undefined
  const normalized = tableName.trim().toLowerCase()
  return jobs.find((row) => jobTableName(row).toLowerCase() === normalized)
}

export function jobsForEntity(
  jobs: ImportJobRow[] | undefined,
  tableName: string,
  limit = 10,
): ImportJobRow[] {
  if (!jobs?.length) return []
  const normalized = tableName.trim().toLowerCase()
  return jobs
    .filter((row) => jobTableName(row).toLowerCase() === normalized)
    .slice(0, limit)
}

export function canRollbackImportJob(job: ImportJobRow | undefined): boolean {
  if (!job?.id) return false
  const status = String(job.status ?? "")
  if (status !== "success" && status !== "partial") return false
  const tableName = jobTableName(job).toLowerCase()
  if (tableName === "contact" || tableName === "product") return true
  if (tableName !== "account_move_line" || status !== "success") return false
  const marker = accountMoveBundleMarker(job)
  return marker?.role === "complete" &&
    typeof marker.parent_job_id === "number" &&
    positiveId(marker.parent_job_id) != null
}

/**
 * A successful parent job without its matching successful line job may be an
 * abandoned two-phase import. The server still revalidates that every owned
 * journal entry is an unchanged empty draft before deleting anything.
 */
export function canCleanupAbandonedAccountMoveImport(
  job: ImportJobRow | undefined,
  jobs: ImportJobRow[] | undefined,
  companyId: bigint | number | string,
): boolean {
  if (jobTableName(job ?? {}).toLowerCase() !== "account_move" || job?.status !== "success") {
    return false
  }
  const parentJobId = positiveId(job?.id)
  const marker = accountMoveBundleMarker(job)
  if (parentJobId == null || marker?.role !== "parent" || marker.parent_job_id != null) return false
  const activeCompanyId = positiveId(companyId)
  const jobCompanyId = positiveId(importJobMetadata(job)?.company_id)
  if (activeCompanyId == null || jobCompanyId !== activeCompanyId) return false

  return !(jobs ?? []).some((candidate) => {
    if (jobTableName(candidate).toLowerCase() !== "account_move_line") return false
    if (candidate.status !== "success") return false
    const childMarker = accountMoveBundleMarker(candidate)
    return childMarker?.role === "complete" &&
      childMarker.token === marker.token &&
      typeof childMarker.parent_job_id === "number" &&
      positiveId(childMarker.parent_job_id) === parentJobId
  })
}

export function errorsForJob(
  errors: ImportJobErrorRow[] | undefined,
  job: ImportJobRow | undefined,
): ImportJobErrorRow[] {
  if (!job || !errors?.length) return []
  const id = jobId(job)
  return errors.filter((row) => String(row.jobId ?? row.job_id ?? "") === id)
}

export function downloadImportJobErrorsCsv(errors: ImportJobErrorRow[], fileName: string) {
  const header = "row_number,field_name,raw_value,error_message"
  const lines = errors.map((row) => {
    const cells = [
      String(row.rowNumber ?? row.row_number ?? ""),
      String(row.fieldName ?? row.field_name ?? ""),
      String(row.rawValue ?? row.raw_value ?? ""),
      String(row.errorMessage ?? row.error_message ?? ""),
    ].map((cell) => `"${cell.replace(/"/g, '""')}"`)
    return cells.join(",")
  })
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export function useRollbackImportJob(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (jobId: bigint | number) => {
      const { urlPath, init } = stdbBffCommandPost("rollback_import_job", {
        jobId: BigInt(jobId),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const json = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? "Failed to rollback import job")
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["import-jobs", rqBigIntKey(organizationId)] })
    },
  })
}

export async function cleanupAbandonedAccountMoveImportCommand(
  companyId: bigint | number,
  parentJobId: bigint | number,
): Promise<void> {
  await dispatchNamedOperation(
    "cleanup_abandoned_account_move_import",
    {
      companyId: BigInt(companyId),
      parentJobId: BigInt(parentJobId),
    },
    "Failed to clean up abandoned journal import drafts",
  )
}

export function useCleanupAbandonedAccountMoveImport(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number>({
    mutationFn: (parentJobId) =>
      cleanupAbandonedAccountMoveImportCommand(companyId, parentJobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["import-jobs", rqBigIntKey(organizationId)] })
      invalidateStdbQueryResources(qc, organizationId, ["account-moves", "account-move-lines"])
    },
  })
}
