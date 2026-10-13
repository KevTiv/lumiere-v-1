"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { FormConfig } from "../lib/form-types"
import {
  analyzeCsv,
  buildCsvTemplate,
  canSubmitCsvImport,
  type CsvImportAnalysis,
  type CsvImportColumns,
} from "../lib/csv-import-preview"
import { showWorkflowToast } from "../lib/workflow-toast"
import { Button } from "./button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog"
import { Input } from "./input"
import { Label } from "./label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table"

export interface CsvImportModalProps {
  onClose: () => void
  /** Supplies the dialog title, description and button labels. */
  config: FormConfig
  isPending?: boolean
  onImport: (csvText: string) => CsvImportRecordRef | void | Promise<CsvImportRecordRef | void>
  /**
   * The reducer's header contract. When set, the preview checks the file's header against it, blocks
   * the import while a required column is missing, and offers a header-only template download.
   */
  columns?: CsvImportColumns
  /** File name for the downloaded template; defaults to `import-template.csv`. */
  templateFileName?: string
}

export interface CsvImportRecordRef {
  resource: "import-jobs"
  id: string
  href?: string
}

function downloadTemplate(columns: CsvImportColumns, fileName: string) {
  const blob = new Blob([buildCsvTemplate(columns)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * File-backed CSV import: pick a .csv, preview its first rows and header check, confirm, then submit
 * the raw text through `onImport`. The reducers skip bad rows and record them in the import job
 * history instead of failing the call, so a success toast means the file was accepted.
 */
export function CsvImportModal({
  onClose,
  config,
  isPending = false,
  onImport,
  columns,
  templateFileName = "import-template.csv",
}: CsvImportModalProps) {
  const { t } = useTranslation()
  const [fileName, setFileName] = useState("")
  const [csvText, setCsvText] = useState("")
  const [analysis, setAnalysis] = useState<CsvImportAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleFile = async (file: File | undefined) => {
    setError(null)
    setAnalysis(null)
    setCsvText("")
    setFileName(file?.name ?? "")
    if (!file) return
    try {
      const text = await file.text()
      setAnalysis(analyzeCsv(text, columns))
      setCsvText(text)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const handleSubmit = async () => {
    if (!canSubmitCsvImport(analysis)) return
    setError(null)
    setIsSubmitting(true)
    try {
      const record = await onImport(csvText)
      showWorkflowToast({
        kind: record ? "success" : "info",
        title: record
          ? t("common.csvImportDialog.success", { defaultValue: "Import job created" })
          : t("common.csvImportDialog.outcomeUnknown", { defaultValue: "Import outcome not verified" }),
        description: record
          ? t("common.csvImportDialog.successDescription", {
              defaultValue: "{{count}} rows from {{file}} were sent to import job {{jobId}}. Rows the server rejects are listed on that job.",
              count: analysis?.rowCount ?? 0,
              file: fileName,
              jobId: record.id,
            })
          : t("common.csvImportDialog.outcomeUnknownDescription", {
              defaultValue: "The server accepted {{file}}, but no exact import job was returned. Review import history before you retry.",
              file: fileName,
            }),
        ...(record?.href
          ? {
              action: {
                label: t("common.csvImportDialog.viewJob", { defaultValue: "View import job" }),
                onClick: () => window.location.assign(record.href!),
              },
            }
          : {}),
      })
      onClose()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      showWorkflowToast({
        kind: "error",
        title: t("common.csvImportDialog.failure", { defaultValue: "Import failed" }),
        description: message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const busy = isPending || isSubmitting

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          {config.description ? <DialogDescription>{config.description}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="csv-import-file">
              {t("common.csvImportDialog.fileLabel", { defaultValue: "CSV file" })}
            </Label>
            <Input
              id="csv-import-file"
              type="file"
              accept=".csv,text/csv,text/plain"
              disabled={busy}
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            {columns ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => downloadTemplate(columns, templateFileName)}
              >
                {t("common.csvImportDialog.downloadTemplate", { defaultValue: "Download template" })}
              </Button>
            ) : null}
          </div>

          {analysis ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("common.csvImportDialog.rowCount", {
                  defaultValue: "{{count}} rows found",
                  count: analysis.rowCount,
                })}
              </p>
              {analysis.missingRequired.length > 0 ? (
                <p role="alert" className="text-sm text-destructive">
                  {t("common.csvImportDialog.missingColumns", {
                    defaultValue: "Missing required columns: {{columns}}",
                    columns: analysis.missingRequired.join(", "),
                  })}
                </p>
              ) : null}
              {analysis.unknownColumns.length > 0 ? (
                <p className="text-sm text-amber-600">
                  {t("common.csvImportDialog.unknownColumns", {
                    defaultValue: "These columns are not used and will be ignored: {{columns}}",
                    columns: analysis.unknownColumns.join(", "),
                  })}
                </p>
              ) : null}
              {analysis.rowCount === 0 ? (
                <p role="alert" className="text-sm text-destructive">
                  {t("common.csvImportDialog.noRows", { defaultValue: "The file has a header but no data rows." })}
                </p>
              ) : null}
              <div className="max-h-56 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {analysis.headers.map((header, index) => (
                        <TableHead key={`${header}-${index}`}>{header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.previewRows.map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        {analysis.headers.map((_, cellIndex) => (
                          <TableCell key={cellIndex}>{row[cellIndex] ?? ""}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {config.cancelLabel ?? t("common.cancel")}
          </Button>
          <Button type="button" disabled={busy || !canSubmitCsvImport(analysis)} onClick={() => void handleSubmit()}>
            {config.submitLabel ?? t("common.csvImportDialog.submit", { defaultValue: "Import" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
