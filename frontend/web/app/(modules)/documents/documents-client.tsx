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
import {
  useDocuments,
  useKnowledgeArticles,
  useCreateDocument,
  useCreateKnowledgeArticle,
  useDocumentsCsvImportMutations,
  useAiDocumentProcessingJobs,
  useAiInsightsForOrg,
  useCreateDocumentProcessingJob,
  useCompleteDocumentProcessingJob,
  useApproveDocumentProcessingJob,
  useAcknowledgeInsight,
} from "@/hooks/documents"
import type { CreateDocumentParams, CreateKnowledgeArticleParams } from "@/hooks/documents"
import { optionalBigIntU64, u64IdArrayFromForm } from "@/lib/form-coercion"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import type { QueryRows } from "@/lib/query-fetch"

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
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [csvKind, setCsvKind] = useState<"knowledge_category" | "knowledge_article" | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [processingToolbarError, setProcessingToolbarError] = useState<string | null>(null)
  const [completeModalRows, setCompleteModalRows] = useState<Record<string, unknown>[] | null>(null)
  const [completeSubmitError, setCompleteSubmitError] = useState<string | null>(null)
  const [ackModalRows, setAckModalRows] = useState<Record<string, unknown>[] | null>(null)
  const [ackSubmitError, setAckSubmitError] = useState<string | null>(null)

  const { data: documents = [] } = useDocuments(orgId, initialDocuments)
  const { data: articles = [] } = useKnowledgeArticles(orgId, initialArticles)
  const { data: processingJobs = [] } = useAiDocumentProcessingJobs(orgId, initialProcessingJobs as QueryRows | undefined)
  const { data: aiInsights = [] } = useAiInsightsForOrg(orgId, initialAiInsights as QueryRows | undefined)
  const createDocument = useCreateDocument(orgId)
  const createKnowledgeArticle = useCreateKnowledgeArticle(orgId, companyId)
  const createProcessingJob = useCreateDocumentProcessingJob(orgId, companyId)
  const completeProcessingJob = useCompleteDocumentProcessingJob(orgId)
  const approveProcessingJob = useApproveDocumentProcessingJob(orgId)
  const acknowledgeInsight = useAcknowledgeInsight(orgId)
  const csvImports = useDocumentsCsvImportMutations(orgId)

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
      createDocument.mutate({
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
      createKnowledgeArticle.mutate({
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

  return (
    <>
      {processingToolbarError ? (
        <p className="text-sm text-destructive mb-2" role="alert">
          {processingToolbarError}
        </p>
      ) : null}
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newDocumentForm(t)}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
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
