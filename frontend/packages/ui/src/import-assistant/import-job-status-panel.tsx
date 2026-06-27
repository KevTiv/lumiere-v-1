"use client"

import { useTranslation } from "@lumiere/i18n"
import {
  downloadImportJobErrorsCsv,
  errorsForJob,
  type ImportJobErrorRow,
  type ImportJobRow,
} from "@lumiere/query-hooks/hooks/import-jobs"
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from "lucide-react"

import { Badge } from "../components/badge"
import { Button } from "../components/button"

function readCount(row: ImportJobRow, camel: keyof ImportJobRow, snake: keyof ImportJobRow): number {
  const value = row[camel] ?? row[snake]
  return typeof value === "number" ? value : Number(value ?? 0)
}

export type ImportJobStatusPanelProps = {
  job?: ImportJobRow
  errors: ImportJobErrorRow[]
  isLoading?: boolean
  fileName?: string
  onRetryFailedRows?: () => void
  retryRowCount?: number
}

export function ImportJobStatusPanel({
  job,
  errors,
  isLoading = false,
  fileName,
  onRetryFailedRows,
  retryRowCount = 0,
}: ImportJobStatusPanelProps) {
  const { t } = useTranslation()

  if (isLoading && !job) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.importAssistant.jobPending")}
      </div>
    )
  }

  if (!job) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        {t("common.importAssistant.jobNotFound")}
      </div>
    )
  }

  const status = String(job.status ?? "pending")
  const totalRows = readCount(job, "totalRows", "total_rows")
  const importedRows = readCount(job, "importedRows", "imported_rows")
  const errorRows = readCount(job, "errorRows", "error_rows")
  const jobErrors = errorsForJob(errors, job)
  const isSuccess = status === "success"
  const isPartial = status === "partial"

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        {isSuccess ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : isPartial ? (
          <AlertCircle className="h-5 w-5 text-amber-600" />
        ) : status === "failed" ? (
          <AlertCircle className="h-5 w-5 text-destructive" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
        <div>
          <p className="font-medium">{t("common.importAssistant.jobStatusTitle")}</p>
          {fileName ? <p className="text-sm text-muted-foreground">{fileName}</p> : null}
        </div>
        <Badge variant={isSuccess ? "default" : isPartial ? "secondary" : "outline"}>
          {status}
        </Badge>
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <span className="text-muted-foreground">{t("common.importAssistant.jobTotal")}: </span>
          {totalRows}
        </div>
        <div>
          <span className="text-muted-foreground">{t("common.importAssistant.jobImported")}: </span>
          {importedRows}
        </div>
        <div>
          <span className="text-muted-foreground">{t("common.importAssistant.jobErrors")}: </span>
          {errorRows}
        </div>
      </div>

      {jobErrors.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              downloadImportJobErrorsCsv(
                jobErrors,
                `${fileName?.replace(/\.csv$/i, "") || "import"}-errors.csv`,
              )
            }
          >
            {t("common.importAssistant.downloadErrors")}
          </Button>
          {onRetryFailedRows && retryRowCount > 0 ? (
            <Button type="button" variant="secondary" size="sm" onClick={onRetryFailedRows}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t("common.importAssistant.retryFailedRows", { count: retryRowCount })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
