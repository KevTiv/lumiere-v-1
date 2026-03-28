/**
 * Documents hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Documents module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useDocuments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['documents', organizationId.toString()],
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
    queryKey: ['knowledge-articles', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/knowledge-articles', 'Failed to fetch knowledge articles'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', organizationId.toString()] }),
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
      const r = await fetch('/api/call/update_document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(documentId), params]),
      })
      if (!r.ok) throw new Error('Failed to update document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', organizationId.toString()] }),
  })
}

export function useDeleteDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: bigint | number | string) => {
      const r = await fetch('/api/call/delete_document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(documentId)]),
      })
      if (!r.ok) throw new Error('Failed to delete document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', organizationId.toString()] }),
  })
}

export function useLockDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: bigint | number | string) => {
      const r = await fetch('/api/call/lock_document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(documentId)]),
      })
      if (!r.ok) throw new Error('Failed to lock document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', organizationId.toString()] }),
  })
}

export function useUnlockDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: bigint | number | string) => {
      const r = await fetch('/api/call/unlock_document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(documentId)]),
      })
      if (!r.ok) throw new Error('Failed to unlock document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', organizationId.toString()] }),
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
      const r = await fetch('/api/call/add_document_version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(documentId), params]),
      })
      if (!r.ok) throw new Error('Failed to add document version')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', organizationId.toString()] }),
  })
}

export function useRecordDocumentView(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: bigint | number | string) => {
      const r = await fetch('/api/call/record_document_view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(documentId)]),
      })
      if (!r.ok) throw new Error('Failed to record document view')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', organizationId.toString()] }),
  })
}

export function useCreateDocumentFolder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const companyId = params.companyId != null ? String(params.companyId) : null
      const payload = companyId === null ? params : { ...params, companyId: undefined }

      const r = await fetch('/api/call/create_document_folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId, payload]),
      })
      if (!r.ok) throw new Error('Failed to create document folder')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', organizationId.toString()] }),
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
      const r = await fetch('/api/call/create_knowledge_article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), payload]),
      })
      if (!r.ok) throw new Error('Failed to create knowledge article')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
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
      const r = await fetch('/api/call/update_knowledge_article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(articleId), payload]),
      })
      if (!r.ok) throw new Error('Failed to update knowledge article')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
  })
}

export function useDeleteKnowledgeArticle(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (articleId: bigint | number | string) => {
      const r = await fetch('/api/call/delete_knowledge_article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(articleId)]),
      })
      if (!r.ok) throw new Error('Failed to delete knowledge article')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
  })
}

export function useLockKnowledgeArticle(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (articleId: bigint | number | string) => {
      const r = await fetch('/api/call/lock_knowledge_article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(articleId)]),
      })
      if (!r.ok) throw new Error('Failed to lock knowledge article')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
  })
}

export function useUnlockKnowledgeArticle(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (articleId: bigint | number | string) => {
      const r = await fetch('/api/call/unlock_knowledge_article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(articleId)]),
      })
      if (!r.ok) throw new Error('Failed to unlock knowledge article')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
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
      const r = await fetch('/api/call/set_article_published', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(articleId), payload]),
      })
      if (!r.ok) throw new Error('Failed to update article publication state')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
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
      const r = await fetch('/api/call/add_article_member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(articleId), member]),
      })
      if (!r.ok) throw new Error('Failed to add article member')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
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
      const r = await fetch('/api/call/remove_article_member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(articleId), member]),
      })
      if (!r.ok) throw new Error('Failed to remove article member')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
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
      const r = await fetch('/api/call/create_knowledge_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), payload]),
      })
      if (!r.ok) throw new Error('Failed to create knowledge category')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
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
      const r = await fetch('/api/call/update_knowledge_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(categoryId), payload]),
      })
      if (!r.ok) throw new Error('Failed to update knowledge category')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
  })
}

export function useDeleteKnowledgeCategory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (categoryId: bigint | number | string) => {
      const r = await fetch('/api/call/delete_knowledge_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(categoryId)]),
      })
      if (!r.ok) throw new Error('Failed to delete knowledge category')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['knowledge-articles', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateDocumentParams,
  CreateKnowledgeArticleParams,
} from '@lumiere/stdb'
