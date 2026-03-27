/**
 * Documents hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Documents module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useDocuments(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['documents', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/documents')
      if (!r.ok) throw new Error('Failed to fetch documents')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useKnowledgeArticles(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['knowledge-articles', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/knowledge-articles')
      if (!r.ok) throw new Error('Failed to fetch knowledge articles')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateDocument(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
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

export function useCreateKnowledgeArticle(organizationId: bigint, _secondArg?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_knowledge_article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create knowledge article')
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
