"use client"

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
  const job = ((jobs.data ?? []) as unknown as ImportJobRow[]).find(
    (row) => String(row.id ?? "") === jobId,
  )

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
      <ImportJobStatusPanel
        job={job}
        errors={(errors.data ?? []) as unknown as ImportJobErrorRow[]}
        isLoading={jobs.isLoading || errors.isLoading}
        fileName={String(job?.fileName ?? job?.file_name ?? "") || undefined}
      />
    </main>
  )
}
