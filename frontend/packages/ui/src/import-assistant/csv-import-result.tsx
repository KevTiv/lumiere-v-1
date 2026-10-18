"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useCsvImportReceipt, useTrackedCsvImport } from "@lumiere/query-hooks/hooks/tracked-csv-import"
import type { CsvImportRequest } from "@lumiere/query-hooks/hooks/csv-import-request"
import { Button } from "../components/button"
import { ImportJobStatusPanel } from "./import-job-status-panel"

export function CsvImportResult({ request, initialError, onNewFile, activeOrganizationId, activeCompanyId, initialPending = false }: {
  request: CsvImportRequest; initialError?: string | null; onNewFile: () => void; activeOrganizationId?: bigint; activeCompanyId?: bigint | number | string; initialPending?: boolean
}) {
  const { t } = useTranslation()
  const sameOrganization = String(activeOrganizationId ?? "") === request.organizationId
  const sameCompany = String(activeCompanyId ?? "") === request.companyId
  const sameScope = sameOrganization && sameCompany
  const retry = useTrackedCsvImport()
  const query = useCsvImportReceipt(request, sameScope && !initialPending && !retry.isPending)
  const [actionError, setActionError] = useState<string | null>(null)
  // Never show cached fields after a permission or read failure.
  const receipt = sameScope && !query.isError ? query.data : undefined
  const error = actionError ?? (query.isError ? initialError ?? String(query.error.message) : !receipt ? initialError : null)
  const busy = initialPending || query.isFetching || retry.isPending
  const recover = async () => {
    setActionError(null)
    try { await retry.mutateAsync(request); await query.refetch() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
  }
  if (!sameScope) return <p role="alert">{t("common.csvImportDialog.scopeChanged", { defaultValue: "The active organization or company changed. Return to the original scope to check this submission." })}</p>
  return <div className="space-y-3" aria-live="polite">
    <p className="text-sm">{t("common.csvImportDialog.exactResult", { defaultValue: "Results for this file submission" })}</p>
    <p className="text-xs text-muted-foreground">{t("common.csvImportDialog.requestReference", { defaultValue: "Submission reference: {{requestId}}", requestId: request.requestId })}</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <ImportJobStatusPanel fileName={request.fileName} isLoading={busy} job={receipt ? {
      id: receipt.jobId, tableName: receipt.entity, status: receipt.status, totalRows: receipt.totalRows,
      importedRows: receipt.rowsImported, errorRows: receipt.errorRows,
    } : undefined} errors={receipt?.errors ?? []} />
    {receipt?.errorsRedacted ? <p>{t("common.csvImportDialog.errorsRestricted", { defaultValue: "Your permissions do not include all row error details." })}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={() => { setActionError(null); void query.refetch() }}>
        {t("common.csvImportDialog.checkResult", { defaultValue: "Check results" })}
      </Button>
      {!receipt ? <Button type="button" disabled={busy} onClick={() => void recover()}>
        {t("common.csvImportDialog.retrySameSubmission", { defaultValue: "Retry same submission" })}
      </Button> : receipt.status !== "pending" ? <Button type="button" variant="outline" disabled={busy} onClick={onNewFile}>
        {t("common.csvImportDialog.importAnotherFile", { defaultValue: "Import another file" })}
      </Button> : null}
    </div>
    {!receipt ? <p className="text-xs text-muted-foreground">{t("common.csvImportDialog.recoveryNotice", { defaultValue: "The server may already have imported this file. Retry keeps the same submission reference and cannot create a second import. Avoid starting a new submission until this result is known." })}</p> : receipt.status === "partial" || receipt.status === "failed" ?
      <p className="text-xs text-muted-foreground">{t("common.csvImportDialog.correctedFileNotice", { defaultValue: "Submit a corrected file as a new submission. Retrying this reference preserves its original result." })}</p> : null}
  </div>
}
