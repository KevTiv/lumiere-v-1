/**
 * Messages hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Messages module.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useMailMessages(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['mail-messages', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/mail-messages')
      if (!r.ok) throw new Error('Failed to fetch messages')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function usePostMessage(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
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
