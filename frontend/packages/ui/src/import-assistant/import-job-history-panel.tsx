"use client"

import { useTranslation } from "@lumiere/i18n"
import {
  canRollbackImportJob,
  type ImportJobRow,
} from "@lumiere/query-hooks/hooks/import-jobs"
import { Loader2, Undo2 } from "lucide-react"

import { Badge } from "../components/badge"
import { Button } from "../components/button"

function readCount(row: ImportJobRow, camel: keyof ImportJobRow, snake: keyof ImportJobRow): number {
  const value = row[camel] ?? row[snake]
  return typeof value === "number" ? value : Number(value ?? 0)
}

export type ImportJobHistoryPanelProps = {
  jobs: ImportJobRow[]
  rollingBackJobId?: string | null
  onRollback?: (job: ImportJobRow) => void
}

export function ImportJobHistoryPanel({
  jobs,
  rollingBackJobId = null,
  onRollback,
}: ImportJobHistoryPanelProps) {
  const { t } = useTranslation()

  if (jobs.length <= 1) return null

  return (
    <div className="space-y-2 rounded-md border border-border p-4">
      <p className="text-sm font-medium">{t("common.importAssistant.jobHistoryTitle")}</p>
      <ul className="space-y-2">
        {jobs.map((job) => {
          const id = String(job.id ?? "")
          const status = String(job.status ?? "pending")
          const importedRows = readCount(job, "importedRows", "imported_rows")
          const errorRows = readCount(job, "errorRows", "error_rows")
          const canRollback = canRollbackImportJob(job)
          const isRollingBack = rollingBackJobId === id

          return (
            <li
              key={id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">#{id}</span>
                <Badge variant="outline">{status}</Badge>
                <span className="text-muted-foreground">
                  {t("common.importAssistant.jobImported")}: {importedRows}
                  {errorRows > 0 ? ` · ${t("common.importAssistant.jobErrors")}: ${errorRows}` : ""}
                </span>
              </div>
              {canRollback && onRollback ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isRollingBack}
                  onClick={() => onRollback(job)}
                >
                  {isRollingBack ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Undo2 className="mr-2 h-4 w-4" />
                  )}
                  {t("common.importAssistant.rollbackImport")}
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
