"use client"

/**
 * Proposals hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Proposals module.
 */


import { proposalsBffPost } from "@lumiere/stdb/commands"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

function toScalarU64(v: bigint | number | string): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useProposals(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['proposals', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/proposals', 'Failed to fetch proposals'),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalSections(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['proposal-sections', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/proposal-sections', 'Failed to fetch proposal sections'),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalLineItems(
  organizationId: bigint,
  proposalId?: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['proposal-line-items', rqBigIntKey(organizationId), proposalId?.toString()],
    queryFn: () => fetchQueryList('/api/query/proposal-line-items', 'Failed to fetch proposal line items'),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalVersions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['proposal-versions', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/proposal-versions', 'Failed to fetch proposal versions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalSourceDocs(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['proposal-source-docs', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/proposal-source-docs', 'Failed to fetch proposal source docs'),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalPresence(
  organizationId: bigint,
  proposalId?: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['proposal-presence', rqBigIntKey(organizationId), proposalId?.toString()],
    queryFn: () => fetchQueryList('/api/query/proposal-presence', 'Failed to fetch proposal presence'),
    staleTime: 30_000,
    initialData,
  })
}

export function useProposalComments(
  organizationId: bigint,
  proposalId?: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['proposal-comments', rqBigIntKey(organizationId), proposalId?.toString()],
    queryFn: () => fetchQueryList('/api/query/proposal-comments', 'Failed to fetch proposal comments'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useUpsertProposalSection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      sectionId?: bigint | number | string | null
      title: string
      content: string
      status: string
      sequence?: number
      aiSuggestion?: string | null
    }) => {
      const { urlPath, init } = proposalsBffPost("upsert_proposal_section", [
          Number(params.proposalId),
          params.sectionId != null ? Number(params.sectionId) : 0,
          params.title,
          params.content,
          params.status,
          params.sequence ?? 0,
          params.aiSuggestion ?? null,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to upsert proposal section')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposal-sections'] }),
  })
}

export function useCreateProposal() {
  const qc = useQueryClient()
  return useMutation<void, Error, {
    organizationId: bigint | number | string
    title: string
    clientName: string
    type?: string
    value: number
    deadline?: Date | string | null
    description?: string | null
    documentFolderId?: bigint | number | string | null
  }>({
    mutationFn: async (params) => {
      const deadline = params.deadline instanceof Date
        ? params.deadline.toISOString()
        : params.deadline ?? null
      const { urlPath, init } = proposalsBffPost("create_proposal", [
          Number(params.organizationId),
          params.title,
          params.clientName,
          params.value,
          deadline,
          params.description ?? null,
          params.documentFolderId != null ? Number(params.documentFolderId) : null,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create proposal')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useUpdateProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      title: string
      clientName: string
      value: number
      deadline?: string | Date | null
      description?: string | null
    }) => {
      const deadline =
        params.deadline instanceof Date
          ? params.deadline.toISOString()
          : params.deadline ?? null

      const { urlPath, init } = proposalsBffPost("update_proposal", [
          Number(params.proposalId),
          params.title,
          params.clientName,
          params.value,
          deadline,
          params.description ?? null,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update proposal')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useUpdateProposalStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      status: string
    }) => {
      const { urlPath, init } = proposalsBffPost("update_proposal_status", [Number(params.proposalId), params.status])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update proposal status')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useAddProposalLineItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      sectionId?: bigint | number | string | null
      productId: bigint | number | string
      productName: string
      quantity: number
      priceUnit: number
      discount: number
      notes?: string | null
    }) => {
      const { urlPath, init } = proposalsBffPost("add_proposal_line_item", [
          toScalarU64(params.proposalId),
          params.sectionId != null ? toScalarU64(params.sectionId) : null,
          toScalarU64(params.productId),
          params.productName,
          params.quantity,
          params.priceUnit,
          params.discount,
          params.notes ?? null,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add proposal line item')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useUpdateProposalLineItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      lineItemId: bigint | number | string
      quantity: number
      priceUnit: number
      discount: number
      notes?: string | null
    }) => {
      const { urlPath, init } = proposalsBffPost("update_proposal_line_item", [
          Number(params.lineItemId),
          params.quantity,
          params.priceUnit,
          params.discount,
          params.notes ?? null,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update proposal line item')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useDeleteProposalLineItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineItemId: bigint | number | string) => {
      const { urlPath, init } = proposalsBffPost("delete_proposal_line_item", [Number(lineItemId)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete proposal line item')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useDeleteProposalSection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sectionId: bigint | number | string) => {
      const { urlPath, init } = proposalsBffPost("delete_proposal_section", [Number(sectionId)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete proposal section')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useSaveProposalVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      message: string
      sectionsJson: string
    }) => {
      const { urlPath, init } = proposalsBffPost("save_proposal_version", [
          Number(params.proposalId),
          params.message,
          params.sectionsJson,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to save proposal version')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useAddProposalSourceDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      name: string
      content: string
      docType: string
      wordCount: number
    }) => {
      const { urlPath, init } = proposalsBffPost("add_proposal_source_doc", [
          Number(params.proposalId),
          params.name,
          params.content,
          params.docType,
          params.wordCount,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add proposal source document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useDeleteProposalSourceDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (docId: bigint | number | string) => {
      const { urlPath, init } = proposalsBffPost("delete_proposal_source_doc", [Number(docId)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete proposal source document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useUpdateProposalSourceDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      docId: bigint | number | string
      name?: string
      content?: string
      docType?: string
      wordCount?: number
    }) => {
      const { urlPath, init } = proposalsBffPost("update_proposal_source_doc", [
          Number(params.docId),
          stdbParamsToJson({
            name: params.name ?? null,
            content: params.content ?? null,
            docType: params.docType ?? null,
            wordCount: params.wordCount ?? null,
          }),
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update proposal source document')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['proposals'] })
      void qc.invalidateQueries({ queryKey: ['proposal-source-docs'] })
    },
  })
}

export function useReorderProposalLineItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      orderedIds: Array<bigint | number | string>
    }) => {
      const { urlPath, init } = proposalsBffPost("reorder_proposal_line_items", [
          Number(params.proposalId),
          params.orderedIds.map((id) => Number(id)),
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to reorder proposal line items')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useUpdateProposalPresence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      sectionId?: bigint | number | string | null
      userName: string
    }) => {
      const { urlPath, init } = proposalsBffPost("update_proposal_presence", [
          Number(params.proposalId),
          params.sectionId != null ? Number(params.sectionId) : null,
          params.userName,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update proposal presence')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useClearProposalPresence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (proposalId: bigint | number | string) => {
      const { urlPath, init } = proposalsBffPost("clear_proposal_presence", [Number(proposalId)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to clear proposal presence')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useAddProposalComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      sectionId: bigint | number | string
      content: string
      parentId?: bigint | number | string | null
      authorName: string
    }) => {
      const { urlPath, init } = proposalsBffPost("add_proposal_comment", [
          toScalarU64(params.proposalId),
          toScalarU64(params.sectionId),
          params.content,
          params.parentId != null ? toScalarU64(params.parentId) : null,
          params.authorName,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add proposal comment')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useResolveProposalComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (commentId: bigint | number | string) => {
      const { urlPath, init } = proposalsBffPost("resolve_proposal_comment", [Number(commentId)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to resolve proposal comment')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateProposalParams } from "@lumiere/stdb/types"
