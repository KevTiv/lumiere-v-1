"use client"

import { useCallback, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { assertCsvSafeForAi, parseCsvText } from "@lumiere/erp-shared/csv-import-safety"
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
  useImportMappingTemplates,
  useSaveImportMappingTemplate,
  type ImportMappingTemplateRow,
} from "@lumiere/query-hooks/hooks/import-mapping-templates"
import {
  FormModal,
  ImportMappingTable,
  ImportPreviewGrid,
  mappingRecordFromAnalysis,
  priorMappingsFromTemplate,
  selectedTemplateRow,
  type FormConfig,
} from "@lumiere/ui"
import { Button } from "@/components/ui/button"
import { phCapture } from "@/lib/posthog-browser"
import {
  defaultDuplicateActions,
  detectImportDuplicates,
  filterCsvForImport,
  type ImportDuplicateAction,
  type ImportDuplicateRowState,
} from "@/lib/import-duplicate-detection"
import {
  IMPORT_ENTITY_GROUPS,
  wizardEntitiesForGroup,
  wizardEntityByKey,
  type ImportEntityOption,
} from "@/lib/import-entities"

type WizardStep = "upload" | "analyze" | "map" | "preview" | "import"

export type GuidedImportWizardProps = {
  organizationId: number
}

export function GuidedImportWizard({ organizationId }: GuidedImportWizardProps) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)

  const analyze = useAnalyzeImportMapping()
  const preview = usePreviewImportMapping()
  const saveTemplate = useSaveImportMappingTemplate(orgId)
  const deleteTemplate = useDeleteImportMappingTemplate(orgId)
  const templatesQuery = useImportMappingTemplates(orgId)
  const contactsQuery = useContacts(orgId)
  const productsQuery = useProducts(orgId)

  const [wizardKey, setWizardKey] = useState("contact")
  const [step, setStep] = useState<WizardStep>("upload")
  const [csvText, setCsvText] = useState("")
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [analysis, setAnalysis] = useState<ImportAnalyzeResponse | null>(null)
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

  const entityOption = wizardEntityByKey(wizardKey) ?? wizardEntityByKey("contact")!
  const targetEntity = entityOption.tableName

  const entityTemplates = templatesForEntity(
    (templatesQuery.data ?? []) as ImportMappingTemplateRow[],
    targetEntity,
  )
  const selectedTemplate = selectedTemplateRow(entityTemplates, selectedTemplateId)

  const stepLabel = useMemo(() => {
    const labels: Record<WizardStep, string> = {
      upload: t("settings.import.stepUpload", "1. Upload CSV"),
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
    setMapping({})
    setPreviewResult(null)
    setDuplicateStates([])
    setConfirmImportWithErrors(false)
    setStatus(null)
    setError(null)
    setSelectedTemplateId(null)
    setAppliedTemplateId(null)
    analyze.reset()
    preview.reset()
  }, [analyze, preview])

  const onEntityChange = useCallback(
    (nextKey: string) => {
      setWizardKey(nextKey)
      resetFlow()
      setCsvText("")
      setHeaders([])
      setRows([])
    },
    [resetFlow],
  )

  const onFile = useCallback(async (file: File | null) => {
    if (!file) return
    setError(null)
    resetFlow()
    try {
      const text = await file.text()
      const parsed = parseCsvText(text)
      assertCsvSafeForAi(parsed.headers, parsed.rows.slice(0, 50))
      setCsvText(text)
      setHeaders(parsed.headers)
      setRows(parsed.rows)
      setStep("upload")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCsvText("")
      setHeaders([])
      setRows([])
    }
  }, [resetFlow])

  const applyTemplateMapping = useCallback(
    (templateId: string | null) => {
      if (!templateId || !analysis) return
      const template = selectedTemplateRow(entityTemplates, templateId)
      const prior = priorMappingsFromTemplate(template)
      if (!prior) return
      setMapping(prior)
      setAppliedTemplateId(templateId)
    },
    [analysis, entityTemplates],
  )

  const runAnalyze = useCallback(async () => {
    if (!csvText.trim()) return
    setError(null)
    setStatus(null)
    setPreviewResult(null)
    setDuplicateStates([])
    setStep("analyze")
    setAppliedTemplateId(selectedTemplateId)
    try {
      const priorMappings = priorMappingsFromTemplate(selectedTemplate)
      const result = await analyze.mutateAsync({
        targetEntity,
        headers,
        sampleRows: rows.slice(0, 50),
        csvText,
        ...(priorMappings ? { priorMappings } : {}),
      })
      setAnalysis(result)
      setMapping(
        priorMappings && Object.keys(priorMappings).length > 0
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

  const runPreview = useCallback(async () => {
    if (!csvText.trim() || Object.keys(mapping).length === 0) return
    setError(null)
    setStatus(null)
    setConfirmImportWithErrors(false)
    try {
      const result = await preview.mutateAsync({
        targetEntity,
        headers,
        rows,
        mapping,
        maxRows: 25,
      })
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

  const runImport = useCallback(async () => {
    if (!csvText.trim()) return
    if (previewErrors.length > 0 && !confirmImportWithErrors) {
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
      const importCsv =
        skipRows.size > 0
          ? filterCsvForImport({ csvText, headers, rows, skipRowIndexes: skipRows })
          : csvText

      const importRes = await fetch(`/api/import/${targetEntity}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: importCsv }),
      })
      const importJson = (await importRes.json()) as {
        ok?: boolean
        rowsImported?: number
        error?: string
      }
      if (!importRes.ok) throw new Error(importJson.error ?? "Import failed")

      phCapture("ai_import_completed", {
        entity: targetEntity,
        rows_imported: importJson.rowsImported ?? 0,
        ai_mapped: true,
        duplicates_skipped: skipRows.size,
        template_id: appliedTemplateId,
      })
      setStep("import")
      setStatus(
        t("settings.import.done", "Imported {{count}} rows.", {
          count: importJson.rowsImported ?? 0,
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [
    appliedTemplateId,
    confirmImportWithErrors,
    csvText,
    duplicateStates,
    headers,
    previewErrors.length,
    rows,
    targetEntity,
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

  return (
    <div className="rounded-lg border p-4 space-y-4" data-testid="guided-import-wizard">
      <div>
        <h3 className="text-sm font-medium">{t("settings.import.title", "Guided data import")}</h3>
        <p className="text-xs text-muted-foreground">{stepLabel}</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm space-y-1">
          <span className="block text-muted-foreground">{t("settings.import.entity", "Entity")}</span>
          <select
            className="border rounded px-2 py-1 text-sm min-w-[200px]"
            value={wizardKey}
            onChange={(e) => onEntityChange(e.target.value)}
            data-testid="guided-import-entity"
          >
            {IMPORT_ENTITY_GROUPS.map((group) => {
              const options = wizardEntitiesForGroup(group.key)
              if (options.length === 0) return null
              return (
                <optgroup key={group.key} label={group.label}>
                  {options.map((opt: ImportEntityOption) => (
                    <option key={opt.wizardKey} value={opt.wizardKey}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        </label>

        <label className="text-sm space-y-1">
          <span className="block text-muted-foreground">
            {t("settings.import.savedTemplate", "Saved template")}
          </span>
          <select
            className="border rounded px-2 py-1 text-sm min-w-[200px]"
            value={selectedTemplateId ?? ""}
            onChange={(e) => {
              const next = e.target.value || null
              setSelectedTemplateId(next)
              applyTemplateMapping(next)
            }}
            data-testid="guided-import-template"
          >
            <option value="">{t("settings.import.noTemplate", "— None —")}</option>
            {entityTemplates.map((row) => (
              <option key={String(row.id)} value={String(row.id)}>
                {row.name} ({row.useCount ?? row.use_count ?? 0})
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm space-y-1">
          <span className="block text-muted-foreground">{t("settings.import.file", "CSV file")}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            data-testid="guided-import-file"
          />
        </label>
      </div>

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
          <ImportPreviewGrid preview={previewResult} />
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
                          <select
                            className="border rounded px-1 py-0.5"
                            value={item.action}
                            onChange={(e) =>
                              setDuplicateAction(item.rowIndex, e.target.value as ImportDuplicateAction)
                            }
                          >
                            <option value="skip">{t("settings.import.duplicateSkip", "Skip row")}</option>
                            <option value="import">
                              {t("settings.import.duplicateImport", "Import anyway")}
                            </option>
                            <option value="update" disabled>
                              {t("settings.import.duplicateUpdate", "Update existing")}
                            </option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {previewErrors.length > 0 ? (
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
          <Button type="button" disabled={busy} onClick={() => void runImport()}>
            {t("settings.import.run", "Import")}
          </Button>
        ) : null}
        {step !== "upload" ? (
          <Button type="button" variant="outline" disabled={busy} onClick={resetFlow}>
            {t("settings.import.startOver", "Start over")}
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}

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
