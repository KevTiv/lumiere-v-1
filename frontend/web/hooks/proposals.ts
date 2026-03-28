/**
 * Proposals hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Proposals module.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useProposals(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['proposals', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/proposals', 'Failed to fetch proposals'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateProposal() {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const orgId = params.organizationId
      const r = await fetch('/api/call/create_proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([orgId?.toString(), params]),
      })
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

      const r = await fetch('/api/call/update_proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          Number(params.proposalId),
          params.title,
          params.clientName,
          params.value,
          deadline,
          params.description ?? null,
        ]),
      })
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
      const r = await fetch('/api/call/update_proposal_status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(params.proposalId), params.status]),
      })
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
      const r = await fetch('/api/call/add_proposal_line_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          Number(params.proposalId),
          params.sectionId != null ? Number(params.sectionId) : null,
          Number(params.productId),
          params.productName,
          params.quantity,
          params.priceUnit,
          params.discount,
          params.notes ?? null,
        ]),
      })
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
      const r = await fetch('/api/call/update_proposal_line_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          Number(params.lineItemId),
          params.quantity,
          params.priceUnit,
          params.discount,
          params.notes ?? null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to update proposal line item')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useDeleteProposalLineItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineItemId: bigint | number | string) => {
      const r = await fetch('/api/call/delete_proposal_line_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(lineItemId)]),
      })
      if (!r.ok) throw new Error('Failed to delete proposal line item')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useDeleteProposalSection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sectionId: bigint | number | string) => {
      const r = await fetch('/api/call/delete_proposal_section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(sectionId)]),
      })
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
      const r = await fetch('/api/call/save_proposal_version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          Number(params.proposalId),
          params.message,
          params.sectionsJson,
        ]),
      })
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
      const r = await fetch('/api/call/add_proposal_source_doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          Number(params.proposalId),
          params.name,
          params.content,
          params.docType,
          params.wordCount,
        ]),
      })
      if (!r.ok) throw new Error('Failed to add proposal source document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useDeleteProposalSourceDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (docId: bigint | number | string) => {
      const r = await fetch('/api/call/delete_proposal_source_doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(docId)]),
      })
      if (!r.ok) throw new Error('Failed to delete proposal source document')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useReorderProposalLineItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint | number | string
      orderedIds: Array<bigint | number | string>
    }) => {
      const r = await fetch('/api/call/reorder_proposal_line_items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          Number(params.proposalId),
          params.orderedIds.map((id) => Number(id)),
        ]),
      })
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
      const r = await fetch('/api/call/update_proposal_presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          Number(params.proposalId),
          params.sectionId != null ? Number(params.sectionId) : null,
          params.userName,
        ]),
      })
      if (!r.ok) throw new Error('Failed to update proposal presence')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useClearProposalPresence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (proposalId: bigint | number | string) => {
      const r = await fetch('/api/call/clear_proposal_presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(proposalId)]),
      })
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
      const r = await fetch('/api/call/add_proposal_comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          Number(params.proposalId),
          Number(params.sectionId),
          params.content,
          params.parentId != null ? Number(params.parentId) : null,
          params.authorName,
        ]),
      })
      if (!r.ok) throw new Error('Failed to add proposal comment')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

export function useResolveProposalComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (commentId: bigint | number | string) => {
      const r = await fetch('/api/call/resolve_proposal_comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(commentId)]),
      })
      if (!r.ok) throw new Error('Failed to resolve proposal comment')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateProposalParams } from '@lumiere/stdb'
