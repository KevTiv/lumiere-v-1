"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  assertCsvSafeForAi,
  buildCanonicalCsv,
  parseCsvText,
  type CsvSafetyReport,
} from "@lumiere/erp-shared"
import type { ImportBundleDefinition } from "@lumiere/erp-shared/csv-import-bundles"
import {
  buildBundleLineCsv,
  buildBundleParentCsv,
  detectParentLinkSourceColumn,
  splitImportBundleCsv,
} from "@lumiere/erp-shared/csv-import-bundles"
import {
  buildRetryFileName,
  filterRowsForRetry,
  uniqueFailedRowNumbers,
  type ImportRetryContext,
} from "@lumiere/erp-shared/csv-import-retry"
import {
  useAnalyzeImportMapping,
  usePreviewImportMapping,
  type ImportAnalyzeResponse,
  type ImportPreviewResponse,
} from "@lumiere/query-hooks/hooks/ai-import-mapping"
import {
  errorsForJob,
  findLatestImportJob,
  useImportJobErrors,
  useImportJobs,
  type ImportJobErrorRow,
  type ImportJobRow,
} from "@lumiere/query-hooks/hooks/import-jobs"
import {
  templatesForEntity,
  useDeleteImportMappingTemplate,
  useFinalizeImportAssistantJob,
  useImportMappingTemplates,
  useSaveImportMappingTemplate,
  type ImportMappingTemplateRow,
} from "@lumiere/query-hooks/hooks/import-mapping-templates"
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react"

import { Badge } from "../components/badge"
import { Button } from "../components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/dialog"
import { Input } from "../components/input"
import { Label } from "../components/label"
import { ImportJobStatusPanel } from "./import-job-status-panel"
import {
  headersForMapping,
  ImportMappingTable,
  lineAnalysisFromBundle,
  mappingRecordFromAnalysis,
  mappingRecordFromLineBundle,
} from "./import-mapping-table"
import { ImportPreviewGrid } from "./import-preview-grid"
import {
  ImportTemplateControls,
  priorMappingsFromTemplate,
  selectedTemplateRow,
} from "./import-template-controls"

type WizardStep = "upload" | "map" | "preview" | "done"

export type ImportAssistantWizardProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: number
  targetEntity: string
  importJobTableName?: string
  title: string
  onImport: (csvData: string) => Promise<void>
  isImportPending?: boolean
  importBundle?: ImportBundleDefinition
  onImportLines?: (lineCsv: string) => Promise<void>
  resolveOrderIds?: (refs: string[]) => Promise<Map<string, string>>
  initialRetry?: ImportRetryContext | null
  onSuccess?: (args: {
    fileName: string
    rowCount: number
    mapping: Record<string, string>
  }) => void
}

export function ImportAssistantWizard({
  open,
  onOpenChange,
  organizationId,
  targetEntity,
  importJobTableName,
  title,
  onImport,
  isImportPending = false,
  importBundle,
  onImportLines,
  resolveOrderIds,
  initialRetry = null,
  onSuccess,
}: ImportAssistantWizardProps) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const analyze = useAnalyzeImportMapping()
  const preview = usePreviewImportMapping()
  const saveTemplate = useSaveImportMappingTemplate(orgId)
  const deleteTemplate = useDeleteImportMappingTemplate(orgId)
  const finalizeJob = useFinalizeImportAssistantJob(orgId)
  const templatesQuery = useImportMappingTemplates(orgId, open)
  const jobTable = importJobTableName ?? targetEntity

  const [step, setStep] = useState<WizardStep>("upload")
  const [fileName, setFileName] = useState("")
  const [csvText, setCsvText] = useState("")
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [safety, setSafety] = useState<CsvSafetyReport | null>(null)
  const [analysis, setAnalysis] = useState<ImportAnalyzeResponse | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [lineMapping, setLineMapping] = useState<Record<string, string>>({})
  const [previewResult, setPreviewResult] = useState<ImportPreviewResponse | null>(null)
  const [linePreviewResult, setLinePreviewResult] = useState<ImportPreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRetrySession, setIsRetrySession] = useState(false)
  const [trackJobs, setTrackJobs] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [templateSaveName, setTemplateSaveName] = useState("")
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null)
  const finalizedJobIdRef = useRef<string | null>(null)

  const entityTemplates = templatesForEntity(
    (templatesQuery.data ?? []) as ImportMappingTemplateRow[],
    targetEntity,
  )
  const selectedTemplate = selectedTemplateRow(entityTemplates, selectedTemplateId)
  const bundleActive = Boolean(importBundle && analysis?.bundle)
  const lineAnalysis = analysis ? lineAnalysisFromBundle(analysis) : null
  const parentHeaders = headersForMapping(headers, mapping)
  const lineHeaders = headersForMapping(headers, lineMapping)

  const jobsQuery = useImportJobs(orgId, trackJobs && step === "done")
  const errorsQuery = useImportJobErrors(orgId, trackJobs && step === "done")
  const latestJob = findLatestImportJob(jobsQuery.data as ImportJobRow[] | undefined, jobTable)
  const jobErrors = errorsForJob((errorsQuery.data ?? []) as ImportJobErrorRow[], latestJob)
  const failedRowNumbers = uniqueFailedRowNumbers(jobErrors)

  const reset = useCallback(() => {
    setStep("upload")
    setFileName("")
    setCsvText("")
    setHeaders([])
    setRows([])
    setSafety(null)
    setAnalysis(null)
    setMapping({})
    setLineMapping({})
    setPreviewResult(null)
    setLinePreviewResult(null)
    setError(null)
    setIsRetrySession(false)
    setTrackJobs(false)
    setSelectedTemplateId(null)
    setTemplateSaveName("")
    setAppliedTemplateId(null)
    finalizedJobIdRef.current = null
    analyze.reset()
    preview.reset()
  }, [analyze, preview])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const finalizeAssistantJob = useCallback(
    async (job: ImportJobRow | undefined) => {
      if (!job?.id) return
      try {
        await finalizeJob.mutateAsync({
          jobId: BigInt(String(job.id)),
          templateId: appliedTemplateId != null ? BigInt(appliedTemplateId) : null,
          metadata: {
            ai_assisted: true,
            column_mapping: mapping,
            ...(bundleActive ? { line_mapping: lineMapping, bundle_key: importBundle?.key } : {}),
            template_id: appliedTemplateId,
            file_name: fileName,
            target_entity: targetEntity,
            ...(isRetrySession ? { import_retry: true } : {}),
          },
        })
      } catch {
        // Non-blocking: import already succeeded; metadata is best-effort.
      }
    },
    [appliedTemplateId, bundleActive, fileName, finalizeJob, importBundle?.key, isRetrySession, lineMapping, mapping, targetEntity],
  )

  useEffect(() => {
    if (step !== "done" || !latestJob?.id) return
    const jobId = String(latestJob.id)
    if (finalizedJobIdRef.current === jobId) return
    finalizedJobIdRef.current = jobId
    void finalizeAssistantJob(latestJob)
  }, [step, latestJob, finalizeAssistantJob])

  const handleFileChange = async (file: File | undefined) => {
    setError(null)
    setPreviewResult(null)
    setAnalysis(null)
    if (!file) return

    try {
      const text = await file.text()
      const parsed = parseCsvText(text)
      const report = assertCsvSafeForAi(parsed.headers, parsed.rows.slice(0, 50))
      setFileName(file.name)
      setCsvText(text)
      setHeaders(parsed.headers)
      setRows(parsed.rows)
      setSafety(report)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setFileName("")
      setCsvText("")
      setHeaders([])
      setRows([])
      setSafety(null)
    }
  }

  useEffect(() => {
    if (!open || !initialRetry) return
    setFileName(initialRetry.fileName)
    setHeaders(initialRetry.headers)
    setRows(initialRetry.rows)
    setMapping(initialRetry.mapping)
    setLineMapping(initialRetry.lineMapping ?? {})
    setAppliedTemplateId(initialRetry.appliedTemplateId ?? null)
    setIsRetrySession(true)
    setStep("map")
    setAnalysis({
      target_entity: targetEntity,
      mappings: Object.entries(initialRetry.mapping).map(([source_column, target_field]) => ({
        source_column,
        target_field,
        confidence: 1,
        required: false,
      })),
      unmapped_source_columns: [],
      unmapped_target_fields: [],
      metadata_suggestions: [],
      structure: {
        column_count: initialRetry.headers.length,
        sample_row_count: initialRetry.rows.length,
        duplicate_headers: [],
        empty_columns: [],
        delimiter_hint: ",",
      },
      safety: { findings: [], blocked_cell_count: 0, is_safe_for_ai: true },
      warnings: [],
      bundle: initialRetry.lineMapping
        ? {
            key: importBundle?.key ?? "sale_order_bundle",
            line_entity: importBundle?.lineEntity ?? "sale_order_line",
            line_mappings: Object.entries(initialRetry.lineMapping).map(
              ([source_column, target_field]) => ({
                source_column,
                target_field,
                confidence: 1,
                required: false,
              }),
            ),
            line_unmapped_target_fields: [],
            suggested_parent_link_source: null,
          }
        : null,
    })
  }, [open, initialRetry, importBundle?.key, importBundle?.lineEntity, targetEntity])

  const runAnalyze = async () => {
    setError(null)
    setPreviewResult(null)
    setAppliedTemplateId(selectedTemplateId)
    try {
      const priorMappings = priorMappingsFromTemplate(selectedTemplate)
      const result = await analyze.mutateAsync({
        targetEntity,
        headers,
        sampleRows: rows.slice(0, 50),
        csvText,
        ...(priorMappings ? { priorMappings } : {}),
        ...(importBundle ? { bundleKey: importBundle.key } : {}),
      })
      setAnalysis(result)
      setMapping(mappingRecordFromAnalysis(result))
      setLineMapping(mappingRecordFromLineBundle(result))
      setStep("map")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleSaveTemplate = async () => {
    setError(null)
    try {
      await saveTemplate.mutateAsync({
        name: templateSaveName.trim(),
        tableName: targetEntity,
        mapping,
      })
      setTemplateSaveName("")
      void templatesQuery.refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId) return
    setError(null)
    try {
      await deleteTemplate.mutateAsync(BigInt(selectedTemplateId))
      setSelectedTemplateId(null)
      setAppliedTemplateId(null)
      void templatesQuery.refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runPreview = async () => {
    setError(null)
    try {
      const result = await preview.mutateAsync({
        targetEntity,
        headers,
        rows,
        mapping,
        maxRows: 25,
      })
      setPreviewResult(result)
      if (bundleActive && lineAnalysis && Object.keys(lineMapping).length > 0) {
        const lineResult = await preview.mutateAsync({
          targetEntity: lineAnalysis.target_entity,
          headers,
          rows,
          mapping: lineMapping,
          maxRows: 25,
        })
        setLinePreviewResult(lineResult)
      } else {
        setLinePreviewResult(null)
      }
      setStep("preview")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runImport = async () => {
    setError(null)
    try {
      if (bundleActive && importBundle && onImportLines && Object.keys(lineMapping).length > 0) {
        const linkColumn =
          detectParentLinkSourceColumn(headers, mapping, importBundle) ??
          analysis?.bundle?.suggested_parent_link_source ??
          undefined
        if (!linkColumn) {
          throw new Error(t("common.importAssistant.bundleLinkRequired"))
        }
        const split = splitImportBundleCsv({
          headers,
          rows,
          parentMapping: mapping,
          lineMapping,
          parentLinkSourceColumn: linkColumn,
        })
        const parentCsv = buildBundleParentCsv(split.parentHeaders, split.parentRows, mapping)
        await onImport(parentCsv)
        const orderIdByRef = resolveOrderIds
          ? await resolveOrderIds(split.parentLinkValues)
          : new Map<string, string>()
        const lineCsv = buildBundleLineCsv(
          headers,
          split.lineRows,
          lineMapping,
          orderIdByRef,
          importBundle,
        )
        if (lineCsv.trim().split("\n").length > 1) {
          await onImportLines(lineCsv)
        }
      } else {
        const canonical = buildCanonicalCsv(headers, rows, mapping)
        await onImport(canonical)
      }
      setTrackJobs(true)
      setStep("done")
      onSuccess?.({ fileName, rowCount: rows.length, mapping })
      void jobsQuery.refetch()
      void errorsQuery.refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleRetryFailedRows = () => {
    if (!failedRowNumbers.length) return
    const filtered = filterRowsForRetry(headers, rows, failedRowNumbers)
    setRows(filtered.rows)
    setFileName(buildRetryFileName(fileName))
    setPreviewResult(null)
    setLinePreviewResult(null)
    setIsRetrySession(true)
    setTrackJobs(false)
    finalizedJobIdRef.current = null
    setStep("map")
  }

  const previewErrors = previewResult?.validation_errors.filter((item) => item.severity === "error") ?? []
  const linePreviewErrors =
    linePreviewResult?.validation_errors.filter((item) => item.severity === "error") ?? []
  const canImport =
    previewErrors.length === 0 &&
    linePreviewErrors.length === 0 &&
    !isImportPending &&
    !preview.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("common.importAssistant.description")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant={step === "upload" ? "default" : "outline"}>
              1. {t("common.importAssistant.stepUpload")}
            </Badge>
            <Badge variant={step === "map" ? "default" : "outline"}>
              2. {t("common.importAssistant.stepMap")}
            </Badge>
            <Badge variant={step === "preview" ? "default" : "outline"}>
              3. {t("common.importAssistant.stepPreview")}
            </Badge>
            <Badge variant={step === "done" ? "default" : "outline"}>
              4. {t("common.importAssistant.stepDone")}
            </Badge>
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {isRetrySession && step !== "done" ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
              {t("common.importAssistant.retrySessionHint", { count: rows.length })}
            </div>
          ) : null}

          {step === "upload" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="import-assistant-file">{t("common.csvImport.fileLabel")}</Label>
                <Input
                  id="import-assistant-file"
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={(e) => void handleFileChange(e.target.files?.[0])}
                />
              </div>
              {fileName ? (
                <div className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">{fileName}</p>
                  <p className="text-muted-foreground">
                    {t("common.importAssistant.structureSummary", {
                      columns: headers.length,
                      rows: rows.length,
                    })}
                  </p>
                  {safety?.isSafeForAi ? (
                    <p className="mt-2 flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" />
                      {t("common.importAssistant.safetyPassed")}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                  <Upload className="h-4 w-4" />
                  {t("common.importAssistant.uploadHint")}
                </div>
              )}
              {entityTemplates.length > 0 || templatesQuery.isLoading ? (
                <ImportTemplateControls
                  templates={entityTemplates}
                  selectedTemplateId={selectedTemplateId}
                  onSelectedTemplateChange={setSelectedTemplateId}
                  saveName={templateSaveName}
                  onSaveNameChange={setTemplateSaveName}
                  onSaveTemplate={() => void handleSaveTemplate()}
                  onDeleteTemplate={() => void handleDeleteTemplate()}
                  isSaving={saveTemplate.isPending}
                  isDeleting={deleteTemplate.isPending}
                  showLoad
                  showSave={false}
                />
              ) : null}
            </div>
          ) : null}

          {step === "map" && analysis ? (
            <div className="space-y-4">
              {bundleActive ? (
                <p className="text-sm text-muted-foreground">
                  {t("common.importAssistant.bundleModeHint")}
                </p>
              ) : null}
              <ImportMappingTable
                headers={parentHeaders.length ? parentHeaders : headers}
                analysis={analysis}
                mapping={mapping}
                onMappingChange={setMapping}
              />
              {bundleActive && lineAnalysis ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("common.importAssistant.lineMappingTitle")}</p>
                  <ImportMappingTable
                    headers={lineHeaders.length ? lineHeaders : headers}
                    analysis={lineAnalysis}
                    mapping={lineMapping}
                    onMappingChange={setLineMapping}
                  />
                </div>
              ) : null}
              <ImportTemplateControls
                templates={entityTemplates}
                selectedTemplateId={selectedTemplateId}
                onSelectedTemplateChange={setSelectedTemplateId}
                saveName={templateSaveName}
                onSaveNameChange={setTemplateSaveName}
                onSaveTemplate={() => void handleSaveTemplate()}
                onDeleteTemplate={() => void handleDeleteTemplate()}
                isSaving={saveTemplate.isPending}
                isDeleting={deleteTemplate.isPending}
                showLoad={false}
                showSave
              />
            </div>
          ) : null}

          {step === "preview" && previewResult ? (
            <div className="space-y-4">
              <ImportPreviewGrid preview={previewResult} />
              {linePreviewResult ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("common.importAssistant.linePreviewTitle")}</p>
                  <ImportPreviewGrid preview={linePreviewResult} />
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "done" ? (
            <ImportJobStatusPanel
              job={latestJob}
              errors={(errorsQuery.data ?? []) as ImportJobErrorRow[]}
              isLoading={jobsQuery.isLoading || String(latestJob?.status ?? "") === "pending"}
              fileName={fileName}
              onRetryFailedRows={handleRetryFailedRows}
              retryRowCount={failedRowNumbers.length}
            />
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {t("common.importAssistant.targetEntity")}: <code>{targetEntity}</code>
            {bundleActive ? (
              <>
                {" · "}
                {t("common.importAssistant.bundleActive")}
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {step !== "upload" && step !== "done" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(step === "preview" ? "map" : "upload")}
                disabled={analyze.isPending || preview.isPending || isImportPending}
              >
                {t("common.back")}
              </Button>
            ) : null}

            {step === "upload" ? (
              <Button
                type="button"
                onClick={() => void runAnalyze()}
                disabled={!csvText || analyze.isPending || !!error}
              >
                {analyze.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("common.importAssistant.analyzing")}
                  </>
                ) : (
                  t("common.importAssistant.analyze")
                )}
              </Button>
            ) : null}

            {step === "map" ? (
              <Button type="button" onClick={() => void runPreview()} disabled={preview.isPending}>
                {preview.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("common.importAssistant.previewing")}
                  </>
                ) : (
                  t("common.importAssistant.preview")
                )}
              </Button>
            ) : null}

            {step === "preview" ? (
              <Button type="button" onClick={() => void runImport()} disabled={!canImport}>
                {isImportPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("common.csvImport.submit")}
                  </>
                ) : (
                  t("common.importAssistant.confirmImport")
                )}
              </Button>
            ) : null}

            {step === "done" ? (
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
