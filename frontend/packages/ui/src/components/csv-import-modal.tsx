"use client"

import { useMemo, useRef, useState } from "react"
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
import { createCsvImportRequest, supportsTrackedCsvImport, type CsvImportRequest, type TrackedCsvImportScope } from "@lumiere/query-hooks/hooks/csv-import-request"
import { useTrackedCsvImport } from "@lumiere/query-hooks/hooks/tracked-csv-import"
import { CsvImportResult } from "../import-assistant/csv-import-result"
import { CsvImportHistory } from "../import-assistant/csv-import-history"
import { AccountingImportReview } from "../import-assistant/accounting-import-review"
import { accountingImportReview } from "../lib/accounting-import-review"
import type { AbandonedAccountingImportCleanupProps } from "../import-assistant/abandoned-accounting-import-cleanup"
import type { ModuleDataState } from "../lib/module-data-state"
import { ModuleDataNotice } from "../pages/module-data-notice"
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
  onImport: (csvText: string) => void | Promise<void>
  /**
   * The reducer's header contract. When set, the preview checks the file's header against it, blocks
   * the import while a required column is missing, and offers a header-only template download.
   */
  columns?: CsvImportColumns
  /** File name for the downloaded template; defaults to `import-template.csv`. */
  templateFileName?: string
  /** Scope import results to this organization and entity. */
  organizationId?: bigint
  /** Active company also scopes legacy multi-phase accounting imports. */
  companyId?: bigint
  tableName?: string
  /** Use the dedicated tracked API. Legacy onImport remains supported when absent. */
  trackedImport?: TrackedCsvImportScope
  /** Optional controls for reviewing abandoned accounting parent-phase imports. */
  abandonedAccountingCleanup?: Omit<AbandonedAccountingImportCleanupProps, "jobs">
  /** Optional app-level reader that converts CSV or spreadsheet files to canonical CSV text. */
  fileReader?: (file: File) => Promise<{ csvText: string }>
  /** Gate new submissions without discarding an existing tracked request or its recovery UI. */
  sourceState?: ModuleDataState
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
 * history instead of failing the call. Tracked imports show this exact submission; legacy
 * callbacks open entity-scoped history without guessing which job belongs to the file.
 */
export function CsvImportModal({
  onClose,
  config,
  isPending = false,
  onImport,
  columns,
  templateFileName = "import-template.csv",
  organizationId,
  companyId,
  tableName,
  trackedImport,
  abandonedAccountingCleanup,
  fileReader,
  sourceState,
}: CsvImportModalProps) {
  const { t } = useTranslation()
  const [fileName, setFileName] = useState("")
  const [csvText, setCsvText] = useState("")
  const [analysis, setAnalysis] = useState<CsvImportAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [request, setRequest] = useState<CsvImportRequest | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [fileScope, setFileScope] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)
  const fileReadId = useRef(0)
  const trackedMutation = useTrackedCsvImport()
  const trackSubmission = trackedImport && tableName && supportsTrackedCsvImport(tableName)
  const sourceReady = sourceState === undefined || sourceState.status === "ready"
  const sourceReadyRef = useRef(sourceReady)
  sourceReadyRef.current = sourceReady
  const scope = `${organizationId ?? ""}:${trackedImport?.companyId ?? companyId ?? ""}:${tableName ?? ""}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  const sourceScopeChanged = fileScope != null && fileScope !== scope
  const review = useMemo(() => csvText ? accountingImportReview(csvText, tableName) : null, [csvText, tableName])
  const canSubmit = sourceReady && canSubmitCsvImport(analysis) && !sourceScopeChanged && (!review || (reviewed && !review.issues.length))

  const handleFile = async (file: File | undefined) => {
    if (!sourceReadyRef.current || busy || submitted || request) return
    const readId = ++fileReadId.current
    const selectedScope = scope
    setError(null)
    setAnalysis(null)
    setCsvText("")
    setFileName(file?.name ?? "")
    setReviewed(false)
    setFileScope(selectedScope)
    setIsReading(Boolean(file))
    if (!file) return
    try {
      const text = fileReader ? (await fileReader(file)).csvText : await file.text()
      if (!sourceReadyRef.current || readId !== fileReadId.current || selectedScope !== currentScope.current) return
      setAnalysis(analyzeCsv(text, columns))
      setCsvText(text)
    } catch (cause) {
      if (!sourceReadyRef.current || readId !== fileReadId.current || selectedScope !== currentScope.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (readId === fileReadId.current) setIsReading(false)
    }
  }

  const handleSubmit = async () => {
    if (!sourceReadyRef.current || !canSubmit || busy || submitted || request) return
    setError(null)
    setIsSubmitting(true)
    try {
      if (trackSubmission) {
        if (!organizationId || !tableName) throw new Error("Tracked import requires organization and entity scope")
        const next = request ?? createCsvImportRequest(organizationId, tableName, csvText, fileName, trackedImport)
        setRequest(next)
        setSubmitted(true)
        await trackedMutation.mutateAsync(next)
      } else await onImport(csvText)
      showWorkflowToast({
        kind: "info",
        title: t("common.csvImportDialog.success", { defaultValue: "Import submitted" }),
        description: t("common.csvImportDialog.successDescription", {
          defaultValue: trackSubmission
            ? "{{count}} rows from {{file}} were sent. This submission’s results appear below."
            : "{{count}} rows from {{file}} were sent. Rows the server rejects are listed in the import job history.",
          count: analysis?.rowCount ?? 0,
          file: fileName,
        }),
      })
      if (organizationId && organizationId > 0n) setSubmitted(true)
      else onClose()
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

  const busy = isPending || isSubmitting || trackedMutation.isPending || isReading

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          {config.description ? <DialogDescription>{config.description}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-4">
          <ModuleDataNotice state={sourceState} />
          {sourceState?.status === "loading" ? <p role="status" className="text-sm text-muted-foreground">{t("common.loading", { defaultValue: "Loading…" })}</p> : null}
          {request ? <CsvImportResult request={request} initialPending={isSubmitting} initialError={error} activeOrganizationId={organizationId} activeCompanyId={trackedImport?.companyId ?? companyId} onNewFile={() => {
            if (!sourceReadyRef.current || busy) return
            setRequest(null); setSubmitted(false); setError(null); setAnalysis(null); setCsvText(""); setFileName(""); setReviewed(false); setFileScope(null)
          }} /> : sourceReady && organizationId && (submitted || abandonedAccountingCleanup) ? (
            <CsvImportHistory
              organizationId={organizationId}
              tableName={tableName}
              abandonedAccountingCleanup={abandonedAccountingCleanup}
            />
          ) : null}
          {!submitted ? <>
          {sourceScopeChanged ? <p role="alert" className="text-sm text-destructive">{t("accounting.importReview.scopeChanged", { defaultValue: "The organization, company or import target changed. Select and review the source file again before importing." })}</p> : null}
          {trackedImport && !trackSubmission ? <p className="text-sm text-muted-foreground">{t("common.csvImportDialog.manualResultNotice", { defaultValue: "This import uses manual history selection. Its results cannot yet be linked automatically to this file." })}</p> : null}
          <div className="space-y-2">
            <Label htmlFor="csv-import-file">
              {fileReader
                ? t("common.csvImportDialog.spreadsheetFileLabel", {
                    defaultValue: "CSV or Excel file",
                  })
                : t("common.csvImportDialog.fileLabel", { defaultValue: "CSV file" })}
            </Label>
            <Input
              id="csv-import-file"
              type="file"
              accept={
                fileReader
                  ? ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  : ".csv,text/csv,text/plain"
              }
              disabled={busy || !sourceReady}
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

          {analysis && sourceReady ? (
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
              {review && !sourceScopeChanged ? <AccountingImportReview review={review} reviewed={reviewed} onReviewedChange={setReviewed} /> : null}
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

          </> : null}
          {error && !request && sourceReady ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {submitted ? t("common.close", { defaultValue: "Close" }) : config.cancelLabel ?? t("common.cancel")}
          </Button>
          {!submitted ? <Button type="button" disabled={busy || !canSubmit} onClick={() => void handleSubmit()}>
            {config.submitLabel ?? t("common.csvImportDialog.submit", { defaultValue: "Import" })}
          </Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
