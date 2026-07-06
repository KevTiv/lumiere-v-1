"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { stdbBffPost } from "@lumiere/stdb/commands"

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"

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

export function useImportJobs(organizationId: bigint, enabled = true) {
  return useQuery({
    queryKey: ["import-jobs", rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList("/api/query/import-jobs", "Failed to fetch import jobs"),
    enabled: organizationId > 0n && enabled,
    refetchInterval: (query) => {
      const rows = (query.state.data ?? []) as ImportJobRow[]
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
  return status === "success" || status === "partial"
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
      const { urlPath, init } = stdbBffPost("rollback_import_job", [
        organizationId,
        BigInt(jobId),
      ])
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
