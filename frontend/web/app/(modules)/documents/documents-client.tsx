"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newDocumentForm,
  newKnowledgeArticleForm,
  MissingOrganization,
  csvImportForm,
  completeDocumentProcessingJobForm,
  acknowledgeDocumentInsightForm,
  formatStdbTaggedValue,
} from "@lumiere/ui"
import type { EntityViewConfig, FormConfig } from "@lumiere/ui"
import { documentsModuleConfig } from "@/lib/module-dashboard-configs"
import { AiResultPanel } from "@/lib/ai-result-panel"
import {
  useDocuments,
  useKnowledgeArticles,
  useCreateDocument,
  useUpdateDocument,
  useDeleteDocument,
  useLockDocument,
  useUnlockDocument,
  useRecordDocumentView,
  useCreateKnowledgeArticle,
  useDocumentsCsvImportMutations,
  useAiDocumentProcessingJobs,
  useAiInsightsForOrg,
  useCreateDocumentProcessingJob,
  useCompleteDocumentProcessingJob,
  useApproveDocumentProcessingJob,
  useAcknowledgeInsight,
} from "@lumiere/query-hooks/hooks/documents"
import type { CreateDocumentParams, CreateKnowledgeArticleParams } from "@lumiere/query-hooks/hooks/documents"
import { optionalBigIntU64, u64IdArrayFromForm } from "@/lib/form-coercion"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import type { QueryRows } from "@/lib/query-fetch"
import { useRunAiSkill } from "@lumiere/query-hooks/hooks/ai-skills"

type DocumentRowAction =
  | { action: "updateDocument"; row: Record<string, unknown>; form: FormConfig }
  | null

const aiInsightsGenerateForm: FormConfig = {
  id: "ai-generate-insights",
  title: "Generate AI Insights",
  description: "Run the insights_scan skill for a resource scope.",
  submitLabel: "Generate insights",
  sections: [
    {
      id: "scope",
      fields: [
        {
          id: "resource",
          type: "text",
          name: "resource",
          label: "Resource",
          defaultValue: "documents",
          width: "1/2",
        },
        {
          id: "force",
          type: "switch",
          name: "force",
          label: "Force regeneration",
          width: "1/2",
        },
        {
          id: "scope-json",
          type: "textarea",
          name: "scopeJson",
          label: "Scope JSON",
          placeholder: "{\"limit\": 20}",
          rows: 4,
          width: "full",
        },
      ],
    },
  ],
}

function editDocumentForm(row: Record<string, unknown>): FormConfig {
  return {
    id: "edit-document",
    title: "Update Document",
    submitLabel: "Update document",
    sections: [
      {
        id: "document",
        fields: [
          {
            id: "doc-name",
            name: "name",
            type: "text",
            label: "Name",
            required: true,
            defaultValue: String(row.name ?? ""),
            width: "full",
          },
          {
            id: "doc-file-name",
            name: "fileName",
            type: "text",
            label: "File name",
            defaultValue: String(row.fileName ?? ""),
            width: "1/2",
          },
          {
            id: "doc-mimetype",
            name: "mimetype",
            type: "text",
            label: "MIME type",
            defaultValue: String(row.mimetype ?? ""),
            width: "1/2",
          },
          {
            id: "doc-description",
            name: "description",
            type: "textarea",
            label: "Description",
            defaultValue: String(row.description ?? ""),
            rows: 3,
            width: "full",
          },
          {
            id: "doc-favorite",
            name: "isFavorite",
            type: "checkbox",
            label: "Favorite",
            defaultValue: Boolean(row.isFavorite),
            width: "1/2",
          },
          {
            id: "doc-shared",
            name: "isShared",
            type: "checkbox",
            label: "Shared",
            defaultValue: Boolean(row.isShared),
            width: "1/2",
          },
        ],
      },
    ],
  }
}

interface DocumentsClientProps {
  initialDocuments?: Record<string, unknown>[]
  initialArticles?: Record<string, unknown>[]
  initialProcessingJobs?: Record<string, unknown>[]
  initialAiInsights?: Record<string, unknown>[]
  organizationId?: number
}

type DocumentsClientLoadedProps = Omit<DocumentsClientProps, "organizationId"> & {
  organizationId: number
}

function truthyRowBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true"
}

function withTableActions(
  ec: EntityViewConfig,
  actions: Array<{
    id: string
    label: string
    requiresSelection?: boolean
    onClick: (selectedRows: Record<string, unknown>[]) => void
  }>,
  rowSelectionToggleOnClick?: boolean,
): EntityViewConfig {
  if (ec.view.mode !== "table") return ec
  return {
    ...ec,
    view: {
      ...ec.view,
      ...(rowSelectionToggleOnClick !== undefined ? { rowSelectionToggleOnClick } : {}),
      actions,
    },
  }
}

export function DocumentsClient(props: DocumentsClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <DocumentsClientLoaded {...props} organizationId={props.organizationId} />
}

function DocumentsClientLoaded({
  initialDocuments,
  initialArticles,
  initialProcessingJobs,
  initialAiInsights,
  organizationId,
}: DocumentsClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => documentsModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [csvKind, setCsvKind] = useState<"knowledge_category" | "knowledge_article" | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [processingToolbarError, setProcessingToolbarError] = useState<string | null>(null)
  const [documentToolbarError, setDocumentToolbarError] = useState<string | null>(null)
  const [documentRowAction, setDocumentRowAction] = useState<DocumentRowAction>(null)
  const [documentRowSubmitError, setDocumentRowSubmitError] = useState<string | null>(null)
  const [completeModalRows, setCompleteModalRows] = useState<Record<string, unknown>[] | null>(null)
  const [completeSubmitError, setCompleteSubmitError] = useState<string | null>(null)
  const [ackModalRows, setAckModalRows] = useState<Record<string, unknown>[] | null>(null)
  const [ackSubmitError, setAckSubmitError] = useState<string | null>(null)
  const [generateInsightsOpen, setGenerateInsightsOpen] = useState(false)
  const [generateInsightsError, setGenerateInsightsError] = useState<string | null>(null)
  const [generateInsightsResult, setGenerateInsightsResult] = useState<Record<string, unknown> | null>(null)

  const { data: documents = [] } = useDocuments(orgId, initialDocuments)
  const { data: articles = [] } = useKnowledgeArticles(orgId, initialArticles)
  const { data: processingJobs = [] } = useAiDocumentProcessingJobs(orgId, initialProcessingJobs as QueryRows | undefined)
  const { data: aiInsights = [] } = useAiInsightsForOrg(orgId, initialAiInsights as QueryRows | undefined)
  const createDocument = useCreateDocument(orgId, operatingCompanyId)
  const updateDocument = useUpdateDocument(orgId)
  const deleteDocument = useDeleteDocument(orgId)
  const lockDocument = useLockDocument(orgId)
  const unlockDocument = useUnlockDocument(orgId)
  const recordDocumentView = useRecordDocumentView(orgId)
  const createKnowledgeArticle = useCreateKnowledgeArticle(orgId, operatingCompanyId)
  const createProcessingJob = useCreateDocumentProcessingJob(orgId, operatingCompanyId)
  const completeProcessingJob = useCompleteDocumentProcessingJob(orgId)
  const approveProcessingJob = useApproveDocumentProcessingJob(orgId)
  const acknowledgeInsight = useAcknowledgeInsight(orgId)
  const csvImports = useDocumentsCsvImportMutations(orgId)
  const runInsightsScan = useRunAiSkill()

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  const addCsvToolbar = (
    ec: EntityViewConfig,
    actions: Array<{
      id: string
      label: string
      onClick: (selectedRows: Record<string, unknown>[]) => void
    }>,
  ): EntityViewConfig => {
    if (ec.view.mode !== "table") return ec
    return {
      ...ec,
      view: {
        ...ec.view,
        rowSelectionToggleOnClick: false,
        actions,
      },
    }
  }

  const liveSections = useMemo(() => {
    const shared = documents.filter((d) => d.isShared).length
    const favorites = documents.filter((d) => d.isFavorite).length
    const published = articles.filter((a) => a.isPublished).length

    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: "Total Documents", value: String(documents.length), icon: "FileText" },
                { label: "Shared", value: String(shared), icon: "Share2" },
                { label: "Favorites", value: String(favorites), icon: "Star" },
                { label: "Published Articles", value: String(published), icon: "BookOpen" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            upload_document: () => setQuickActionForm({ form: newDocumentForm(t), action: "uploadDocument" }),
            new_article: () => setQuickActionForm({ form: newKnowledgeArticleForm(t), action: "createArticle" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        return w
      }),
    }))
  }, [documents, articles, moduleConfig, t])

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    if (csvKind === "knowledge_category") {
      return csvImportForm(t, t("documents.csvImport.categoryTitle"))
    }
    return csvImportForm(t, t("documents.csvImport.articleTitle"))
  }, [csvKind, t])

  const completeFormConfig = useMemo(() => completeDocumentProcessingJobForm(t), [t])
  const acknowledgeFormConfig = useMemo(() => acknowledgeDocumentInsightForm(t), [t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) => {
        if (tab.id === "dashboard") return { ...tab, sections: liveSections }
        if (tab.id === "documents" && tab.entityConfig) {
          return {
            ...tab,
            entityConfig: withTableActions(
              tab.entityConfig,
              [
                {
                  id: "edit-document",
                  label: "Edit document",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setDocumentToolbarError(null)
                    if (rows.length !== 1) {
                      setDocumentToolbarError("Select one document to edit.")
                      return
                    }
                    setDocumentRowSubmitError(null)
                    setDocumentRowAction({
                      action: "updateDocument",
                      row: rows[0],
                      form: editDocumentForm(rows[0]),
                    })
                  },
                },
                {
                  id: "lock-document",
                  label: "Lock",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) await lockDocument.mutateAsync(row.id as string | number)
                    } catch (e) {
                      setDocumentToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
                {
                  id: "unlock-document",
                  label: "Unlock",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) await unlockDocument.mutateAsync(row.id as string | number)
                    } catch (e) {
                      setDocumentToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
                {
                  id: "record-document-view",
                  label: "Record view",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) await recordDocumentView.mutateAsync(row.id as string | number)
                    } catch (e) {
                      setDocumentToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
                {
                  id: "delete-document",
                  label: "Delete",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) await deleteDocument.mutateAsync(row.id as string | number)
                    } catch (e) {
                      setDocumentToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
              ],
              true,
            ),
          }
        }
        if (tab.id === "knowledge-base" && tab.entityConfig) {
          return {
            ...tab,
            entityConfig: addCsvToolbar(tab.entityConfig, [
              {
                id: "csv-kb-category",
                label: t("documents.toolbar.importCategoryCsv"),
                onClick: (_rows) => setCsvKind("knowledge_category"),
              },
              {
                id: "csv-kb-article",
                label: t("documents.toolbar.importArticleCsv"),
                onClick: (_rows) => setCsvKind("knowledge_article"),
              },
            ]),
          }
        }
        if (tab.id === "document-processing" && tab.entityConfig) {
          return {
            ...tab,
            entityConfig: withTableActions(
              tab.entityConfig,
              [
                {
                  id: "complete-job",
                  label: t("documents.processing.actions.recordCompletion"),
                  requiresSelection: true,
                  onClick: (rows) => {
                    setProcessingToolbarError(null)
                    if (rows.length !== 1) {
                      setProcessingToolbarError(t("documents.processing.errors.selectOneJob"))
                      return
                    }
                    setCompleteSubmitError(null)
                    setCompleteModalRows(rows)
                  },
                },
                {
                  id: "approve-job",
                  label: t("documents.processing.actions.approve"),
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setProcessingToolbarError(null)
                    const eligible = rows.filter(
                      (r) =>
                        formatStdbTaggedValue(r.status) === "Completed" &&
                        !truthyRowBool(r.isApproved),
                    )
                    if (eligible.length === 0) {
                      setProcessingToolbarError(t("documents.processing.errors.noneApprovable"))
                      return
                    }
                    try {
                      for (const row of eligible) {
                        await approveProcessingJob.mutateAsync(row)
                      }
                    } catch (e) {
                      setProcessingToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
              ],
              true,
            ),
          }
        }
        if (tab.id === "document-insights" && tab.entityConfig) {
          return {
            ...tab,
            entityConfig: withTableActions(
              tab.entityConfig,
              [
                {
                  id: "ack-insight",
                  label: t("documents.insights.actions.acknowledge"),
                  requiresSelection: true,
                  onClick: (rows) => {
                    setProcessingToolbarError(null)
                    const eligible = rows.filter(
                      (r) => !truthyRowBool(r.isAcknowledged) && !truthyRowBool(r.dismissed),
                    )
                    if (eligible.length === 0) {
                      setProcessingToolbarError(t("documents.insights.errors.noneAcknowledgable"))
                      return
                    }
                    setAckSubmitError(null)
                    setAckModalRows(eligible)
                  },
                },
                {
                  id: "generate-insights",
                  label: "Generate insights",
                  onClick: (_rows) => {
                    setGenerateInsightsError(null)
                    setGenerateInsightsOpen(true)
                  },
                },
              ],
              true,
            ),
          }
        }
        return tab
      }),
    }),
    [
      liveSections,
      moduleConfig,
      t,
      approveProcessingJob,
      deleteDocument,
      lockDocument,
      recordDocumentView,
      unlockDocument,
      runInsightsScan,
    ],
  )

  const data = useMemo(
    () => ({
      documents: documents as unknown as Record<string, unknown>[],
      "knowledge-base": articles as unknown as Record<string, unknown>[],
      "document-processing": processingJobs as unknown as Record<string, unknown>[],
      "document-insights": aiInsights as unknown as Record<string, unknown>[],
    }),
    [documents, articles, processingJobs, aiInsights],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createDocument" || action === "uploadDocument") {
      await createDocument.mutateAsync({
        name: formData.name as string,
        fileName: formData.fileName as string,
        mimetype: formData.mimetype as string | undefined,
        description: formData.description as string | undefined,
        isFavorite: Boolean(formData.isFavorite),
        isShared: Boolean(formData.isShared),
        folderId: optionalBigIntU64(formData.folderId),
        tagIds: u64IdArrayFromForm(formData.tagIds),
        url: undefined,
        metadata: undefined,
      } as unknown as CreateDocumentParams)
    } else if (action === "createArticle") {
      await createKnowledgeArticle.mutateAsync({
        name: formData.name as string,
        description: formData.description as string | undefined,
        body: formData.body as string | undefined,
        isPublished: Boolean(formData.isPublished),
        parentId: optionalBigIntU64(formData.parentId),
        categoryId: optionalBigIntU64(formData.categoryId),
        coverId: undefined,
        websiteUrl: undefined,
        metadata: undefined,
      } as unknown as CreateKnowledgeArticleParams)
    } else if (action === "createDocumentProcessingJob") {
      await createProcessingJob.mutateAsync({
        documentType: formData.documentType,
        jobType: formData.jobType,
        aiAgentId: formData.aiAgentId,
        inputData: formData.inputData,
        metadata: formData.metadata,
      })
    }
  }

  const isFormMutationPending =
    createDocument.isPending ||
    updateDocument.isPending ||
    deleteDocument.isPending ||
    lockDocument.isPending ||
    unlockDocument.isPending ||
    recordDocumentView.isPending ||
    createKnowledgeArticle.isPending ||
    createProcessingJob.isPending ||
    completeProcessingJob.isPending ||
    approveProcessingJob.isPending ||
    acknowledgeInsight.isPending ||
    runInsightsScan.isPending ||
    csvImports.importKnowledgeCategory.isPending ||
    csvImports.importKnowledgeArticle.isPending

  return (
    <>
      {processingToolbarError ? (
        <p className="text-sm text-destructive mb-2" role="alert">
          {processingToolbarError}
        </p>
      ) : null}
      {documentToolbarError ? (
        <p className="text-sm text-destructive mb-2" role="alert">
          {documentToolbarError}
        </p>
      ) : null}
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
      />
      {generateInsightsResult ? (
        <div className="mb-4">
          <AiResultPanel
            title="Generated AI insights"
            result={generateInsightsResult}
            onDismiss={() => setGenerateInsightsResult(null)}
          />
        </div>
      ) : null}
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newDocumentForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      {csvKind && csvFormConfig ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={csvError}
          onSubmit={async (data) => {
            setCsvError(null)
            const files = data.csvFile as FileList | undefined
            const file = files?.[0]
            if (!file) {
              setCsvError(t("common.validation.required"))
              return
            }
            try {
              const text = await file.text()
              if (csvKind === "knowledge_category") {
                await csvImports.importKnowledgeCategory.mutateAsync(text)
              } else {
                await csvImports.importKnowledgeArticle.mutateAsync(text)
              }
              setCsvKind(null)
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
      <FormModal
        open={generateInsightsOpen}
        onOpenChange={(open) => {
          if (!open) {
            setGenerateInsightsOpen(false)
            setGenerateInsightsError(null)
          }
        }}
        config={aiInsightsGenerateForm}
        isPending={isFormMutationPending}
        closeOnSubmit={false}
        submitError={generateInsightsError}
        onSubmit={async (formData) => {
          setGenerateInsightsError(null)
          try {
            const scopeRaw =
              typeof formData.scopeJson === "string" ? formData.scopeJson.trim() : ""
            const scope =
              scopeRaw !== "" ? (JSON.parse(scopeRaw) as Record<string, unknown>) : undefined
            const result = await runInsightsScan.mutateAsync({
              companyId: Number(operatingCompanyId ?? 0),
              skillKey: "insights_scan",
              inputs: {
                resource:
                  formData.resource != null && String(formData.resource).trim() !== ""
                    ? String(formData.resource).trim()
                    : undefined,
                scope,
                force: Boolean(formData.force),
              },
            })
            setGenerateInsightsResult({
              summary: result.summary,
              preview_insights:
                result.artifacts.find((artifact) => artifact.kind === "insights")?.content ??
                result.artifacts,
              steps: result.steps,
              skill_key: result.skill_key,
            })
            setGenerateInsightsOpen(false)
          } catch (e) {
            setGenerateInsightsError(e instanceof Error ? e.message : String(e))
          }
        }}
      />
      {documentRowAction ? (
        <FormModal
          open
          onOpenChange={(o) => {
            if (!o) {
              setDocumentRowAction(null)
              setDocumentRowSubmitError(null)
            }
          }}
          config={documentRowAction.form}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={documentRowSubmitError}
          onSubmit={async (formData) => {
            setDocumentRowSubmitError(null)
            try {
              await updateDocument.mutateAsync({
                documentId: documentRowAction.row.id as string | number,
                params: {
                  name: formData.name,
                  fileName: formData.fileName,
                  mimetype: formData.mimetype,
                  description: formData.description,
                  isFavorite: Boolean(formData.isFavorite),
                  isShared: Boolean(formData.isShared),
                },
              })
              setDocumentRowAction(null)
            } catch (e) {
              setDocumentRowSubmitError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
      {completeModalRows?.length === 1 ? (
        <FormModal
          open
          onOpenChange={(o) => {
            if (!o) {
              setCompleteModalRows(null)
              setCompleteSubmitError(null)
            }
          }}
          config={completeFormConfig}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={completeSubmitError}
          onSubmit={async (formData) => {
            setCompleteSubmitError(null)
            const row = completeModalRows[0]
            const extractedRaw = typeof formData.extractedData === "string" ? formData.extractedData.trim() : ""
            const errRaw = typeof formData.errorMessage === "string" ? formData.errorMessage.trim() : ""
            const modelUsed =
              typeof formData.modelUsed === "string" && formData.modelUsed.trim() !== ""
                ? formData.modelUsed.trim()
                : null
            const confRaw = formData.confidenceScore
            const confidenceScore =
              confRaw !== "" && confRaw !== undefined && confRaw !== null
                ? Number(confRaw)
                : null
            const tokensRaw = formData.tokensUsed
            const tokensUsed =
              tokensRaw !== "" && tokensRaw !== undefined && tokensRaw !== null
                ? Math.round(Number(tokensRaw))
                : null
            const costRaw = formData.cost
            const cost =
              costRaw !== "" && costRaw !== undefined && costRaw !== null ? Number(costRaw) : null

            if (errRaw === "" && extractedRaw === "") {
              setCompleteSubmitError(t("documents.forms.completeProcessingJob.validation.needResultOrError"))
              return
            }

            try {
              await completeProcessingJob.mutateAsync({
                row,
                extractedData: extractedRaw !== "" ? extractedRaw : null,
                modelUsed,
                confidenceScore:
                  confidenceScore != null && Number.isFinite(confidenceScore) ? confidenceScore : null,
                tokensUsed: tokensUsed != null && Number.isFinite(tokensUsed) ? tokensUsed : null,
                cost: cost != null && Number.isFinite(cost) ? cost : null,
                errorMessage: errRaw !== "" ? errRaw : null,
              })
              setCompleteModalRows(null)
            } catch (e) {
              setCompleteSubmitError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
      {ackModalRows && ackModalRows.length > 0 ? (
        <FormModal
          open
          onOpenChange={(o) => {
            if (!o) {
              setAckModalRows(null)
              setAckSubmitError(null)
            }
          }}
          config={acknowledgeFormConfig}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={ackSubmitError}
          onSubmit={async (formData) => {
            setAckSubmitError(null)
            const actionTaken =
              typeof formData.actionTaken === "string" && formData.actionTaken.trim() !== ""
                ? formData.actionTaken.trim()
                : null
            try {
              for (const row of ackModalRows) {
                await acknowledgeInsight.mutateAsync({ row, actionTaken })
              }
              setAckModalRows(null)
            } catch (e) {
              setAckSubmitError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
    </>
  )
}
