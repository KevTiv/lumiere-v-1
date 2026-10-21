"use client"


import { decodeOperationDispatch } from "@lumiere/api-client"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
/**
 * Helpdesk — React Query over `/api/query/*` and `/api/operations/*`.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import type {
  CreateHelpdeskSlaParams,
  CreateHelpdeskStageParams,
  CreateHelpdeskTeamParams,
  CreateTicketParams,
  HelpdeskSla,
  HelpdeskStage,
  HelpdeskTeam,
  HelpdeskTicket,
  UpdateTicketParams,
} from "@lumiere/stdb/types"
import { encodeIdentity, stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { parseStrictU64, scalarToU64 as toScalarU64 } from "@lumiere/erp-shared/u64"

import {
  AmbiguousOperationEffectError,
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  type CanonicalRecordRef,
  type ResolvedOperationEffectOutcome,
} from "./operation-effect"

import {
  finalizeCreateHelpdeskSlaParams,
  finalizeCreateHelpdeskStageParams,
  finalizeCreateHelpdeskTeamParams,
  finalizeCreateTicketParams,
  finalizeUpdateTicketParams,
} from "./helpdesk-params-merge"

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

export function useHelpdeskTickets(organizationId: bigint, initialData?: HelpdeskTicket[]) {
  return useQuery({
    queryKey: helpdeskKeys(organizationId).tickets,
    queryFn: () => fetchQueryList('/api/query/helpdesk-tickets', 'Failed to fetch helpdesk tickets'),
    // An empty SSR response is an allowed fallback, not a cacheable result.
    staleTime: initialData?.length ? 30_000 : 0,
    initialData,
  })
}

export function useHelpdeskTeams(organizationId: bigint, initialData?: HelpdeskTeam[]) {
  return useQuery({
    queryKey: helpdeskKeys(organizationId).teams,
    queryFn: () => fetchQueryList('/api/query/helpdesk-teams', 'Failed to fetch helpdesk teams'),
    staleTime: initialData?.length ? 30_000 : 0,
    initialData,
  })
}

export function useHelpdeskStages(organizationId: bigint, initialData?: HelpdeskStage[]) {
  return useQuery({
    queryKey: helpdeskKeys(organizationId).stages,
    queryFn: () => fetchQueryList('/api/query/helpdesk-stages', 'Failed to fetch helpdesk stages'),
    staleTime: initialData?.length ? 30_000 : 0,
    initialData,
  })
}

export function useHelpdeskSlas(organizationId: bigint, initialData?: HelpdeskSla[]) {
  return useQuery({
    queryKey: helpdeskKeys(organizationId).slas,
    queryFn: () => fetchQueryList('/api/query/helpdesk-slas', 'Failed to fetch helpdesk SLAs'),
    staleTime: initialData?.length ? 30_000 : 0,
    initialData,
  })
}

// ── Ticket mutations ─────────────────────────────────────────────────────────

export function useCreateTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateTicketParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateTicketParams(params)
      const { urlPath, init } = stdbBffCommandPost("create_ticket", { params: stdbParamsToJson(finalized, "CreateTicketParams") })
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
      const { urlPath, init } = stdbBffCommandPost("update_ticket", { ticketId: toScalarU64(ticketId), params: stdbParamsToJson(finalizeUpdateTicketParams(params), "UpdateTicketParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update ticket')
    },
    onSuccess: () => invalidateAll(qc, organizationId),
  })
}

export type HelpdeskLifecycleState = "InProgress" | "Closed"

export interface HelpdeskTicketLifecycleProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly userId?: unknown
  readonly user_id?: unknown
  readonly state?: unknown
  readonly closedAt?: unknown
  readonly closed_at?: unknown
}

export interface HelpdeskTicketEffectRef extends CanonicalRecordRef {
  readonly resource: "helpdesk-tickets"
  readonly state: HelpdeskLifecycleState
  readonly assigneeIdentityHex?: string
}

function helpdeskStateTag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) return String((value as { tag?: unknown }).tag ?? "")
    const keys = Object.keys(value)
    if (keys.length === 1) {
      const key = keys[0]!
      return key.charAt(0).toUpperCase() + key.slice(1)
    }
  }
  return ""
}

function helpdeskIdentityHex(value: unknown): string {
  if (value == null || value === "") return ""
  if (typeof value === "string") {
    return value.trim().replace(/^0x/i, "").toLowerCase()
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "__identity__" in value
  ) {
    return String((value as { __identity__?: unknown }).__identity__ ?? "")
      .trim()
      .replace(/^0x/i, "")
      .toLowerCase()
  }
  return String(value).trim().replace(/^0x/i, "").toLowerCase()
}

function hasClosedAt(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === "object" && !Array.isArray(value)) {
    if ("none" in value) return false
    if ("some" in value) return true
  }
  return true
}

export function resolveHelpdeskTicketLifecycleEffect(
  rows: readonly HelpdeskTicketLifecycleProjection[],
  organizationId: bigint,
  ticketId: bigint,
  expectedState: HelpdeskLifecycleState,
  expectedAssigneeIdentityHex?: string,
): HelpdeskTicketEffectRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === ticketId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one helpdesk ticket, found ${matches.length}`,
    )
  }
  const row = matches[0]
  if (
    !row ||
    parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId ||
    helpdeskStateTag(row.state) !== expectedState
  ) {
    return null
  }

  const closedAt = row.closedAt ?? row.closed_at
  if (expectedState === "Closed" ? !hasClosedAt(closedAt) : hasClosedAt(closedAt)) {
    return null
  }

  const expectedAssignee = expectedAssigneeIdentityHex
    ?.trim()
    .replace(/^0x/i, "")
    .toLowerCase()
  const actualAssignee = helpdeskIdentityHex(row.userId ?? row.user_id)
  if (expectedAssignee && actualAssignee !== expectedAssignee) return null

  return {
    resource: "helpdesk-tickets",
    id: ticketId.toString(),
    state: expectedState,
    ...(actualAssignee ? { assigneeIdentityHex: actualAssignee } : {}),
  }
}

async function readHelpdeskTickets(): Promise<HelpdeskTicketLifecycleProjection[]> {
  return fetchQueryList(
    "/api/query/helpdesk-tickets",
    "Failed to read helpdesk tickets",
  )
}

/** `agentIdentityHex` — SpacetimeDB identity hex (same format as user_profile.identity). */
export function useAssignTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    ResolvedOperationEffectOutcome<HelpdeskTicketEffectRef>,
    Error,
    { ticketId: bigint | number | string; agentIdentityHex: string }
  >({
    mutationFn: async ({ ticketId: ticketIdInput, agentIdentityHex }) => {
      const ticketId = parseStrictU64(ticketIdInput)
      if (ticketId == null) throw new Error("Invalid helpdesk ticket id")
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveHelpdeskTicketLifecycleEffect(
            await readHelpdeskTickets(),
            organizationId,
            ticketId,
            "InProgress",
            agentIdentityHex,
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("assign_ticket", {
            ticketId,
            agentId: encodeIdentity(agentIdentityHex),
          })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to assign helpdesk ticket",
          )
        },
        afterDispatch: () => invalidateAll(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function useCloseTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    ResolvedOperationEffectOutcome<HelpdeskTicketEffectRef>,
    Error,
    { ticketId: bigint | number | string }
  >({
    mutationFn: async ({ ticketId: ticketIdInput }) => {
      const ticketId = parseStrictU64(ticketIdInput)
      if (ticketId == null) throw new Error("Invalid helpdesk ticket id")
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveHelpdeskTicketLifecycleEffect(
            await readHelpdeskTickets(),
            organizationId,
            ticketId,
            "Closed",
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("close_ticket", {
            ticketId,
          })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to close helpdesk ticket",
          )
        },
        afterDispatch: () => invalidateAll(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function useReopenTicket(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    ResolvedOperationEffectOutcome<HelpdeskTicketEffectRef>,
    Error,
    { ticketId: bigint | number | string }
  >({
    mutationFn: async ({ ticketId: ticketIdInput }) => {
      const ticketId = parseStrictU64(ticketIdInput)
      if (ticketId == null) throw new Error("Invalid helpdesk ticket id")
      const outcome = await executeOperationWithCanonicalReadback({
        resolveBeforeDispatch: false,
        resolveEffect: async () =>
          resolveHelpdeskTicketLifecycleEffect(
            await readHelpdeskTickets(),
            organizationId,
            ticketId,
            "InProgress",
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("reopen_ticket", {
            ticketId,
          })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to reopen helpdesk ticket",
          )
        },
        afterDispatch: () => invalidateAll(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}

// ── Config mutations ──────────────────────────────────────────────────────────

export function useCreateHelpdeskTeam(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateHelpdeskTeamParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateHelpdeskTeamParams(params)
      const { urlPath, init } = stdbBffCommandPost("create_helpdesk_team", { params: stdbParamsToJson(finalized, "CreateHelpdeskTeamParams") })
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
      const { urlPath, init } = stdbBffCommandPost("create_helpdesk_stage", { params: stdbParamsToJson(finalized) })
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
      const { urlPath, init } = stdbBffCommandPost("create_helpdesk_sla", { params: stdbParamsToJson(finalized) })
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
      const { urlPath, init } = stdbBffCommandPost("import_helpdesk_ticket_csv", { csvData: csvData })
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
      const { urlPath, init } = stdbBffCommandPost("import_helpdesk_team_csv", { csvData: csvData })
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
      const { urlPath, init } = stdbBffCommandPost("import_helpdesk_stage_csv", { csvData: csvData })
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
      const { urlPath, init } = stdbBffCommandPost("import_helpdesk_sla_csv", { csvData: csvData })
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
  HelpdeskSla,
  HelpdeskStage,
  HelpdeskTeam,
  HelpdeskTicket,
} from '@lumiere/stdb/types'
