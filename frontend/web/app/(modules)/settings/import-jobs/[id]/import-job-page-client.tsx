"use client"

import { useState } from "react"
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
  type ImportJobErrorRow,
  type ImportJobRow,
} from "@lumiere/query-hooks/hooks/import-jobs"

import { hasValidOrganizationId } from "@/lib/org-scoped"

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
  const job = ((jobs.data ?? []) as unknown as ImportJobRow[]).find(
    (row) => String(row.id ?? "") === jobId,
  )

  const handleRollback = async () => {
    if (!job?.id) return
    setRollbackError(null)
    try {
      await rollbackJob.mutateAsync(typeof job.id === "string" ? Number(job.id) : job.id)
    } catch (e) {
      setRollbackError(e instanceof Error ? e.message : t("common.importAssistant.rollbackFailed"))
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
          {t("settings.importJobs.backToSettings")}
        </Button>
      </div>
      {rollbackError ? <p role="alert" className="text-sm text-destructive">{rollbackError}</p> : null}
      <ImportJobStatusPanel
        job={job}
        onRollback={() => void handleRollback()}
        isRollbackPending={rollbackJob.isPending}
        errors={(errors.data ?? []) as unknown as ImportJobErrorRow[]}
        isLoading={jobs.isLoading || errors.isLoading}
        fileName={String(job?.fileName ?? job?.file_name ?? "") || undefined}
      />
    </main>
  )
}
