/**
 * Proposals hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Proposals module.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useProposals(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['proposals', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/proposals')
      if (!r.ok) throw new Error('Failed to fetch proposals')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
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

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateProposalParams } from '@lumiere/stdb'
