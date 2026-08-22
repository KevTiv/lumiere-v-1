"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  CsvImportModal,
  newDocumentForm,
  newKnowledgeArticleForm,
  newKnowledgeCategoryForm,
  newDocumentFolderForm,
  newDocumentProcessingJobForm,
  newDocumentTemplateForm,
  newMailTemplateForm,
  uploadDocumentVersionForm,
  editKnowledgeArticleForm,
  editDocumentFolderForm,
  addArticleMemberForm,
  reindexDocumentForm,
  setDocumentRetentionForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  csvImportForm,
  completeDocumentProcessingJobForm,
  acknowledgeDocumentInsightForm,
  formatStdbTaggedValue,
} from "@lumiere/ui"
import type { EntityViewConfig, FormConfig } from "@lumiere/ui"
import { documentsModuleConfig } from "@/lib/module-dashboard-configs"
import { useDocumentsModuleSubscription } from "@/lib/module-subscription-hooks"
import {
  useDocuments,
  useDeletedDocuments,
  useKnowledgeArticles,
  useKnowledgeCategories,
  useDocumentFolders,
  useCreateDocument,
  useUpdateDocument,
  useDeleteDocument,
  useRestoreDocument,
  useLockDocument,
  useUnlockDocument,
  useRecordDocumentView,
  useAddDocumentVersion,
  useSetDocumentIndexContent,
  useSetDocumentRetention,
  usePurgeExpiredDocuments,
  useApplyDocumentLegalHold,
  useUpdateDocumentPresence,
  useCreateKnowledgeArticle,
  useUpdateKnowledgeArticle,
  useDeleteKnowledgeArticle,
  useLockKnowledgeArticle,
  useUnlockKnowledgeArticle,
  useSetArticlePublished,
  useAddArticleMember,
  useCreateKnowledgeCategory,
  useCreateDocumentFolder,
  useUpdateDocumentFolder,
  useDeleteDocumentFolder,
  useDocumentsCsvImportMutations,
  useAiDocumentProcessingJobs,
  useAiInsightsForOrg,
  useCreateDocumentProcessingJob,
  useCompleteDocumentProcessingJob,
  useApproveDocumentProcessingJob,
  useAcknowledgeInsight,
} from "@lumiere/query-hooks/hooks/documents"
import type {
  AiDocumentProcessingJob,
  AiInsight,
  Document,
  DocumentFolder,
  KnowledgeArticle,
  KnowledgeArticleCategory,
} from "@lumiere/query-hooks/hooks/documents"
import {
  useDocumentTemplates,
  useMailTemplates,
  useCreateDocumentTemplate,
  useCreateMailTemplate,
} from "@lumiere/query-hooks/hooks/templates"
import {
  firstFileFromFormValue,
  uploadDocumentBlob,
} from "@/lib/document-blob-upload"
import {
  toCreateDocumentParams,
  toCreateDocumentFolderParams,
  toCreateDocumentProcessingJobParams,
  toCreateKnowledgeArticleParams,
  toCreateKnowledgeCategoryParams,
  toCreateDocumentTemplateParams,
  toCreateMailTemplateParams,
  toAddDocumentVersionParams,
  toUpdateKnowledgeArticleParams,
  toUpdateDocumentFolderParams,
  toSetDocumentIndexContentParams,
  toSetDocumentRetentionParams,
} from "@/lib/documents-create-params"
import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useAiAgents } from "@lumiere/query-hooks/hooks/ai-agents"
import { buildEntitySelection } from "@lumiere/query-hooks/ai-ui-context"
import { useOpenErpAiChat } from "@/lib/erp-ai-context"
import {
  documentFolderRowsToSelectOptions,
  knowledgeCategoryRowsToSelectOptions,
  knowledgeArticleRowsToSelectOptions,
  aiAgentRowsToSelectOptions,
} from "@/lib/form-lookup"

export { DOCUMENTS_UI_REDUCERS } from "@/lib/documents-ui-reducers"

type DocumentRowAction =
  | { action: "updateDocument"; row: Record<string, unknown>; form: FormConfig }
  | { action: "uploadVersion"; row: Record<string, unknown>; form: FormConfig }
  | { action: "reindexDocument"; row: Record<string, unknown>; form: FormConfig }
  | { action: "setRetention"; row: Record<string, unknown>; form: FormConfig }
  | { action: "updateArticle"; row: Record<string, unknown>; form: FormConfig }
  | { action: "updateFolder"; row: Record<string, unknown>; form: FormConfig }
  | { action: "addArticleMember"; row: Record<string, unknown>; form: FormConfig }
  | null

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
  initialDocuments?: Document[]
  initialDeletedDocuments?: Record<string, unknown>[]
  initialArticles?: KnowledgeArticle[]
  initialCategories?: KnowledgeArticleCategory[]
  initialFolders?: DocumentFolder[]
  initialProcessingJobs?: AiDocumentProcessingJob[]
  initialAiInsights?: AiInsight[]
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
  initialDeletedDocuments,
  initialArticles,
  initialCategories,
  initialFolders,
  initialProcessingJobs,
  initialAiInsights,
  organizationId,
}: DocumentsClientLoadedProps) {
  useDocumentsModuleSubscription()
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => documentsModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [csvKind, setCsvKind] = useState<"knowledge_category" | "knowledge_article" | null>(null)
  const [processingToolbarError, setProcessingToolbarError] = useState<string | null>(null)
  const [documentToolbarError, setDocumentToolbarError] = useState<string | null>(null)
  const [documentRowAction, setDocumentRowAction] = useState<DocumentRowAction>(null)
  const [documentRowSubmitError, setDocumentRowSubmitError] = useState<string | null>(null)
  const [completeModalRows, setCompleteModalRows] = useState<Record<string, unknown>[] | null>(null)
  const [completeSubmitError, setCompleteSubmitError] = useState<string | null>(null)
  const [ackModalRows, setAckModalRows] = useState<Record<string, unknown>[] | null>(null)
  const [ackSubmitError, setAckSubmitError] = useState<string | null>(null)
  const openErpAiChat = useOpenErpAiChat()

  const { data: documents = [] } = useDocuments(orgId, initialDocuments)
  const { data: deletedDocuments = [] } = useDeletedDocuments(
    orgId,
    initialDeletedDocuments,
  )
  const { data: articles = [] } = useKnowledgeArticles(orgId, initialArticles)
  const { data: categories = [] } = useKnowledgeCategories(orgId, initialCategories)
  const { data: folders = [] } = useDocumentFolders(orgId, initialFolders)
  const { data: processingJobs = [] } = useAiDocumentProcessingJobs(orgId, initialProcessingJobs)
  const { data: aiInsights = [] } = useAiInsightsForOrg(orgId, initialAiInsights)
  const { data: documentTemplates = [] } = useDocumentTemplates(organizationId)
  const { data: mailTemplates = [] } = useMailTemplates(organizationId)
  const { data: aiAgents = [] } = useAiAgents(organizationId, organizationId > 0)
  const createDocument = useCreateDocument(orgId, operatingCompanyId)
  const updateDocument = useUpdateDocument(orgId)
  const deleteDocument = useDeleteDocument(orgId)
  const restoreDocument = useRestoreDocument(orgId)
  const lockDocument = useLockDocument(orgId)
  const unlockDocument = useUnlockDocument(orgId)
  const recordDocumentView = useRecordDocumentView(orgId)
  const addDocumentVersion = useAddDocumentVersion(orgId)
  const setDocumentIndexContent = useSetDocumentIndexContent(orgId)
  const setDocumentRetention = useSetDocumentRetention(orgId)
  const purgeExpiredDocuments = usePurgeExpiredDocuments(orgId)
  const applyDocumentLegalHold = useApplyDocumentLegalHold(orgId)
  const updateDocumentPresence = useUpdateDocumentPresence(orgId)
  const createKnowledgeArticle = useCreateKnowledgeArticle(orgId, operatingCompanyId)
  const updateKnowledgeArticle = useUpdateKnowledgeArticle(orgId, operatingCompanyId)
  const deleteKnowledgeArticle = useDeleteKnowledgeArticle(orgId)
  const lockKnowledgeArticle = useLockKnowledgeArticle(orgId)
  const unlockKnowledgeArticle = useUnlockKnowledgeArticle(orgId)
  const setArticlePublished = useSetArticlePublished(orgId, operatingCompanyId)
  const addArticleMember = useAddArticleMember(orgId)
  const createKnowledgeCategory = useCreateKnowledgeCategory(orgId, operatingCompanyId)
  const createDocumentFolder = useCreateDocumentFolder(orgId)
  const updateDocumentFolder = useUpdateDocumentFolder(orgId)
  const deleteDocumentFolder = useDeleteDocumentFolder(orgId)
  const createDocumentTemplate = useCreateDocumentTemplate(organizationId)
  const createMailTemplate = useCreateMailTemplate(organizationId)
  const createProcessingJob = useCreateDocumentProcessingJob(orgId, operatingCompanyId)
  const completeProcessingJob = useCompleteDocumentProcessingJob(orgId)
  const approveProcessingJob = useApproveDocumentProcessingJob(orgId)
  const acknowledgeInsight = useAcknowledgeInsight(orgId)
  const csvImports = useDocumentsCsvImportMutations(orgId)
  const versionFormConfig = useMemo(() => uploadDocumentVersionForm(t), [t])
  const documentTemplateFormConfig = useMemo(() => newDocumentTemplateForm(t), [t])
  const mailTemplateFormConfig = useMemo(() => newMailTemplateForm(t), [t])
  const articleMemberFormConfig = useMemo(() => addArticleMemberForm(t), [t])

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

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    if (csvKind === "knowledge_category") {
      return csvImportForm(t, t("documents.csvImport.categoryTitle"))
    }
    return csvImportForm(t, t("documents.csvImport.articleTitle"))
  }, [csvKind, t])

  const completeFormConfig = useMemo(() => completeDocumentProcessingJobForm(t), [t])
  const acknowledgeFormConfig = useMemo(() => acknowledgeDocumentInsightForm(t), [t])

  const folderSelectOptions = useMemo(
    () => documentFolderRowsToSelectOptions(folders as Record<string, unknown>[]),
    [folders],
  )

  const categorySelectOptions = useMemo(
    () => knowledgeCategoryRowsToSelectOptions(categories as Record<string, unknown>[]),
    [categories],
  )

  const articleSelectOptions = useMemo(
    () => knowledgeArticleRowsToSelectOptions(articles as Record<string, unknown>[]),
    [articles],
  )

  const aiAgentSelectOptions = useMemo(
    () => aiAgentRowsToSelectOptions(aiAgents as Record<string, unknown>[]),
    [aiAgents],
  )

  const documentFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newDocumentForm(t), {
        folderId: folderSelectOptions,
      }),
    [t, folderSelectOptions],
  )

  const knowledgeArticleFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newKnowledgeArticleForm(t), {
        parentId: articleSelectOptions,
        categoryId: categorySelectOptions,
      }),
    [t, articleSelectOptions, categorySelectOptions],
  )

  const knowledgeCategoryFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newKnowledgeCategoryForm(t), {
        parentId: categorySelectOptions,
      }),
    [t, categorySelectOptions],
  )

  const documentFolderFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newDocumentFolderForm(t), {
        parentId: folderSelectOptions,
      }),
    [t, folderSelectOptions],
  )

  const processingJobFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newDocumentProcessingJobForm(t), {
        aiAgentId: aiAgentSelectOptions,
      }),
    [t, aiAgentSelectOptions],
  )

  const liveSections = useMemo(() => {
    const shared = documents.filter((d) => d.isShared).length
    const favorites = documents.filter((d) => d.isFavorite).length
    const published = articles.filter((a) => a.isPublished).length

    return mapDashboardWidgets(moduleConfig, (w) => {
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
            upload_document: () => setQuickActionForm({ form: documentFormConfig, action: "uploadDocument" }),
            new_article: () => setQuickActionForm({ form: knowledgeArticleFormConfig, action: "createArticle" }),
            create_article: () => setQuickActionForm({ form: knowledgeArticleFormConfig, action: "createArticle" }),
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
          })
  }, [documents, articles, moduleConfig, t, documentFormConfig, knowledgeArticleFormConfig])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
        if (tab.id === "knowledge-base" && tab.entityConfig) {
          return {
            ...tab,
            createForm: knowledgeArticleFormConfig,
            entityConfig: withTableActions(
              tab.entityConfig,
              [
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
                {
                  id: "edit-article",
                  label: "Edit",
                  requiresSelection: true,
                  onClick: (rows) => {
                    if (rows.length !== 1) return
                    setDocumentRowAction({
                      action: "updateArticle",
                      row: rows[0],
                      form: editKnowledgeArticleForm(t, rows[0]),
                    })
                  },
                },
                {
                  id: "publish-article",
                  label: "Publish",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) {
                        await setArticlePublished.mutateAsync({
                          articleId: row.id as string | number,
                          params: { isPublished: true },
                        })
                      }
                    } catch (e) {
                      setDocumentToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
                {
                  id: "unpublish-article",
                  label: "Unpublish",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) {
                        await setArticlePublished.mutateAsync({
                          articleId: row.id as string | number,
                          params: { isPublished: false },
                        })
                      }
                    } catch (e) {
                      setDocumentToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
                {
                  id: "lock-article",
                  label: "Lock",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) {
                        await lockKnowledgeArticle.mutateAsync(row.id as string | number)
                      }
                    } catch (e) {
                      setDocumentToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
                {
                  id: "unlock-article",
                  label: "Unlock",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) {
                        await unlockKnowledgeArticle.mutateAsync(row.id as string | number)
                      }
                    } catch (e) {
                      setDocumentToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
                {
                  id: "add-article-member",
                  label: "Add member",
                  requiresSelection: true,
                  onClick: (rows) => {
                    if (rows.length !== 1) return
                    setDocumentRowAction({
                      action: "addArticleMember",
                      row: rows[0],
                      form: articleMemberFormConfig,
                    })
                  },
                },
                {
                  id: "delete-article",
                  label: "Delete",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) {
                        await deleteKnowledgeArticle.mutateAsync(row.id as string | number)
                      }
                    } catch (e) {
                      setDocumentToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
              ],
              false,
            ),
          }
        }
        if (tab.id === "knowledge-categories" && tab.entityConfig) {
          return {
            ...tab,
            createForm: knowledgeCategoryFormConfig,
            entityConfig: addCsvToolbar(tab.entityConfig, [
              {
                id: "csv-kb-category-tab",
                label: t("documents.toolbar.importCategoryCsv"),
                onClick: (_rows) => setCsvKind("knowledge_category"),
              },
            ]),
          }
        }
        if (tab.id === "document-folders" && tab.entityConfig) {
          return {
            ...tab,
            createForm: documentFolderFormConfig,
            entityConfig: withTableActions(
              tab.entityConfig,
              [
                {
                  id: "edit-folder",
                  label: "Edit folder",
                  requiresSelection: true,
                  onClick: (rows) => {
                    if (rows.length !== 1) return
                    setDocumentRowAction({
                      action: "updateFolder",
                      row: rows[0],
                      form: mergeSelectOptionsForFields(editDocumentFolderForm(t, rows[0]), {
                        parentId: folderSelectOptions,
                      }),
                    })
                  },
                },
                {
                  id: "delete-folder",
                  label: "Delete folder",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) {
                        await deleteDocumentFolder.mutateAsync(row.id as string | number)
                      }
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
        if (tab.id === "documents-recycle-bin" && tab.entityConfig) {
          return {
            ...tab,
            entityConfig: withTableActions(
              tab.entityConfig,
              [
                {
                  id: "restore-document",
                  label: "Restore",
                  requiresSelection: true,
                  onClick: async (rows) => {
                    setDocumentToolbarError(null)
                    try {
                      for (const row of rows) {
                        await restoreDocument.mutateAsync(row.id as string | number)
                      }
                    } catch (e) {
                      setDocumentToolbarError(e instanceof Error ? e.message : String(e))
                    }
                  },
                },
                {
                  id: "purge-expired",
                  label: "Purge expired",
                  requiresSelection: false,
                  onClick: async () => {
                    setDocumentToolbarError(null)
                    try {
                      await purgeExpiredDocuments.mutateAsync()
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
        if (tab.id === "document-templates" && tab.entityConfig) {
          return {
            ...tab,
            createForm: documentTemplateFormConfig,
          }
        }
        if (tab.id === "mail-templates" && tab.entityConfig) {
          return {
            ...tab,
            createForm: mailTemplateFormConfig,
          }
        }
        if (tab.id === "document-processing" && tab.entityConfig) {
          return {
            ...tab,
            createForm: processingJobFormConfig,
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
                  id: "ask-ai",
                  label: "Ask AI",
                  onClick: (rows) => {
                    const selection = rows[0]
                      ? buildEntitySelection({
                          activeTab: "document-insights",
                          entityType: "document_insight",
                          row: rows[0],
                        })
                      : {
                          activeTab: "document-insights",
                          entityType: "document_insight",
                          selectionSummary: "Document insights",
                        }
                    openErpAiChat({ selection })
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
      setDocumentIndexContent,
      setDocumentRetention,
      purgeExpiredDocuments,
      applyDocumentLegalHold,
      updateDocumentPresence,
      restoreDocument,
      openErpAiChat,
      documentFormConfig,
      knowledgeArticleFormConfig,
      knowledgeCategoryFormConfig,
      documentFolderFormConfig,
      processingJobFormConfig,
    ],
  )

  const data = useMemo(
    () => ({
      documents: documents as unknown as Record<string, unknown>[],
      "knowledge-base": articles as unknown as Record<string, unknown>[],
      "knowledge-categories": categories as unknown as Record<string, unknown>[],
      "document-folders": folders as unknown as Record<string, unknown>[],
      "documents-recycle-bin": deletedDocuments as unknown as Record<string, unknown>[],
      "document-templates": documentTemplates as unknown as Record<string, unknown>[],
      "mail-templates": mailTemplates as unknown as Record<string, unknown>[],
      "document-processing": processingJobs as unknown as Record<string, unknown>[],
      "document-insights": aiInsights as unknown as Record<string, unknown>[],
    }),
    [
      documents,
      deletedDocuments,
      articles,
      categories,
      folders,
      documentTemplates,
      mailTemplates,
      processingJobs,
      aiInsights,
    ],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createDocument" || action === "uploadDocument") {
      const file = firstFileFromFormValue(formData.file)
      if (!file) {
        throw new Error(t("documents.forms.newDocument.fields.fileHint"))
      }
      const folderId = optionalBigIntU64(formData.folderId)
      const folderResidency =
        folderId != null
          ? folders.find((f) => String(f.id) === String(folderId))?.residencyRegion
          : undefined
      const residency =
        (typeof formData.residencyRegion === "string" && formData.residencyRegion.trim()) ||
        (typeof folderResidency === "string" ? folderResidency : undefined) ||
        undefined
      const uploaded = await uploadDocumentBlob({
        file,
        companyId: operatingCompanyId,
        residency: residency ? String(residency) : undefined,
      })
      const params = toCreateDocumentParams({
        ...formData,
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        mimetype: uploaded.mimetype,
        url: uploaded.url,
        checksum: uploaded.checksum,
        indexContent: formData.indexContent ?? uploaded.extractedText,
        residencyRegion: formData.residencyRegion ?? residency,
      })
      if (!params) {
        throw new Error("Document registration params incomplete after upload")
      }
      await createDocument.mutateAsync(params)
    } else if (action === "createArticle") {
      const params = toCreateKnowledgeArticleParams(formData, operatingCompanyId)
      if (!params) return
      await createKnowledgeArticle.mutateAsync(params)
    } else if (action === "createKnowledgeCategory") {
      const params = toCreateKnowledgeCategoryParams(formData, operatingCompanyId)
      if (!params) return
      await createKnowledgeCategory.mutateAsync(params)
    } else if (action === "createDocumentFolder") {
      const params = toCreateDocumentFolderParams(formData, operatingCompanyId)
      if (!params) return
      await createDocumentFolder.mutateAsync({
        companyId: operatingCompanyId,
        ...params,
      })
    } else if (action === "createDocumentTemplate") {
      const params = toCreateDocumentTemplateParams(formData)
      if (!params) throw new Error("Document template params incomplete")
      await createDocumentTemplate.mutateAsync(params)
    } else if (action === "createMailTemplate") {
      const params = toCreateMailTemplateParams(formData)
      if (!params) throw new Error("Mail template params incomplete")
      await createMailTemplate.mutateAsync(params)
    } else if (action === "createDocumentProcessingJob") {
      await createProcessingJob.mutateAsync(toCreateDocumentProcessingJobParams(formData))
    }
  }

  const isFormMutationPending =
    createDocument.isPending ||
    updateDocument.isPending ||
    deleteDocument.isPending ||
    restoreDocument.isPending ||
    lockDocument.isPending ||
    unlockDocument.isPending ||
    recordDocumentView.isPending ||
    addDocumentVersion.isPending ||
    setDocumentIndexContent.isPending ||
    setDocumentRetention.isPending ||
    purgeExpiredDocuments.isPending ||
    createKnowledgeArticle.isPending ||
    updateKnowledgeArticle.isPending ||
    deleteKnowledgeArticle.isPending ||
    lockKnowledgeArticle.isPending ||
    unlockKnowledgeArticle.isPending ||
    setArticlePublished.isPending ||
    addArticleMember.isPending ||
    createKnowledgeCategory.isPending ||
    createDocumentFolder.isPending ||
    updateDocumentFolder.isPending ||
    deleteDocumentFolder.isPending ||
    createDocumentTemplate.isPending ||
    createMailTemplate.isPending ||
    createProcessingJob.isPending ||
    completeProcessingJob.isPending ||
    approveProcessingJob.isPending ||
    acknowledgeInsight.isPending ||
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
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? documentFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      {csvKind && csvFormConfig ? (
        <CsvImportModal
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          onImport={async (text) => {
            if (csvKind === "knowledge_category") {
              await csvImports.importKnowledgeCategory.mutateAsync(text)
            } else {
              await csvImports.importKnowledgeArticle.mutateAsync(text)
            }
          }}
        />
      ) : null}
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
              if (documentRowAction.action === "updateDocument") {
                await updateDocument.mutateAsync({
                  documentId: documentRowAction.row.id as string | number,
                  params: {
                    name: formData.name,
                    description: formData.description,
                    isFavorite: Boolean(formData.isFavorite),
                    folderId: optionalBigIntU64(formData.folderId),
                  },
                })
              } else if (documentRowAction.action === "uploadVersion") {
                const file = firstFileFromFormValue(formData.file)
                if (!file) throw new Error("Select a file to upload")
                const residency =
                  typeof documentRowAction.row.residencyRegion === "string"
                    ? documentRowAction.row.residencyRegion
                    : undefined
                const uploaded = await uploadDocumentBlob({
                  file,
                  companyId: operatingCompanyId,
                  residency,
                })
                const params = toAddDocumentVersionParams({
                  ...formData,
                  fileName: uploaded.fileName,
                  fileSize: uploaded.fileSize,
                  mimetype: uploaded.mimetype,
                  url: uploaded.url,
                  checksum: uploaded.checksum,
                })
                if (!params) throw new Error("Version params incomplete after upload")
                await addDocumentVersion.mutateAsync({
                  documentId: documentRowAction.row.id as string | number,
                  params,
                })
                if (uploaded.extractedText) {
                  await setDocumentIndexContent.mutateAsync({
                    documentId: documentRowAction.row.id as string | number,
                    params: { content: uploaded.extractedText },
                  })
                }
                if (formData.unlockAfter !== false) {
                  await unlockDocument.mutateAsync(
                    documentRowAction.row.id as string | number,
                  )
                }
              } else if (documentRowAction.action === "reindexDocument") {
                const params = toSetDocumentIndexContentParams(formData)
                if (!params) throw new Error("Index content is required")
                await setDocumentIndexContent.mutateAsync({
                  documentId: documentRowAction.row.id as string | number,
                  params,
                })
              } else if (documentRowAction.action === "setRetention") {
                await setDocumentRetention.mutateAsync({
                  documentId: documentRowAction.row.id as string | number,
                  params: toSetDocumentRetentionParams(formData),
                })
              } else if (documentRowAction.action === "updateArticle") {
                await updateKnowledgeArticle.mutateAsync({
                  articleId: documentRowAction.row.id as string | number,
                  params: toUpdateKnowledgeArticleParams(formData, operatingCompanyId),
                })
              } else if (documentRowAction.action === "updateFolder") {
                await updateDocumentFolder.mutateAsync({
                  folderId: documentRowAction.row.id as string | number,
                  params: toUpdateDocumentFolderParams(formData),
                })
              } else if (documentRowAction.action === "addArticleMember") {
                const member = String(formData.member ?? "").trim()
                if (!member) throw new Error("Member identity is required")
                await addArticleMember.mutateAsync({
                  articleId: documentRowAction.row.id as string | number,
                  member,
                })
              }
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
