"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { useWorkspaceProfile } from "@lumiere/ui/lib/workspace-profile-context"
import { isWorkspaceImportTargetVisible } from "@lumiere/ui/lib/workspace-profile"
import { useTranslation } from "@lumiere/i18n"
import { assertCsvSafeForAi, parseCsvText } from "@lumiere/erp-shared/csv-import-safety"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useTrackedCsvImport } from "@lumiere/query-hooks/hooks/tracked-csv-import"
import { csvImportInvalidatesQuery, fetchCsvImportReceipt, type CsvImportRequest } from "@lumiere/query-hooks/hooks/csv-import-request"
import { guidedImportRequest, trackedImportEntity } from "./guided-import-request"
import { previewPreparedProducts, type ProductImportReference } from "./prepared-product-preview"
import { useProductCategories } from "@lumiere/query-hooks/hooks/inventory/products"
import { useUoms } from "@lumiere/query-hooks/hooks/inventory/uom"
import { useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api-fetch"
import { REVIEW_TARGETS, reviewDatasetFromCsv, type ReviewedImportSource } from "./import-review-model"
import {
  useAnalyzeImportMapping,
  usePreviewImportMapping,
  type ImportAnalyzeResponse,
  type ImportPreviewResponse,
} from "@lumiere/query-hooks/hooks/ai-import-mapping"
import { useContacts } from "@lumiere/query-hooks/hooks/crm"
import { useProducts } from "@lumiere/query-hooks/hooks/inventory"
import {
  templatesForEntity,
  useDeleteImportMappingTemplate,
  useFinalizeImportAssistantJob,
  useImportMappingTemplates,
  useSaveImportMappingTemplate,
  type ImportMappingTemplateRow,
} from "@lumiere/query-hooks/hooks/import-mapping-templates"
import {
  jobsForEntity,
  useImportJobErrors,
  useImportJobs,
  useRollbackImportJob,
  type ImportJobErrorRow,
  type ImportJobRow,
} from "@lumiere/query-hooks/hooks/import-jobs"
import {
  FormModal,
  ImportJobStatusPanel,
  ImportMappingTable,
  ImportPreviewGrid,
  mappingRecordFromAnalysis,
  priorMappingsFromTemplate,
  selectedTemplateRow,
  type FormConfig,
} from "@lumiere/ui"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { phCapture } from "@/lib/posthog-browser"
import {
  defaultDuplicateActions,
  detectImportDuplicates,
  type ImportDuplicateAction,
  type ImportDuplicateRowState,
} from "@/lib/import-duplicate-detection"
import {
  IMPORT_ENTITY_GROUPS,
  wizardEntitiesForGroup,
  wizardEntityByKey,
  type ImportEntityOption,
} from "@/lib/import-entities"
import {
  buildMappedImportCsv,
  filterMappingForHeaders,
  readImportFile,
} from "@/lib/import-spreadsheet-file"
import { previewAllImportRows } from "@/lib/import-preview-batches"

/** Radix Select cannot use "" as an item value; stands in for "no template". */
const NO_TEMPLATE = "__none__"

type WizardStep = "upload" | "analyze" | "map" | "preview" | "import"

function importJobCount(job: ImportJobRow, camel: keyof ImportJobRow, snake: keyof ImportJobRow) {
  return Number(job[camel] ?? job[snake] ?? 0)
}

export type GuidedImportWizardProps = {
  organizationId: number
  initialSource?: ReviewedImportSource
  onReviewSaved?: (id: string) => void
}

function PreparedProductPreviewButton({ organizationId, disabled, onPreview }: { organizationId: bigint; disabled: boolean; onPreview: (categories: readonly ProductImportReference[], uoms: readonly ProductImportReference[]) => void }) {
  const { t } = useTranslation()
  const categoriesQuery = useProductCategories(organizationId)
  const uomsQuery = useUoms(organizationId)
  return <div className="space-y-1">
    <Button type="button" variant="outline" disabled={disabled || categoriesQuery.isFetching || uomsQuery.isFetching} onClick={() => onPreview(categoriesQuery.data ?? [], uomsQuery.data ?? [])}>{t("settings.import.preparedProducts", { defaultValue: "Preview prepared product CSV" })}</Button>
    <p className="text-xs text-muted-foreground">{t("settings.import.preparedProductsHint", { defaultValue: "Use exact CSV headers and explicit prices and units. No AI request is made. Uncertain rows can be saved for review." })}</p>
  </div>
}

export function GuidedImportWizard({ organizationId, initialSource, onReviewSaved }: GuidedImportWizardProps) {
  const { t } = useTranslation()
  const workspaceProfile = useWorkspaceProfile()
  const orgId = BigInt(organizationId)
  const companyId = useOperatingCompanyId(organizationId)
  const companiesQuery = useCompanies(organizationId, organizationId > 0)
  const trackedImport = useTrackedCsvImport()
  const queryClient = useQueryClient()
  const initialParsed = useMemo(() => initialSource ? parseCsvText(initialSource.csv) : null, [initialSource])

  const analyze = useAnalyzeImportMapping()
  const preview = usePreviewImportMapping()
  const saveTemplate = useSaveImportMappingTemplate(orgId)
  const deleteTemplate = useDeleteImportMappingTemplate(orgId)
  const finalizeImport = useFinalizeImportAssistantJob(orgId)
  const rollbackImport = useRollbackImportJob(orgId)
  const templatesQuery = useImportMappingTemplates(orgId)
  const importJobsQuery = useImportJobs(orgId)
  const contactsQuery = useContacts(orgId)
  const productsQuery = useProducts(orgId)

  const [wizardKey, setWizardKey] = useState(initialSource?.targetEntity ?? "contact")
  const [step, setStep] = useState<WizardStep>("upload")
  const [csvText, setCsvText] = useState(initialSource?.csv ?? "")
  const [headers, setHeaders] = useState<string[]>(initialParsed?.headers ?? [])
  const [rows, setRows] = useState<string[][]>(initialParsed?.rows ?? [])
  const [sourceFileName, setSourceFileName] = useState(initialSource?.fileName ?? "")
  const [sourceFormat, setSourceFormat] = useState<"csv" | "xlsx">("csv")
  const [sourceSheetName, setSourceSheetName] = useState<string | undefined>()
  const [analysis, setAnalysis] = useState<ImportAnalyzeResponse | null>(null)
  const [preparedPreview, setPreparedPreview] = useState(false)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [previewResult, setPreviewResult] = useState<ImportPreviewResponse | null>(null)
  const [duplicateStates, setDuplicateStates] = useState<ImportDuplicateRowState[]>([])
  const [confirmImportWithErrors, setConfirmImportWithErrors] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [importedJobId, setImportedJobId] = useState<string | null>(null)
  const [importRequest, setImportRequest] = useState<CsvImportRequest | null>(null)
  const importRequestRef = useRef<CsvImportRequest | null>(null)
  const [rollbackConfirmId, setRollbackConfirmId] = useState<string | null>(null)
  const importErrorsQuery = useImportJobErrors(orgId, importedJobId != null)

  const entityOption = wizardEntityByKey(wizardKey) ?? wizardEntityByKey("contact")!
  const targetEntity = entityOption.tableName

  const entityTemplates = templatesForEntity(
    (templatesQuery.data ?? []) as ImportMappingTemplateRow[],
    targetEntity,
  )
  const selectedTemplate = selectedTemplateRow(entityTemplates, selectedTemplateId)
  const entityJobs = useMemo(
    () =>
      jobsForEntity(
        (importJobsQuery.data ?? []) as unknown as ImportJobRow[],
        trackedImportEntity(targetEntity),
        5,
      ),
    [importJobsQuery.data, targetEntity],
  )
  const activeJob = useMemo(
    () =>
      importedJobId
        ? ((importJobsQuery.data ?? []) as unknown as ImportJobRow[]).find(
            (job) => String(job.id ?? "") === importedJobId,
          )
        : undefined,
    [importJobsQuery.data, importedJobId],
  )

  const stepLabel = useMemo(() => {
    const labels: Record<WizardStep, string> = {
      upload: t("settings.import.stepUpload", "1. Upload file"),
      analyze: t("settings.import.stepAnalyze", "2. Analyze columns"),
      map: t("settings.import.stepMap", "3. Map columns"),
      preview: t("settings.import.stepPreview", "4. Preview"),
      import: t("settings.import.stepImport", "5. Import"),
    }
    return labels[step]
  }, [step, t])

  const templateSaveFormConfig = useMemo<FormConfig>(
    () => ({
      id: "guided-import-template-save",
      title: t("settings.import.saveTemplateTitle", "Save mapping template"),
      description: t(
        "settings.import.saveTemplateDescription",
        "Save the current column mapping for reuse on future imports.",
      ),
      size: "md",
      icon: "BookmarkPlus",
      submitLabel: t("settings.import.saveTemplate", "Save template"),
      cancelLabel: t("common.cancel", "Cancel"),
      sections: [
        {
          id: "template-meta",
          fields: [
            {
              type: "text",
              id: "name",
              name: "name",
              label: t("settings.import.templateName", "Template name"),
              placeholder: t("settings.import.templateNamePlaceholder", "e.g. HubSpot contacts"),
              required: true,
              width: "full",
            },
            {
              type: "text",
              id: "entity",
              name: "entity",
              label: t("settings.import.entity", "Entity"),
              defaultValue: entityOption.label,
              disabled: true,
              width: "full",
            },
          ],
        },
      ],
    }),
    [entityOption.label, t],
  )

  const resetFlow = useCallback(() => {
    setStep("upload")
    setAnalysis(null)
    setPreparedPreview(false)
    setMapping({})
    setPreviewResult(null)
    setDuplicateStates([])
    setConfirmImportWithErrors(false)
    setStatus(null)
    setError(null)
    setSelectedTemplateId(null)
    setAppliedTemplateId(null)
    setImportedJobId(null)
    setImportRequest(null)
    importRequestRef.current = null
    setRollbackConfirmId(null)
    analyze.reset()
    preview.reset()
  }, [analyze, preview])

  const onEntityChange = useCallback(
    (nextKey: string) => {
      if (importRequestRef.current) return
      if (!isWorkspaceImportTargetVisible(workspaceProfile, nextKey)) return
      setWizardKey(nextKey)
      resetFlow()
      setCsvText("")
      setHeaders([])
      setRows([])
      setSourceFileName("")
      setSourceFormat("csv")
      setSourceSheetName(undefined)
    },
    [resetFlow, workspaceProfile],
  )

  const onFile = useCallback(
    async (file: File | null) => {
      if (!file || importRequestRef.current) return
      const templateId = selectedTemplateId
      setError(null)
      resetFlow()
      setSelectedTemplateId(templateId)
      try {
        const parsed = await readImportFile(file)
        if (importRequestRef.current) return
        assertCsvSafeForAi(parsed.headers, parsed.rows.slice(0, 50))
        setCsvText(parsed.csvText)
        setHeaders(parsed.headers)
        setRows(parsed.rows)
        setSourceFileName(file.name)
        setSourceFormat(parsed.format)
        setSourceSheetName(parsed.sheetName)
        setStep("upload")
      } catch (e) {
        if (importRequestRef.current) return
        setError(e instanceof Error ? e.message : String(e))
        setCsvText("")
        setHeaders([])
        setRows([])
        setSourceFileName("")
        setSourceSheetName(undefined)
      }
    },
    [resetFlow, selectedTemplateId],
  )

  const applyTemplateMapping = useCallback(
    (templateId: string | null) => {
      if (!templateId || !analysis) return
      const template = selectedTemplateRow(entityTemplates, templateId)
      const prior = priorMappingsFromTemplate(template)
      if (!prior) return
      const compatible = filterMappingForHeaders(prior, headers)
      setMapping(compatible)
      setAppliedTemplateId(templateId)
      setStatus(
        t("settings.import.templateApplied", "Applied {{count}} saved column mappings.", {
          count: Object.keys(compatible).length,
        }),
      )
    },
    [analysis, entityTemplates, headers, t],
  )

  const runAnalyze = useCallback(async () => {
    if (!csvText.trim()) return
    setError(null)
    setStatus(null)
    setPreviewResult(null)
    setPreparedPreview(false)
    setDuplicateStates([])
    setStep("analyze")
    try {
      const priorMappings = filterMappingForHeaders(
        priorMappingsFromTemplate(selectedTemplate) ?? {},
        headers,
      )
      const result = await analyze.mutateAsync({
        targetEntity,
        headers,
        sampleRows: rows.slice(0, 50),
        csvText,
        ...(Object.keys(priorMappings).length > 0 ? { priorMappings } : {}),
      })
      setAnalysis(result)
      setAppliedTemplateId(Object.keys(priorMappings).length > 0 ? selectedTemplateId : null)
      setMapping(
        Object.keys(priorMappings).length > 0
          ? priorMappings
          : mappingRecordFromAnalysis(result),
      )
      setStep("map")
      phCapture("ai_import_analyzed", {
        entity: targetEntity,
        mapped_columns: result.mappings.length,
      })
      setStatus(t("settings.import.analyzed", "Column mapping suggested — review and continue."))
    } catch (e) {
      setStep("upload")
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [analyze, csvText, headers, rows, selectedTemplate, selectedTemplateId, targetEntity, t])

  const runPreparedPreview = (categories: readonly ProductImportReference[], uoms: readonly ProductImportReference[]) => {
    setError(null); setStatus(null); setConfirmImportWithErrors(false)
    try {
      const result = previewPreparedProducts({ csv: csvText, organizationId, categories, uoms })
      setAnalysis(result.analysis); setMapping(result.mapping); setPreviewResult(result.preview)
      setAppliedTemplateId(null); setPreparedPreview(true)
      setDuplicateStates(defaultDuplicateActions(detectImportDuplicates({ entity: entityOption, previewRows: result.preview.rows, mapping: result.mapping, products: productsQuery.data ?? [] })))
      setStep("preview")
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }

  const runPreview = useCallback(async () => {
    if (!csvText.trim() || Object.keys(mapping).length === 0) return
    setError(null)
    setStatus(null)
    setConfirmImportWithErrors(false)
    try {
      const result = await previewAllImportRows(
        { targetEntity, headers, rows, mapping },
        (batch) => preview.mutateAsync(batch),
      )
      setPreviewResult(result)
      const duplicates = detectImportDuplicates({
        entity: entityOption,
        previewRows: result.rows,
        mapping,
        contacts: (contactsQuery.data ?? []) as Record<string, unknown>[],
        products: (productsQuery.data ?? []) as Record<string, unknown>[],
      })
      setDuplicateStates(defaultDuplicateActions(duplicates))
      setStep("preview")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [contactsQuery.data, csvText, entityOption, headers, mapping, preview, productsQuery.data, rows, targetEntity])

  const previewErrors = useMemo(
    () => (previewResult?.validation_errors ?? []).filter((item) => item.severity === "error"),
    [previewResult],
  )
  const previewWarnings = previewResult?.warnings.length ?? 0
  const saveForReview = async () => {
    if (!companyId || !previewResult || busy) return
    setBusy(true); setError(null)
    try {
      const dataset = await reviewDatasetFromCsv({ title: sourceFileName || entityOption.label, targetEntity, fileName: sourceFileName || "source.csv", csv: csvText, headers, rows, mapping, requiredFields: analysis?.mappings.filter(item => item.required).map(item => item.target_field) ?? [], issues: previewResult.validation_errors })
      const response = await apiFetch("/api/import-reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, dataset }) })
      const result = await response.json()
      if (!response.ok || typeof result.id !== "string") throw new Error(result.error ?? "Source review could not be saved.")
      await queryClient.invalidateQueries({ queryKey: ["import-reviews", organizationId, companyId] })
      onReviewSaved?.(result.id)
      resetFlow(); setCsvText(""); setHeaders([]); setRows([]); setSourceFileName("")
      setStatus(t("settings.importReview.saved", { defaultValue: "Saved as a source draft. Review the uncertain rows below." }))
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const duplicateSkipCount = duplicateStates.filter((item) => item.action === "skip").length
  const mappedColumnCount = Object.values(mapping).filter((value) => value !== "__skip__").length

  const runImport = useCallback(async (lookupOnly = false) => {
    if (!csvText.trim()) return
    if (!companyId) { setError(t("settings.importReview.companyRequired", { defaultValue: "Select an operating company to review source data." })); return }
    if (!previewResult || previewResult.rows.length !== rows.length) {
      setError(
        t(
          "settings.import.fullPreviewRequired",
          "Every source row must pass preview before import. Run preview again.",
        ),
      )
      return
    }
    if (previewErrors.length > 0 && (preparedPreview || !confirmImportWithErrors)) {
      setError(
        t(
          "settings.import.confirmErrorsRequired",
          "Preview has validation errors. Confirm override to import anyway.",
        ),
      )
      return
    }

    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      const skipRows = new Set(
        duplicateStates.filter((item) => item.action === "skip").map((item) => item.rowIndex),
      )
      const importCsv = buildMappedImportCsv(headers, rows, mapping, skipRows)

      const request = importRequestRef.current ?? guidedImportRequest({ organizationId: orgId, companyId, entity: targetEntity, csv: importCsv, fileName: sourceFileName || "source.csv", companies: companiesQuery.data ?? [] })
      importRequestRef.current = request
      setImportRequest(request)
      setStep("import")
      const importJson = lookupOnly ? await fetchCsvImportReceipt(request, apiFetch, true) : await trackedImport.mutateAsync(request)
      await queryClient.invalidateQueries({ predicate: query => csvImportInvalidatesQuery(query.queryKey, request) })
      if (importJson.status === "pending") {
        setStatus(t("settings.importReview.importPending", { defaultValue: "The import is running. Check its result before starting another submission." }))
        return
      }
      const jobId = importJson.jobId
      setImportedJobId(jobId)
      setStep("import")
      setStatus(
        importJson.status === "success" || importJson.status === "partial"
          ? t("settings.importReview.receiptSummary", { defaultValue: "Imported {{count}} rows. {{errors}} rows need correction.", count: importJson.rowsImported, errors: importJson.errorRows })
          : t("settings.importReview.receiptStatus", { defaultValue: "Import status: {{status}}.", status: importJson.status }),
      )

      if (!["success", "partial"].includes(importJson.status)) { await importJobsQuery.refetch(); return }
      try {
        await finalizeImport.mutateAsync({
          jobId: BigInt(jobId),
          templateId: appliedTemplateId ? BigInt(appliedTemplateId) : null,
          metadata: {
            source_file_name: sourceFileName,
            source_format: sourceFormat,
            source_sheet_name: sourceSheetName ?? null,
            source_rows: rows.length,
            previewed_rows: previewResult?.rows.length ?? 0,
            preview_errors: previewErrors.length,
            preview_warnings: previewResult?.warnings.length ?? 0,
            duplicates_skipped: skipRows.size,
            mapping,
          },
        })
      } catch (finalizeError) {
        setError(
          t(
            "settings.import.reconciliationMetadataFailed",
            "The import completed, but its reconciliation details could not be attached: {{message}}",
            {
              message:
                finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
            },
          ),
        )
      }
      await Promise.all([importJobsQuery.refetch(), importErrorsQuery.refetch()])

      phCapture("ai_import_completed", {
        entity: targetEntity,
        rows_imported: importJson.rowsImported ?? 0,
        ai_mapped: true,
        duplicates_skipped: skipRows.size,
        template_id: appliedTemplateId,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [
    appliedTemplateId,
    companiesQuery.data,
    companyId,
    confirmImportWithErrors,
    csvText,
    duplicateStates,
    finalizeImport,
    headers,
    importErrorsQuery,
    importJobsQuery,
    mapping,
    orgId,
    queryClient,
    previewResult,
    previewErrors.length,
    preparedPreview,
    rows,
    sourceFileName,
    sourceFormat,
    sourceSheetName,
    targetEntity,
    trackedImport,
    t,
  ])

  const handleSaveTemplate = useCallback(
    async (data: Record<string, unknown>) => {
      const name = String(data.name ?? "").trim()
      if (!name) throw new Error(t("settings.import.templateNameRequired", "Template name is required"))
      await saveTemplate.mutateAsync({
        name,
        tableName: targetEntity,
        mapping,
        templateId: selectedTemplateId != null ? BigInt(selectedTemplateId) : null,
      })
      setSaveTemplateOpen(false)
      setStatus(t("settings.import.templateSaved", "Mapping template saved."))
    },
    [mapping, saveTemplate, selectedTemplateId, targetEntity, t],
  )

  const handleDeleteTemplate = useCallback(async () => {
    if (!selectedTemplateId) return
    await deleteTemplate.mutateAsync(BigInt(selectedTemplateId))
    setSelectedTemplateId(null)
    setAppliedTemplateId(null)
    setDeleteConfirmOpen(false)
    setStatus(t("settings.import.templateDeleted", "Mapping template deleted."))
  }, [deleteTemplate, selectedTemplateId, t])

  const setDuplicateAction = useCallback((rowIndex: number, action: ImportDuplicateAction) => {
    setDuplicateStates((prev) =>
      prev.map((item) => (item.rowIndex === rowIndex ? { ...item, action } : item)),
    )
  }, [])

  const handleRollback = useCallback(async () => {
    if (!activeJob?.id) return
    const jobId = String(activeJob.id)
    if (rollbackConfirmId !== jobId) {
      setRollbackConfirmId(jobId)
      return
    }
    setError(null)
    try {
      await rollbackImport.mutateAsync(BigInt(jobId))
      setRollbackConfirmId(null)
      setStatus(t("settings.import.rollbackComplete", "Import rolled back."))
      await Promise.all([importJobsQuery.refetch(), importErrorsQuery.refetch()])
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
    }
  }, [activeJob, importErrorsQuery, importJobsQuery, rollbackConfirmId, rollbackImport, t])

  return (
    <div className="rounded-lg border p-4 space-y-4" data-testid="guided-import-wizard">
      <div>
        <h3 className="text-sm font-medium">{t("settings.import.title", "Guided data import")}</h3>
        <p className="text-xs text-muted-foreground">{stepLabel}</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm space-y-1">
          <span className="block text-muted-foreground">{t("settings.import.entity", "Entity")}</span>
          <Select value={wizardKey} onValueChange={onEntityChange} disabled={busy || !!importRequest}>
            <SelectTrigger className="min-w-[200px]" data-testid="guided-import-entity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMPORT_ENTITY_GROUPS.map((group) => {
                const options = wizardEntitiesForGroup(group.key).filter((option) =>
                  isWorkspaceImportTargetVisible(workspaceProfile, option.wizardKey),
                )
                if (options.length === 0) return null
                return (
                  <SelectGroup key={group.key}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {options.map((opt: ImportEntityOption) => (
                      <SelectItem key={opt.wizardKey} value={opt.wizardKey}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
              })}
            </SelectContent>
          </Select>
        </label>

        <label className="text-sm space-y-1">
          <span className="block text-muted-foreground">
            {t("settings.import.savedTemplate", "Saved template")}
          </span>
          <Select
            value={selectedTemplateId ?? NO_TEMPLATE}
            disabled={busy || !!importRequest}
            onValueChange={(value) => {
              const next = value === NO_TEMPLATE ? null : value
              setSelectedTemplateId(next)
              applyTemplateMapping(next)
            }}
          >
            <SelectTrigger className="min-w-[200px]" data-testid="guided-import-template">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TEMPLATE}>{t("settings.import.noTemplate", "— None —")}</SelectItem>
              {entityTemplates.map((row) => (
                <SelectItem key={String(row.id)} value={String(row.id)}>
                  {row.name} ({row.useCount ?? row.use_count ?? 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="text-sm space-y-1">
          <span className="block text-muted-foreground">
            {t("settings.import.file", "CSV or Excel file")}
          </span>
          <input
            type="file"
            disabled={busy || !!importRequest}
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            data-testid="guided-import-file"
          />
        </label>
      </div>

      {sourceFileName ? (
        <div className="rounded border bg-muted/30 p-3 text-sm" data-testid="guided-import-source-summary">
          <span className="font-medium">{sourceFileName}</span>
          <span className="ml-2 text-muted-foreground">
            {sourceFormat.toUpperCase()}
            {sourceSheetName ? ` · ${sourceSheetName}` : ""} · {rows.length}{" "}
            {t("settings.import.dataRows", "data rows")}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(
            "settings.import.fileHint",
            "Use CSV or .xlsx. For older .xls workbooks, save a copy as .xlsx first.",
          )}
        </p>
      )}

      {selectedTemplateId ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleteTemplate.isPending}
          >
            {t("settings.import.deleteTemplate", "Delete template")}
          </Button>
        </div>
      ) : null}

      {step === "map" && analysis ? (
        <div data-testid="guided-import-mapping">
          <div className="mb-3 grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded border p-2">
              <span className="text-muted-foreground">
                {t("settings.import.sourceColumns", "Source columns")}: {headers.length}
              </span>
            </div>
            <div className="rounded border p-2">
              <span className="text-muted-foreground">
                {t("settings.import.mappedColumns", "Mapped columns")}: {mappedColumnCount}
              </span>
            </div>
            <div className="rounded border p-2">
              <span className="text-muted-foreground">
                {t("settings.import.unmappedRequired", "Unmapped target fields")}: {analysis.unmapped_target_fields.length}
              </span>
            </div>
          </div>
          <ImportMappingTable
            headers={headers}
            analysis={analysis}
            mapping={mapping}
            onMappingChange={setMapping}
          />
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSaveTemplateOpen(true)}
              disabled={Object.keys(mapping).length === 0}
            >
              {t("settings.import.saveTemplate", "Save template")}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "preview" && previewResult ? (
        <div className="space-y-4" data-testid="guided-import-preview">
          <div className="rounded-md border p-3" data-testid="guided-import-reconciliation">
            <p className="mb-2 text-sm font-medium">
              {t("settings.import.reconciliation", "Pre-import reconciliation")}
            </p>
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
              <div><span className="text-muted-foreground">{t("settings.import.sourceRows", "Source rows")}:</span> {rows.length}</div>
              <div><span className="text-muted-foreground">{t("settings.import.previewRows", "Previewed")}:</span> {previewResult.rows.length}</div>
              <div><span className="text-muted-foreground">{t("settings.import.previewErrors", "Errors")}:</span> {previewErrors.length}</div>
              <div><span className="text-muted-foreground">{t("settings.import.previewWarnings", "Warnings")}:</span> {previewWarnings}</div>
              <div><span className="text-muted-foreground">{t("settings.import.rowsToImport", "Rows to import")}:</span> {Math.max(0, rows.length - duplicateSkipCount)}</div>
            </div>
          </div>
          <ImportPreviewGrid preview={{ ...previewResult, rows: previewResult.rows.slice(0, 25) }} />
          {previewResult.rows.length > 25 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                "settings.import.previewDisplayLimit",
                "All {{count}} rows were validated; the table shows the first 25.",
                { count: previewResult.rows.length },
              )}
            </p>
          ) : null}
          {duplicateStates.length > 0 ? (
            <div className="space-y-2" data-testid="guided-import-duplicates">
              <p className="text-sm font-medium text-amber-700">
                {t("settings.import.duplicatesFound", "Possible duplicates ({{count}})", {
                  count: duplicateStates.length,
                })}
              </p>
              <div className="overflow-x-auto rounded border text-xs">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="p-2">{t("settings.import.row", "Row")}</th>
                      <th className="p-2">{t("settings.import.matchReason", "Match")}</th>
                      <th className="p-2">{t("settings.import.existingId", "Existing ID")}</th>
                      <th className="p-2">{t("settings.import.action", "Action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {duplicateStates.map((item) => (
                      <tr key={item.rowIndex} className="border-b">
                        <td className="p-2">{item.rowIndex + 1}</td>
                        <td className="p-2">{item.match.matchReason}</td>
                        <td className="p-2">{item.match.existingId}</td>
                        <td className="p-2">
                          <Select
                            value={item.action}
                            onValueChange={(value) =>
                              setDuplicateAction(item.rowIndex, value as ImportDuplicateAction)
                            }
                          >
                            <SelectTrigger className="h-8 w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="skip">{t("settings.import.duplicateSkip", "Skip row")}</SelectItem>
                              <SelectItem value="import">
                                {t("settings.import.duplicateImport", "Import anyway")}
                              </SelectItem>
                              <SelectItem value="update" disabled>
                                {t("settings.import.duplicateUpdate", "Update existing")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {previewErrors.length > 0 && !preparedPreview ? (
            <label className="flex items-center gap-2 text-sm text-destructive">
              <input
                type="checkbox"
                checked={confirmImportWithErrors}
                onChange={(e) => setConfirmImportWithErrors(e.target.checked)}
              />
              {t(
                "settings.import.overridePreviewErrors",
                "Import anyway despite {{count}} validation error(s)",
                { count: previewErrors.length },
              )}
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {step === "upload" && targetEntity === "product" && csvText.trim() ? <PreparedProductPreviewButton organizationId={orgId} disabled={busy || analyze.isPending} onPreview={runPreparedPreview} /> : null}
        {step === "import" && importRequest && !importedJobId ? <>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void runImport(true)}>{t("settings.importReview.checkResult", { defaultValue: "Check import result" })}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void runImport()}>{t("settings.importReview.retrySame", { defaultValue: "Retry same submission" })}</Button>
        </> : null}
        {(step === "upload" || step === "analyze") && csvText.trim() ? (
          <Button
            type="button"
            variant="secondary"
            disabled={analyze.isPending || !csvText.trim()}
            onClick={() => void runAnalyze()}
          >
            {analyze.isPending
              ? t("settings.import.analyzing", "Analyzing…")
              : t("settings.import.analyze", "Analyze with AI")}
          </Button>
        ) : null}
        {step === "map" ? (
          <Button type="button" disabled={preview.isPending} onClick={() => void runPreview()}>
            {t("settings.import.preview", "Preview import")}
          </Button>
        ) : null}
        {step === "preview" ? (
          <Button type="button" variant="outline" disabled={busy || !companyId || !REVIEW_TARGETS.has(targetEntity) || rows.length > 1000} onClick={() => void saveForReview()}>
            {t("settings.importReview.saveForReview", { defaultValue: "Save for review" })}
          </Button>
        ) : null}
        {step === "preview" ? (
          <Button type="button" disabled={busy || (preparedPreview && previewErrors.length > 0)} onClick={() => void runImport()}>
            {t("settings.import.run", "Import")}
          </Button>
        ) : null}
        {step !== "upload" ? (
          <Button type="button" variant="outline" disabled={busy || (!!importRequest && !importedJobId)} onClick={resetFlow}>
            {t("settings.import.startOver", "Start over")}
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}

      {importedJobId ? (
        <div className="space-y-2" data-testid="guided-import-result">
          {activeJob ? (
            <ImportJobStatusPanel
              job={activeJob}
              errors={(importErrorsQuery.data ?? []) as ImportJobErrorRow[]}
              isLoading={importJobsQuery.isLoading || importErrorsQuery.isLoading}
              fileName={
                String(activeJob.fileName ?? activeJob.file_name ?? "") ||
                sourceFileName ||
                undefined
              }
              onRollback={() => void handleRollback()}
              isRollbackPending={rollbackImport.isPending}
            />
          ) : (
            <p className="rounded border p-3 text-sm text-muted-foreground">
              {t(
                "settings.import.jobRefreshing",
                "Import job #{{id}} is complete. Refreshing its reconciliation record…",
                { id: importedJobId },
              )}
            </p>
          )}
          {rollbackConfirmId ? (
            <div className="flex flex-wrap items-center gap-2 rounded border border-destructive/40 p-3 text-sm">
              <span>
                {t(
                  "settings.import.rollbackConfirm",
                  "Rollback removes every record created by this import. Confirm rollback?",
                )}
              </span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={rollbackImport.isPending}
                onClick={() => void handleRollback()}
              >
                {t("settings.import.confirmRollback", "Confirm rollback")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRollbackConfirmId(null)}
              >
                {t("common.cancel", "Cancel")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2" data-testid="guided-import-history">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {t("settings.import.recentImports", "Recent imports for this entity")}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={importJobsQuery.isFetching}
            onClick={() => void importJobsQuery.refetch()}
          >
            {t("common.refresh", "Refresh")}
          </Button>
        </div>
        {entityJobs.length > 0 ? (
          <div className="overflow-x-auto rounded border text-xs">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="p-2">{t("settings.import.job", "Job")}</th>
                  <th className="p-2">{t("settings.import.status", "Status")}</th>
                  <th className="p-2">{t("settings.import.importedRows", "Imported")}</th>
                  <th className="p-2">{t("settings.import.errorRows", "Errors")}</th>
                  <th className="p-2">{t("settings.import.action", "Action")}</th>
                </tr>
              </thead>
              <tbody>
                {entityJobs.map((job) => {
                  const jobId = String(job.id ?? "")
                  return (
                    <tr key={jobId} className="border-b">
                      <td className="p-2">#{jobId}</td>
                      <td className="p-2">{String(job.status ?? "pending")}</td>
                      <td className="p-2">
                        {importJobCount(job, "importedRows", "imported_rows")}/
                        {importJobCount(job, "totalRows", "total_rows")}
                      </td>
                      <td className="p-2">{importJobCount(job, "errorRows", "error_rows")}</td>
                      <td className="p-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setImportedJobId(jobId)}
                        >
                          {t("settings.import.reviewJob", "Review")}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {importJobsQuery.isLoading
              ? t("common.loading", "Loading…")
              : t("settings.import.noRecentImports", "No tracked imports for this entity yet.")}
          </p>
        )}
      </div>

      <FormModal
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        config={templateSaveFormConfig}
        onSubmit={handleSaveTemplate}
        isPending={saveTemplate.isPending}
        closeOnSubmit={false}
        showSubmitSuccessToast
      />

      {deleteConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-lg border bg-background p-4 shadow-lg max-w-sm space-y-3">
            <p className="text-sm font-medium">
              {t("settings.import.deleteTemplateConfirm", "Delete this mapping template?")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.import.deleteTemplateHint", "This cannot be undone.")}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDeleteConfirmOpen(false)}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleteTemplate.isPending}
                onClick={() => void handleDeleteTemplate()}
              >
                {t("settings.import.deleteTemplate", "Delete template")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
