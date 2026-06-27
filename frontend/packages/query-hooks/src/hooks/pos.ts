"use client"

/**
 * POS hooks — Point of Sale terminal and session management
 *
 * Wraps REST API calls with React Query for the POS module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { posBffPost } from "@lumiere/stdb/commands"
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

export function usePosConfigs(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['pos-configs', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/pos-configs', 'Failed to fetch POS configs'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePosSessions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['pos-sessions', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/pos-sessions', 'Failed to fetch POS sessions'),
    staleTime: 15_000,
    initialData,
  })
}

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidatePosQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  const key = rqBigIntKey(organizationId)
  void qc.invalidateQueries({ queryKey: ['pos-terminals', key] })
  void qc.invalidateQueries({ queryKey: ['pos-configs', key] })
  void qc.invalidateQueries({ queryKey: ['pos-sessions', key] })
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
      const { urlPath, init } = posBffPost("create_pos_terminal", [
        organizationId,
        name,
        locationLabel,
        latitude != null && Number.isFinite(latitude) ? latitude : null,
        longitude != null && Number.isFinite(longitude) ? longitude : null,
      ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = posBffPost("update_pos_terminal", [
        toScalarU64(args.terminalId),
        args.status,
        args.dailyRevenue,
        Math.max(0, Math.floor(args.openOrders)) >>> 0,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update POS terminal')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useCreatePosConfig(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = posBffPost("create_pos_config", [
        organizationId,
        companyId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create POS config')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useActivatePosConfig(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (configId: bigint | number | string) => {
      const { urlPath, init } = posBffPost("activate_pos_config", [
        organizationId,
        toScalarU64(configId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to activate POS config')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useDeactivatePosConfig(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (configId: bigint | number | string) => {
      const { urlPath, init } = posBffPost("deactivate_pos_config", [
        organizationId,
        toScalarU64(configId),
      ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = posBffPost("open_pos_session", [
        organizationId,
        toScalarU64(args.configId),
        args.openingBalance ?? 0,
      ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = posBffPost("close_pos_session", [
        organizationId,
        toScalarU64(args.sessionId),
        args.closingBalance,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to close POS session')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useComputePosSessionTotals(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: bigint | number | string) => {
      const { urlPath, init } = posBffPost("compute_pos_session_totals", [
        organizationId,
        toScalarU64(sessionId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to compute POS session totals')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useCreatePosOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = posBffPost("create_pos_order", [
        organizationId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create POS order')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}
