"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useImportJobs, useImportJobErrors, useRollbackImportJob, type ImportJobRow, type ImportJobErrorRow } from "@lumiere/query-hooks/hooks/import-jobs"
import { csvImportHistoryJobs, selectedCsvImportJob } from "../lib/csv-import-history"
import { Button } from "../components/button"
import { Label } from "../components/label"
import { ImportJobStatusPanel } from "./import-job-status-panel"
import {
  AbandonedAccountingImportCleanup,
  type AbandonedAccountingImportCleanupProps,
} from "./abandoned-accounting-import-cleanup"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"

export function CsvImportHistory({
  organizationId,
  tableName,
  abandonedAccountingCleanup,
}: {
  organizationId: bigint
  tableName?: string
  abandonedAccountingCleanup?: Omit<AbandonedAccountingImportCleanupProps, "jobs">
}) {
  const { t } = useTranslation()
  const jobsQuery = useImportJobs(organizationId)
  const errorsQuery = useImportJobErrors(organizationId)
  const rollbackJob = useRollbackImportJob(organizationId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rollbackError, setRollbackError] = useState<string | null>(null)
  const { refetch } = jobsQuery
  // Refresh even when cached jobs are terminal: the submitted reducer does not return its job ID.
  useEffect(() => {
    void refetch()
    const timer = setInterval(() => { void refetch() }, 2000)
    return () => clearInterval(timer)
  }, [refetch])

  // A refetch error may mean access was revoked; do not expose cached job details.
  const jobs = jobsQuery.isError ? [] : csvImportHistoryJobs((jobsQuery.data ?? []) as unknown as ImportJobRow[], tableName)
  const job = selectedCsvImportJob(jobs, selectedId)
  const failed = jobsQuery.isError || errorsQuery.isError
  const handleRollback = async (target: ImportJobRow) => {
    if (!target.id) return
    setRollbackError(null)
    try {
      await rollbackJob.mutateAsync(typeof target.id === "string" ? Number(target.id) : target.id)
    } catch (e) {
      setRollbackError(e instanceof Error ? e.message : t("common.importAssistant.rollbackFailed"))
    }
  }
  return (
    <div className="space-y-3" aria-live="polite">
      {abandonedAccountingCleanup ? (
        <AbandonedAccountingImportCleanup
          {...abandonedAccountingCleanup}
          jobs={
            jobsQuery.isError ? [] : ((jobsQuery.data ?? []) as unknown as ImportJobRow[])
          }
        />
      ) : null}
      <p className="text-sm">
        {t("common.csvImportDialog.historyNotice", { defaultValue: "The file was submitted. This organization’s recent import history may include other users’ imports. Select a job to review its results; jobs are not automatically linked to this file." })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("common.csvImportDialog.historyLimit", { defaultValue: "History includes up to 100 recent jobs and 500 recent row errors across the organization. Some errors may no longer be available here." })}
      </p>
      <Button type="button" variant="outline" disabled={jobsQuery.isFetching || errorsQuery.isFetching}
        onClick={() => { void jobsQuery.refetch(); void errorsQuery.refetch() }}>
        {t("common.csvImportDialog.refreshHistory", { defaultValue: "Refresh history" })}
      </Button>
      {failed ? <p role="alert" className="text-sm text-destructive">
        {t("common.csvImportDialog.historyFailed", { defaultValue: "Import history or row errors could not be loaded. Refresh to try again. The file may already have been imported; do not resubmit it to check." })}
      </p> : null}
      {jobsQuery.isLoading ? <p>{t("common.loading", { defaultValue: "Loading…" })}</p> : !jobsQuery.isError && jobs.length === 0 ?
        <p>{t("common.csvImportDialog.historyEmpty", { defaultValue: "No matching import jobs are visible yet. History refreshes while this dialog is open." })}</p> : null}
      {job && errorsQuery.isLoading ? <p>{t("common.csvImportDialog.loadingErrors", { defaultValue: "Loading row errors…" })}</p> : null}
      {jobs.length > 0 ? <div className="space-y-2">
        <Label htmlFor="csv-import-history-job">{t("common.csvImportDialog.selectJob", { defaultValue: "Import job" })}</Label>
        <Select value={selectedId ?? ""} onValueChange={(value) => setSelectedId(value || null)}>
          <SelectTrigger id="csv-import-history-job">
            <SelectValue placeholder={t("common.csvImportDialog.selectJobPrompt", { defaultValue: "Select a job to review" })} />
          </SelectTrigger>
          <SelectContent>
            {jobs.map((row) => <SelectItem key={String(row.id)} value={String(row.id)}>
              #{String(row.id)} · {String(row.tableName ?? row.table_name)} · {String(row.status ?? "pending")}
            </SelectItem>)}
          </SelectContent>
        </Select>
      </div> : null}
      {rollbackError ? <p role="alert" className="text-sm text-destructive">{rollbackError}</p> : null}
      {job ? <ImportJobStatusPanel job={job} errors={errorsQuery.isError ? [] : (errorsQuery.data ?? []) as unknown as ImportJobErrorRow[]}
        onRollback={() => void handleRollback(job)} isRollbackPending={rollbackJob.isPending} /> : null}
    </div>
  )
}
