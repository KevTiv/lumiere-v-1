"use client"

/**
 * Helpdesk — React Query over `/api/query/*` and `/api/call/*`.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { helpdeskBffPost } from "@lumiere/stdb/commands"
import type {
  CreateHelpdeskSlaParams,
  CreateHelpdeskStageParams,
  CreateHelpdeskTeamParams,
  CreateTicketParams,
  UpdateTicketParams,
} from "@lumiere/stdb/types"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import {
  finalizeCreateHelpdeskSlaParams,
  finalizeCreateHelpdeskStageParams,
  finalizeCreateHelpdeskTeamParams,
  finalizeCreateTicketParams,
} from "./helpdesk-params-merge"

function toScalarU64(v: bigint | number | string): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

function helpdeskKeys(organizationId: bigint) {
  const k = rqBigIntKey(organizationId)
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
  return useMutation<void, Error, Partial<CreateTicketParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateTicketParams(params)
      const { urlPath, init } = helpdeskBffPost("create_ticket", [
        organizationId,
        stdbParamsToJson(finalized),
      ])
      const r = await apiFetch(urlPath, init)
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
    { ticketId: number | bigint | string; params: Partial<UpdateTicketParams> }
  >({
    mutationFn: async ({ ticketId, params }) => {
      const { urlPath, init } = helpdeskBffPost("update_ticket", [
        organizationId,
        toScalarU64(ticketId),
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = helpdeskBffPost("assign_ticket", [
        organizationId,
        toScalarU64(ticketId),
        agentIdentityHex,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to assign helpdesk ticket')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useCloseTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ticketId: bigint | number | string }>({
    mutationFn: async ({ ticketId }) => {
      const { urlPath, init } = helpdeskBffPost("close_ticket", [
        organizationId,
        toScalarU64(ticketId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to close helpdesk ticket')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useReopenTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ticketId: bigint | number | string }>({
    mutationFn: async ({ ticketId }) => {
      const { urlPath, init } = helpdeskBffPost("reopen_ticket", [
        organizationId,
        toScalarU64(ticketId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to reopen helpdesk ticket')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

// ── Config mutations ──────────────────────────────────────────────────────────

export function useCreateHelpdeskTeam(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateHelpdeskTeamParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateHelpdeskTeamParams(params)
      const { urlPath, init } = helpdeskBffPost("create_helpdesk_team", [
        organizationId,
        stdbParamsToJson(finalized, "CreateHelpdeskTeamParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create team')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useCreateHelpdeskStage(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateHelpdeskStageParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateHelpdeskStageParams(params)
      const { urlPath, init } = helpdeskBffPost("create_helpdesk_stage", [
        organizationId,
        stdbParamsToJson(finalized),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create stage')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useCreateHelpdeskSla(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateHelpdeskSlaParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateHelpdeskSlaParams(params)
      const { urlPath, init } = helpdeskBffPost("create_helpdesk_sla", [
        organizationId,
        stdbParamsToJson(finalized),
      ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = helpdeskBffPost("import_helpdesk_ticket_csv", [
        organizationId,
        csvData,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to import tickets CSV')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useImportHelpdeskTeamCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (csvData) => {
      const { urlPath, init } = helpdeskBffPost("import_helpdesk_team_csv", [
        organizationId,
        csvData,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to import teams CSV')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useImportHelpdeskStageCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (csvData) => {
      const { urlPath, init } = helpdeskBffPost("import_helpdesk_stage_csv", [
        organizationId,
        csvData,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to import stages CSV')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export function useImportHelpdeskSlaCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (csvData) => {
      const { urlPath, init } = helpdeskBffPost("import_helpdesk_sla_csv", [
        organizationId,
        csvData,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to import SLAs CSV')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export type {
  CreateHelpdeskSlaParams,
  CreateHelpdeskStageParams,
  CreateHelpdeskTeamParams,
  CreateTicketParams,
  UpdateTicketParams,
} from '@lumiere/stdb/types'
