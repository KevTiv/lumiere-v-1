"use client"

/**
 * POS hooks — Point of Sale terminal and session management
 *
 * Wraps REST API calls with React Query for the POS module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { stringifyReducerCallBody } from "@lumiere/api-client"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

type ScalarId = bigint | number | string

function toScalarU64(v: ScalarId): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function usePosTerminals(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['pos-terminals', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/pos-terminals', 'Failed to fetch POS terminals'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidatePosQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  return qc.invalidateQueries({ queryKey: ['pos-terminals', rqBigIntKey(organizationId)] })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreatePosTerminal(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const name = String(params.name ?? "").trim()
      if (!name) throw new Error("Terminal name is required")
      const loc = params.locationLabel
      const locationLabel =
        loc != null && String(loc).trim() !== "" ? String(loc).trim() : null
      const latRaw = params.latitude
      const lonRaw = params.longitude
      const latitude =
        latRaw != null && latRaw !== "" ? Number(latRaw) : null
      const longitude =
        lonRaw != null && lonRaw !== "" ? Number(lonRaw) : null
      const r = await apiFetch('/api/call/create_pos_terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          name,
          locationLabel,
          latitude != null && Number.isFinite(latitude) ? latitude : null,
          longitude != null && Number.isFinite(longitude) ? longitude : null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create POS terminal')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useUpdatePosTerminal(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      terminalId: ScalarId
      status: string
      dailyRevenue: number
      openOrders: number
    }) => {
      const r = await apiFetch('/api/call/update_pos_terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          toScalarU64(args.terminalId),
          args.status,
          args.dailyRevenue,
          Math.max(0, Math.floor(args.openOrders)) >>> 0,
        ]),
      })
      if (!r.ok) throw new Error('Failed to update POS terminal')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useCreatePosConfig(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_pos_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to create POS config')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useActivatePosConfig(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (configId: bigint | number | string) => {
      const r = await apiFetch('/api/call/activate_pos_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(configId)]),
      })
      if (!r.ok) throw new Error('Failed to activate POS config')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useDeactivatePosConfig(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (configId: bigint | number | string) => {
      const r = await apiFetch('/api/call/deactivate_pos_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(configId)]),
      })
      if (!r.ok) throw new Error('Failed to deactivate POS config')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useOpenPosSession(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      configId: bigint | number | string
      openingBalance?: number
    }) => {
      const r = await apiFetch('/api/call/open_pos_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(args.configId),
          args.openingBalance ?? 0,
        ]),
      })
      if (!r.ok) throw new Error('Failed to open POS session')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useClosePosSession(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      sessionId: bigint | number | string
      closingBalance: number
    }) => {
      const r = await apiFetch('/api/call/close_pos_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(args.sessionId),
          args.closingBalance,
        ]),
      })
      if (!r.ok) throw new Error('Failed to close POS session')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useComputePosSessionTotals(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: bigint | number | string) => {
      const r = await apiFetch('/api/call/compute_pos_session_totals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(sessionId)]),
      })
      if (!r.ok) throw new Error('Failed to compute POS session totals')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useCreatePosOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_pos_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to create POS order')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}
