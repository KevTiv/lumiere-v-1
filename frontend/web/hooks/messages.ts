/**
 * Messages hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Messages module.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useMailMessages(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mail-messages', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/mail-messages', 'Failed to fetch messages'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function usePostMessage(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/post_message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to post message')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mail-messages', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { PostMessageParams } from '@lumiere/stdb'
