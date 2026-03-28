/**
 * Helpdesk hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Helpdesk module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useHelpdeskTickets(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['helpdesk-tickets', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/helpdesk-tickets', 'Failed to fetch helpdesk tickets'),
    staleTime: 30_000,
    initialData,
  })
}

export function useHelpdeskTeams(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['helpdesk-teams', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/helpdesk-teams', 'Failed to fetch helpdesk teams'),
    staleTime: 30_000,
    initialData,
  })
}

export function useHelpdeskStages(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['helpdesk-stages', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/helpdesk-stages', 'Failed to fetch helpdesk stages'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_ticket', {
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

export function useAssignTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { ticketId: bigint | number | string; userId: string }) => {
      const r = await fetch('/api/call/assign_ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          Number(params.ticketId),
          params.userId,
        ]),
      })
      if (!r.ok) throw new Error('Failed to assign helpdesk ticket')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['helpdesk-tickets', organizationId.toString()] }),
  })
}

export function useCloseTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { ticketId: bigint | number | string }) => {
      const r = await fetch('/api/call/close_ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(params.ticketId)]),
      })
      if (!r.ok) throw new Error('Failed to close helpdesk ticket')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['helpdesk-tickets', organizationId.toString()] }),
  })
}

export function useReopenTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { ticketId: bigint | number | string }) => {
      const r = await fetch('/api/call/reopen_ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(params.ticketId)]),
      })
      if (!r.ok) throw new Error('Failed to reopen helpdesk ticket')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['helpdesk-tickets', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateTicketParams } from '@lumiere/stdb'
