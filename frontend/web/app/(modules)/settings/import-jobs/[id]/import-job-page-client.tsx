"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

import { useTranslation } from "@lumiere/i18n"
import {
  ImportJobStatusPanel,
  MissingOrganization,
} from "@lumiere/ui"
import { Button } from "@lumiere/ui/components/button"
import {
  useImportJobErrors,
  useImportJobs,
  useRollbackImportJob,
  canRollbackImportJob,
  type ImportJobErrorRow,
  type ImportJobRow,
} from "@lumiere/query-hooks/hooks/import-jobs"

import { hasValidOrganizationId } from "@/lib/org-scoped"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { useConfirmDialog } from "@lumiere/ui/hooks/use-confirm-dialog"

interface ImportJobPageClientProps {
  jobId: string
  organizationId?: number
}

export function ImportJobPageClient({ jobId, organizationId }: ImportJobPageClientProps) {
  const { t } = useTranslation()

  if (!hasValidOrganizationId(organizationId)) {
    return <MissingOrganization />
  }

  return (
    <ImportJobPageLoaded
      jobId={jobId}
      organizationId={BigInt(organizationId)}
      title={t("common.importAssistant.jobStatusTitle", { defaultValue: "Import job status" })}
    />
  )
}

function ImportJobPageLoaded({
  jobId,
  organizationId,
  title,
}: {
  jobId: string
  organizationId: bigint
  title: string
}) {
  const jobs = useImportJobs(organizationId)
  const errors = useImportJobErrors(organizationId)
  const rollbackJob = useRollbackImportJob(organizationId)
  const [rollbackError, setRollbackError] = useState<string | null>(null)
  const { t } = useTranslation()
  const { confirm, dismiss, dialog } = useConfirmDialog()
  const reviewing = useRef(false)
  const scope = `${organizationId}:${jobId}`
  const activeScope = useRef(scope)
  activeScope.current = scope
  useEffect(() => { dismiss(); setRollbackError(null) }, [scope, dismiss])
  const jobsState = moduleQueryState(jobs)
  const errorsState = moduleQueryState(errors)
  const job = (jobsState.status === "ready" ? (jobs.data ?? []) as unknown as ImportJobRow[] : []).find(
    (row) => String(row.id ?? "") === jobId,
  )

  const handleRollback = async () => {
    if (!job?.id || reviewing.current || rollbackJob.isPending || jobsState.status !== "ready" || errorsState.status !== "ready" || !canRollbackImportJob(job)) return
    reviewing.current = true
    setRollbackError(null)
    try {
      const exactJobId = parseStrictU64(job.id)
      if (!exactJobId || exactJobId <= 0n) throw new Error(t("settings.importJob.invalidJobId", { defaultValue: "The import job identifier could not be verified. No rollback was submitted." }))
      const accepted = await confirm({
        title: t("common.importAssistant.rollbackImport"),
        description: <span className="space-y-2">
          <span className="block">{t("settings.importJob.rollbackScope", {
            defaultValue: "Roll back import #{{id}}: {{file}} ({{table}}).",
            id: String(job.id), file: job.fileName ?? job.file_name ?? "—", table: job.tableName ?? job.table_name ?? "—",
          })}</span>
          <span className="block">{t("settings.importJob.rollbackEffect", { defaultValue: "This removes records created by this import when the server confirms they are still eligible. Changed or dependent records can prevent rollback. Review the import and its row errors before continuing." })}</span>
        </span>,
        confirmLabel: t("settings.import.confirmRollback", { defaultValue: "Confirm rollback" }),
      })
      if (!accepted || activeScope.current !== scope) return
      // The confirmation is a review checkpoint, not authority to reuse stale job state.
      const refreshed = await jobs.refetch()
      if (refreshed.isError || activeScope.current !== scope) throw new Error(t("settings.importJob.rollbackReadFailed", { defaultValue: "The import could not be refreshed. No rollback was submitted. Retry the job source." }))
      const currentJob = refreshed.data?.find((row) => String(row.id ?? "") === String(exactJobId)) as ImportJobRow | undefined
      if (!canRollbackImportJob(currentJob) || currentJob?.status !== job.status || currentJob?.metadata !== job.metadata
        || (currentJob?.importedRows ?? currentJob?.imported_rows) !== (job.importedRows ?? job.imported_rows)
        || (currentJob?.tableName ?? currentJob?.table_name) !== (job.tableName ?? job.table_name)
        || (currentJob?.fileName ?? currentJob?.file_name) !== (job.fileName ?? job.file_name)) {
        throw new Error(t("settings.importJob.rollbackChanged", { defaultValue: "The import changed or is no longer eligible. Review its current status before requesting rollback again." }))
      }
      await rollbackJob.mutateAsync(exactJobId)
    } catch (e) {
      if (activeScope.current === scope) setRollbackError(e instanceof Error ? e.message : t("common.importAssistant.rollbackFailed"))
    } finally {
      reviewing.current = false
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">#{jobId}</p>
        </div>
        <Button
          variant="outline"
          render={<Link href="/settings" />}
          nativeButton={false}
        >
          Back to settings
        </Button>
      </div>
      {rollbackError ? <p role="alert" className="text-sm text-destructive">{rollbackError}</p> : null}
      <ModuleDataNotice state={jobsState} />
      {jobsState.status === "ready" ? <>
      <ModuleDataNotice state={errorsState} />
      {errorsState.status === "loading" ? <p role="status">{t("settings.importJob.errorsLoading", { defaultValue: "Loading import row errors…" })}</p> : null}
      <ImportJobStatusPanel
        job={job}
        onRollback={errorsState.status === "ready" ? () => void handleRollback() : undefined}
        isRollbackPending={rollbackJob.isPending}
        errors={(errorsState.status === "ready" ? errors.data ?? [] : []) as unknown as ImportJobErrorRow[]}
        isLoading={false}
        fileName={String(job?.fileName ?? job?.file_name ?? "") || undefined}
      />
      </> : jobsState.status === "loading" ? <p role="status">{t("common.importAssistant.jobPending")}</p> : null}
      {dialog}
    </main>
  )
}
