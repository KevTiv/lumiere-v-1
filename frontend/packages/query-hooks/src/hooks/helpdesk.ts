"use client"

/**
 * Helpdesk — React Query over `/api/query/*` and `/api/call/*`.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"

function helpdeskKeys(organizationId: bigint) {
  const k = organizationId.toString()
  return {
    tickets: ['helpdesk-tickets', k] as const,
    teams: ['helpdesk-teams', k] as const,
    stages: ['helpdesk-stages', k] as const,
    slas: ['helpdesk-slas', k] as const,
  }
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  const k = helpdeskKeys(organizationId)
  void qc.invalidateQueries({ queryKey: k.tickets })
  void qc.invalidateQueries({ queryKey: k.teams })
  void qc.invalidateQueries({ queryKey: k.stages })
  void qc.invalidateQueries({ queryKey: k.slas })
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useHelpdeskTickets(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: helpdeskKeys(organizationId).tickets,
    queryFn: () => fetchQueryList('/api/query/helpdesk-tickets', 'Failed to fetch helpdesk tickets'),
    staleTime: 30_000,
    initialData,
  })
}

export function useHelpdeskTeams(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: helpdeskKeys(organizationId).teams,
    queryFn: () => fetchQueryList('/api/query/helpdesk-teams', 'Failed to fetch helpdesk teams'),
    staleTime: 30_000,
    initialData,
  })
}

export function useHelpdeskStages(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: helpdeskKeys(organizationId).stages,
    queryFn: () => fetchQueryList('/api/query/helpdesk-stages', 'Failed to fetch helpdesk stages'),
    staleTime: 30_000,
    initialData,
  })
}

export function useHelpdeskSlas(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: helpdeskKeys(organizationId).slas,
    queryFn: () => fetchQueryList('/api/query/helpdesk-slas', 'Failed to fetch helpdesk SLAs'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Ticket mutations ─────────────────────────────────────────────────────────

export function useCreateTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create helpdesk ticket')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useUpdateTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { ticketId: number | bigint | string; params: Record<string, unknown> }
  >({
    mutationFn: async ({ ticketId, params }) => {
      const r = await apiFetch('/api/call/update_ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(ticketId), params]),
      })
      if (!r.ok) throw new Error('Failed to update ticket')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

/** `agentIdentityHex` — SpacetimeDB identity hex (same format as user_profile.identity). */
export function useAssignTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ticketId: bigint | number | string; agentIdentityHex: string }>({
    mutationFn: async ({ ticketId, agentIdentityHex }) => {
      const r = await apiFetch('/api/call/assign_ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(ticketId), agentIdentityHex]),
      })
      if (!r.ok) throw new Error('Failed to assign helpdesk ticket')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useCloseTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ticketId: bigint | number | string }>({
    mutationFn: async ({ ticketId }) => {
      const r = await apiFetch('/api/call/close_ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(ticketId)]),
      })
      if (!r.ok) throw new Error('Failed to close helpdesk ticket')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useReopenTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ticketId: bigint | number | string }>({
    mutationFn: async ({ ticketId }) => {
      const r = await apiFetch('/api/call/reopen_ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(ticketId)]),
      })
      if (!r.ok) throw new Error('Failed to reopen helpdesk ticket')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

// ── Config mutations ──────────────────────────────────────────────────────────

export function useCreateHelpdeskTeam(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_helpdesk_team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create team')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useCreateHelpdeskStage(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_helpdesk_stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create stage')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useCreateHelpdeskSla(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_helpdesk_sla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create SLA')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

// ── CSV imports ──────────────────────────────────────────────────────────────

export function useImportHelpdeskTicketCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (csvData) => {
      const r = await apiFetch('/api/call/import_helpdesk_ticket_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), csvData]),
      })
      if (!r.ok) throw new Error('Failed to import tickets CSV')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useImportHelpdeskTeamCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (csvData) => {
      const r = await apiFetch('/api/call/import_helpdesk_team_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), csvData]),
      })
      if (!r.ok) throw new Error('Failed to import teams CSV')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useImportHelpdeskStageCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (csvData) => {
      const r = await apiFetch('/api/call/import_helpdesk_stage_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), csvData]),
      })
      if (!r.ok) throw new Error('Failed to import stages CSV')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useImportHelpdeskSlaCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (csvData) => {
      const r = await apiFetch('/api/call/import_helpdesk_sla_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), csvData]),
      })
      if (!r.ok) throw new Error('Failed to import SLAs CSV')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export type { CreateTicketParams } from '@lumiere/stdb/generated/types'
