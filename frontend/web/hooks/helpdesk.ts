/**
 * Helpdesk hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Helpdesk module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useHelpdeskTickets(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['helpdesk-tickets', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/helpdesk-tickets')
      if (!r.ok) throw new Error('Failed to fetch helpdesk tickets')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_helpdesk_ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create helpdesk ticket')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['helpdesk-tickets', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateTicketParams } from '@lumiere/stdb'
