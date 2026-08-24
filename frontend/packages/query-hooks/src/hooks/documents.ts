"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
/**
 * Documents hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Documents module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  AiDocumentProcessingJob,
  AiInsight,
  CreateDocumentParams,
  CreateKnowledgeArticleParams,
  Document,
  DocumentFolder,
  KnowledgeArticle,
  KnowledgeArticleCategory,
} from "@lumiere/stdb/types"

type ScalarId = bigint | number | string

function toScalarU64(v: ScalarId): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

import { responseErrorMessage as parseCallErrorDocuments } from "@lumiere/api-client/response-error"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useDocuments(
  organizationId: bigint,
  initialData?: Document[],
) {
  return useQuery<Document[]>({
    queryKey: ['documents', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/documents', 'Failed to fetch documents'),
    staleTime: 30_000,
    initialData,
  })
}

export function useKnowledgeArticles(
  organizationId: bigint,
  initialData?: KnowledgeArticle[],
) {
  return useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-articles', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/knowledge-articles', 'Failed to fetch knowledge articles'),
    staleTime: 30_000,
    initialData,
  })
}

export function useKnowledgeCategories(
  organizationId: bigint,
  initialData?: KnowledgeArticleCategory[],
) {
  return useQuery<KnowledgeArticleCategory[]>({
    queryKey: ['knowledge-categories', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/knowledge-categories', 'Failed to fetch knowledge categories'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDocumentFolders(
  organizationId: bigint,
  initialData?: DocumentFolder[],
) {
  return useQuery<DocumentFolder[]>({
    queryKey: ['document-folders', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/document-folders', 'Failed to fetch document folders'),
    staleTime: 30_000,
    initialData,
  })
}

export function useAiDocumentProcessingJobs(
  organizationId: bigint,
  initialData?: AiDocumentProcessingJob[],
) {
  return useQuery<AiDocumentProcessingJob[]>({
    queryKey: ['ai-document-processing-jobs', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/ai-document-processing-jobs',
        'Failed to fetch document processing jobs',
      ),
    staleTime: 30_000,
    initialData,
  })
}

/** Same rows as Settings → AI; shared query key keeps cache in sync across the app. */
export function useAiInsightsForOrg(organizationId: bigint, initialData?: AiInsight[]) {
  return useQuery<AiInsight[]>({
    queryKey: ['ai-insights', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/ai-insights', 'Failed to fetch AI insights'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDocumentVersions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['document-versions', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/document-versions', 'Failed to fetch document versions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDeletedDocuments(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['documents-deleted', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/documents-deleted', 'Failed to fetch deleted documents'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateDocument(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateDocumentParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_document", { companyId: companyId, params: stdbParamsToJson(params as object, "CreateDocumentParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      documentId,
      params,
    }: {
      documentId: bigint | number | string
      params: Record<string, unknown>
    }) => {
      const { urlPath, init } = stdbBffCommandPost("update_document", { documentId: toScalarU64(documentId), params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useDeleteDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("delete_document", { documentId: toScalarU64(documentId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete document')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['documents', k] })
      void qc.invalidateQueries({ queryKey: ['documents-deleted', k] })
      void qc.invalidateQueries({ queryKey: ['document-folders', k] })
    },
  })
}

export function useRestoreDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("restore_document", { documentId: toScalarU64(documentId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['documents', k] })
      void qc.invalidateQueries({ queryKey: ['documents-deleted', k] })
      void qc.invalidateQueries({ queryKey: ['document-folders', k] })
    },
  })
}

export function useLockDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      input:
        | ScalarId
        | { documentId: ScalarId; leaseSeconds?: number | null },
    ) => {
      const documentId =
        typeof input === "object" && input !== null && "documentId" in input
          ? input.documentId
          : input
      const leaseSeconds =
        typeof input === "object" && input !== null && "documentId" in input
          ? (input.leaseSeconds ?? null)
          : null
      const { urlPath, init } = stdbBffCommandPost("lock_document", { documentId: toScalarU64(documentId), leaseSeconds: leaseSeconds == null ? null : Number(leaseSeconds) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to lock document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useUnlockDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("unlock_document", { documentId: toScalarU64(documentId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to unlock document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useAddDocumentVersion(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      documentId,
      params,
    }: {
      documentId: bigint | number | string
      params: Record<string, unknown>
    }) => {
      const { urlPath, init } = stdbBffCommandPost("add_document_version", { documentId: toScalarU64(documentId), params: stdbParamsToJson(params as object, "AddDocumentVersionParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add document version')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['document-versions', rqBigIntKey(organizationId)] })
    },
  })
}

export function useRecordDocumentView(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("record_document_view", { documentId: toScalarU64(documentId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to record document view')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useSetDocumentIndexContent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      documentId,
      params,
    }: {
      documentId: bigint | number | string
      params: { content: string; language?: string }
    }) => {
      const { urlPath, init } = stdbBffCommandPost("set_document_index_content", { documentId: toScalarU64(documentId), params: stdbParamsToJson(params as object, "SetDocumentIndexContentParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useSetDocumentRetention(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      documentId,
      params,
    }: {
      documentId: bigint | number | string
      params: { classificationId?: bigint; retentionDays?: number }
    }) => {
      const { urlPath, init } = stdbBffCommandPost("set_document_retention", { documentId: toScalarU64(documentId), params: stdbParamsToJson(params as object, "SetDocumentRetentionParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['documents', k] })
      void qc.invalidateQueries({ queryKey: ['documents-deleted', k] })
    },
  })
}

export function usePurgeExpiredDocuments(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { urlPath, init } = stdbBffCommandPost("purge_expired_documents", {  })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['documents', k] })
      void qc.invalidateQueries({ queryKey: ['documents-deleted', k] })
      void qc.invalidateQueries({ queryKey: ['document-folders', k] })
    },
  })
}

export function useScheduleDocumentRetentionPurge(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params?: { delaySeconds?: number }) => {
      const { urlPath, init } = stdbBffCommandPost("schedule_document_retention_purge", { params: stdbParamsToJson(
          { delaySeconds: params?.delaySeconds ?? 60 } as object,
          "ScheduleDocumentRetentionPurgeParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['documents', k] })
      void qc.invalidateQueries({ queryKey: ['documents-deleted', k] })
    },
  })
}

export function useApplyDocumentLegalHold(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      documentId,
      reason,
    }: {
      documentId: bigint | number | string
      reason: string
    }) => {
      const { urlPath, init } = stdbBffCommandPost("apply_document_legal_hold", { documentId: toScalarU64(documentId), params: stdbParamsToJson({ reason, metadata: undefined } as object, "ApplyDocumentLegalHoldParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateDocumentPresence(organizationId: bigint) {
  return useMutation({
    mutationFn: async ({
      documentId,
      userName,
    }: {
      documentId: bigint | number | string
      userName: string
    }) => {
      const { urlPath, init } = stdbBffCommandPost("update_document_presence", { documentId: toScalarU64(documentId), userName: userName })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
  })
}

export function useCreateDocumentSignatureRequest(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      documentId,
      params,
    }: {
      documentId: bigint | number | string
      params: {
        provider: string
        externalEnvelopeId: string
        signersJson?: string
        metadata?: string
      }
    }) => {
      const { urlPath, init } = stdbBffCommandPost("create_document_signature_request", { documentId: toScalarU64(documentId), params: stdbParamsToJson(params as object, "CreateDocumentSignatureRequestParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateDocumentFolder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const companyId = params.companyId != null ? String(params.companyId) : null
      const payload = companyId === null ? params : { ...params, companyId: undefined }

      const { urlPath, init } = stdbBffCommandPost("create_document_folder", { companyId: companyId, params: stdbParamsToJson(payload as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create document folder')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['document-folders', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateDocumentFolder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      folderId,
      params,
    }: {
      folderId: ScalarId
      params: Record<string, unknown>
    }) => {
      const { urlPath, init } = stdbBffCommandPost("update_document_folder", { folderId: toScalarU64(folderId), params: stdbParamsToJson(params, "UpdateDocumentFolderParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['document-folders', rqBigIntKey(organizationId)] }),
  })
}

export function useDeleteDocumentFolder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (folderId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost("delete_document_folder", { folderId: toScalarU64(folderId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['document-folders', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateKnowledgeArticle(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateKnowledgeArticleParams>({
    mutationFn: async (params) => {
      const payload = {
        ...params,
        ...(params.companyId == null && companyId != null ? { companyId } : {}),
      }
      const { urlPath, init } = stdbBffCommandPost("create_knowledge_article", { params: stdbParamsToJson(payload as object, "CreateKnowledgeArticleParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create knowledge article')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

export function useUpdateKnowledgeArticle(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      articleId,
      params,
    }: {
      articleId: bigint | number | string
      params: Record<string, unknown>
    }) => {
      const payload = {
        ...params,
        ...(params['companyId'] == null && companyId != null ? { companyId } : {}),
      }
      const { urlPath, init } = stdbBffCommandPost("update_knowledge_article", { articleId: toScalarU64(articleId), params: stdbParamsToJson(payload as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update knowledge article')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

export function useDeleteKnowledgeArticle(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (articleId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("delete_knowledge_article", { articleId: toScalarU64(articleId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete knowledge article')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

export function useLockKnowledgeArticle(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (articleId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("lock_knowledge_article", { articleId: toScalarU64(articleId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to lock knowledge article')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

export function useUnlockKnowledgeArticle(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (articleId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("unlock_knowledge_article", { articleId: toScalarU64(articleId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to unlock knowledge article')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

export function useSetArticlePublished(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      articleId,
      params,
    }: {
      articleId: bigint | number | string
      params: Record<string, unknown>
    }) => {
      const payload = {
        ...params,
        ...(params['companyId'] == null && companyId != null ? { companyId } : {}),
      }
      const { urlPath, init } = stdbBffCommandPost("set_article_published", { articleId: toScalarU64(articleId), params: stdbParamsToJson(payload as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update article publication state')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

export function useAddArticleMember(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      articleId,
      member,
    }: {
      articleId: bigint | number | string
      member: string
    }) => {
      const { urlPath, init } = stdbBffCommandPost("add_article_member", { articleId: toScalarU64(articleId), member: member })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add article member')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

export function useRemoveArticleMember(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      articleId,
      member,
    }: {
      articleId: bigint | number | string
      member: string
    }) => {
      const { urlPath, init } = stdbBffCommandPost("remove_article_member", { articleId: toScalarU64(articleId), member: member })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to remove article member')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

export function useCreateKnowledgeCategory(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const payload = {
        ...params,
        ...(params['companyId'] == null && companyId != null ? { companyId } : {}),
      }
      const { urlPath, init } = stdbBffCommandPost("create_knowledge_category", { params: stdbParamsToJson(payload as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create knowledge category')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

export function useUpdateKnowledgeCategory(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      categoryId,
      params,
    }: {
      categoryId: bigint | number | string
      params: Record<string, unknown>
    }) => {
      const payload = {
        ...params,
        ...(params['companyId'] == null && companyId != null ? { companyId } : {}),
      }
      const { urlPath, init } = stdbBffCommandPost("update_knowledge_category", { categoryId: toScalarU64(categoryId), params: stdbParamsToJson(payload as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update knowledge category')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

export function useDeleteKnowledgeCategory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (categoryId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("delete_knowledge_category", { categoryId: toScalarU64(categoryId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete knowledge category')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['knowledge-categories', k] })
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', k] })
    },
  })
}

function useImportKnowledgeCategoryCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_knowledge_category_csv", { csvData: csvData })
      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorDocuments(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
  })
}

function useImportKnowledgeArticleCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_knowledge_article_csv", { csvData: csvData })
      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorDocuments(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
  })
}

/** Knowledge base CSV import mutations (org-scoped reducers). */
export function useDocumentsCsvImportMutations(organizationId: bigint) {
  return {
    importKnowledgeCategory: useImportKnowledgeCategoryCsv(organizationId),
    importKnowledgeArticle: useImportKnowledgeArticleCsv(organizationId),
  }
}

function companyIdArg(row: Record<string, unknown>): number | null {
  const v = row.companyId
  if (v == null || v === '') return null
  const n = typeof v === 'bigint' ? Number(v) : Number(v)
  return Number.isFinite(n) ? n : null
}

function rowId(row: Record<string, unknown>): number {
  const v = row.id
  const n = typeof v === 'bigint' ? Number(v) : Number(v)
  if (!Number.isFinite(n)) throw new Error('Invalid row id')
  return n
}

export function useCreateDocumentProcessingJob(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const documentType = String(params.documentType ?? "").trim()
      const jobType = String(params.jobType ?? "").trim()
      if (!documentType) throw new Error("documentType is required")
      if (!jobType) throw new Error("jobType is required")

      const aiRaw = params.aiAgentId
      let aiAgentId: bigint | null = null
      if (aiRaw != null && String(aiRaw).trim() !== "") {
        const n = BigInt(String(aiRaw).trim())
        if (n <= 0n) throw new Error("AI agent id must be a positive integer")
        aiAgentId = n
      }
      const { urlPath, init } = stdbBffCommandPost("create_document_processing_job", { companyId: companyId, params: stdbParamsToJson({
          document_type: documentType,
          job_type: jobType,
          ai_agent_id: aiAgentId,
          input_data:
            typeof params.inputData === "string" && params.inputData.trim() !== ""
              ? params.inputData.trim()
              : null,
          metadata:
            typeof params.metadata === "string" && params.metadata.trim() !== ""
              ? params.metadata.trim()
              : null,
        } as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['ai-document-processing-jobs', rqBigIntKey(organizationId)] }),
  })
}

export function useCompleteDocumentProcessingJob(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      row,
      extractedData,
      modelUsed,
      confidenceScore,
      tokensUsed,
      cost,
      errorMessage,
    }: {
      row: Record<string, unknown>
      extractedData: string | null
      modelUsed: string | null
      confidenceScore: number | null
      tokensUsed: number | null
      cost: number | null
      errorMessage: string | null
    }) => {
      const jobId = rowId(row)
      const params: Record<string, unknown> = {
        extractedData,
        modelUsed,
        confidenceScore,
        tokensUsed,
        cost,
        errorMessage,
      }
      const { urlPath, init } = stdbBffCommandPost("complete_document_processing_job", { companyId: companyIdArg(row), jobId: jobId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['ai-document-processing-jobs', rqBigIntKey(organizationId)] }),
  })
}

export function useApproveDocumentProcessingJob(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: Record<string, unknown>) => {
      const jobId = rowId(row)
      const { urlPath, init } = stdbBffCommandPost("approve_document_processing_job", { companyId: companyIdArg(row), jobId: jobId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['ai-document-processing-jobs', rqBigIntKey(organizationId)] }),
  })
}

export function useAcknowledgeInsight(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      row,
      actionTaken,
    }: {
      row: Record<string, unknown>
      actionTaken: string | null
    }) => {
      const insightId = rowId(row)
      const { urlPath, init } = stdbBffCommandPost("acknowledge_insight", { companyId: companyIdArg(row), insightId: insightId, actionTaken: actionTaken })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorDocuments(r))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['ai-insights', rqBigIntKey(organizationId)] }),
  })
}

export type DocumentsCsvImportMutations = ReturnType<typeof useDocumentsCsvImportMutations>

// ── Types (re-exported so client components import from one place) ────────────
export type {
  AiDocumentProcessingJob,
  AiInsight,
  CreateDocumentParams,
  CreateKnowledgeArticleParams,
  Document,
  DocumentFolder,
  KnowledgeArticle,
  KnowledgeArticleCategory,
} from '@lumiere/stdb/types'
