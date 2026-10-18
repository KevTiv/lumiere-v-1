import type { ImportJobRow } from "@lumiere/query-hooks/hooks/import-jobs"

/** History is organization-scoped by the query. Never infer the submitted job from list order. */
export function csvImportHistoryJobs(jobs: ImportJobRow[], tableName?: string): ImportJobRow[] {
  return jobs.filter((job) => job.id != null && String(job.id) !== "" &&
    (!tableName || (job.tableName ?? job.table_name) === tableName))
}

export function selectedCsvImportJob(jobs: ImportJobRow[], selectedId: string | null): ImportJobRow | undefined {
  return selectedId === null ? undefined : jobs.find((job) => String(job.id) === selectedId)
}
