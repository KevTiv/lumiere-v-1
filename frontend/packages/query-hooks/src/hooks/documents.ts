"use client"

/**
 * Documents hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Documents module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { documentsBffPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

type ScalarId = bigint | number | string

function toScalarU64(v: ScalarId): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

async function parseCallErrorDocuments(r: Response): Promise<string> {
  try {
    const body = (await r.json()) as { error?: string; message?: string }
    return body.error ?? body.message ?? r.statusText
  } catch {
    return r.statusText
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useDocuments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['documents', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/documents', 'Failed to fetch documents'),
    staleTime: 30_000,
    initialData,
  })
}

export function useKnowledgeArticles(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['knowledge-articles', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/knowledge-articles', 'Failed to fetch knowledge articles'),
    staleTime: 30_000,
    initialData,
  })
}

export function useAiDocumentProcessingJobs(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
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
export function useAiInsightsForOrg(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['ai-insights', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/ai-insights', 'Failed to fetch AI insights'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateDocument(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = documentsBffPost("create_document", [
        organizationId,
        companyId,
        stdbParamsToJson(params as object),
      ])
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
      const { urlPath, init } = documentsBffPost("update_document", [
        organizationId,
        toScalarU64(documentId),
        stdbParamsToJson(params as object),
      ])
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
      const { urlPath, init } = documentsBffPost("delete_document", [
        organizationId,
        toScalarU64(documentId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useLockDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: bigint | number | string) => {
      const { urlPath, init } = documentsBffPost("lock_document", [
        organizationId,
        toScalarU64(documentId),
      ])
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
      const { urlPath, init } = documentsBffPost("unlock_document", [
        organizationId,
        toScalarU64(documentId),
      ])
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
      const { urlPath, init } = documentsBffPost("add_document_version", [
        organizationId,
        toScalarU64(documentId),
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add document version')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useRecordDocumentView(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: bigint | number | string) => {
      const { urlPath, init } = documentsBffPost("record_document_view", [
        organizationId,
        toScalarU64(documentId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to record document view')
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

      const { urlPath, init } = documentsBffPost("create_document_folder", [
        organizationId,
        companyId,
        stdbParamsToJson(payload as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create document folder')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateKnowledgeArticle(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const payload = {
        ...params,
        ...(params['companyId'] == null && companyId != null ? { companyId } : {}),
      }
      const { urlPath, init } = documentsBffPost("create_knowledge_article", [
        organizationId,
        stdbParamsToJson(payload as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create knowledge article')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = documentsBffPost("update_knowledge_article", [
        organizationId,
        toScalarU64(articleId),
        stdbParamsToJson(payload as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update knowledge article')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
  })
}

export function useDeleteKnowledgeArticle(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (articleId: bigint | number | string) => {
      const { urlPath, init } = documentsBffPost("delete_knowledge_article", [
        organizationId,
        toScalarU64(articleId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete knowledge article')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
  })
}

export function useLockKnowledgeArticle(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (articleId: bigint | number | string) => {
      const { urlPath, init } = documentsBffPost("lock_knowledge_article", [
        organizationId,
        toScalarU64(articleId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to lock knowledge article')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
  })
}

export function useUnlockKnowledgeArticle(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (articleId: bigint | number | string) => {
      const { urlPath, init } = documentsBffPost("unlock_knowledge_article", [
        organizationId,
        toScalarU64(articleId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to unlock knowledge article')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = documentsBffPost("set_article_published", [
        organizationId,
        toScalarU64(articleId),
        stdbParamsToJson(payload as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update article publication state')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = documentsBffPost("add_article_member", [
        organizationId,
        toScalarU64(articleId),
        member,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add article member')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = documentsBffPost("remove_article_member", [
        organizationId,
        toScalarU64(articleId),
        member,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to remove article member')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = documentsBffPost("create_knowledge_category", [
        organizationId,
        stdbParamsToJson(payload as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create knowledge category')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = documentsBffPost("update_knowledge_category", [
        organizationId,
        toScalarU64(categoryId),
        stdbParamsToJson(payload as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update knowledge category')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
  })
}

export function useDeleteKnowledgeCategory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (categoryId: bigint | number | string) => {
      const { urlPath, init } = documentsBffPost("delete_knowledge_category", [
        organizationId,
        toScalarU64(categoryId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete knowledge category')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', rqBigIntKey(organizationId)] }),
  })
}

function useImportKnowledgeCategoryCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = documentsBffPost("import_knowledge_category_csv", [
        organizationId,
        csvData,
      ])
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
      const { urlPath, init } = documentsBffPost("import_knowledge_article_csv", [
        organizationId,
        csvData,
      ])
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
      const { urlPath, init } = documentsBffPost("create_document_processing_job", [
        organizationId,
        companyId,
        stdbParamsToJson({
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
        } as object),
      ])
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
      const { urlPath, init } = documentsBffPost("complete_document_processing_job", [
        organizationId,
        companyIdArg(row),
        jobId,
        stdbParamsToJson(params),
      ])
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
      const { urlPath, init } = documentsBffPost("approve_document_processing_job", [
        organizationId,
        companyIdArg(row),
        jobId,
      ])
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
      const { urlPath, init } = documentsBffPost("acknowledge_insight", [
        organizationId,
        companyIdArg(row),
        insightId,
        actionTaken,
      ])
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
  CreateDocumentParams,
  CreateKnowledgeArticleParams,
} from '@lumiere/stdb/types'
