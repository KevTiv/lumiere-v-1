"use client"

/**
 * POS hooks — Point of Sale terminal and session management
 *
 * Wraps REST API calls with React Query for the POS module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"

// ── Reads ────────────────────────────────────────────────────────────────────

export function usePosTerminals(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['pos-terminals', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/pos-terminals', 'Failed to fetch POS terminals'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidatePosQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  return qc.invalidateQueries({ queryKey: ['pos-terminals', organizationId.toString()] })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreatePosTerminal(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_pos_terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
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
      terminalId: bigint | number | string
      name?: string
      locationLabel?: string
      latitude?: number
      longitude?: number
      currencyId?: bigint | number | string
    }) => {
      const r = await apiFetch('/api/call/update_pos_terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          args.terminalId.toString(),
          args.name ?? null,
          args.locationLabel ?? null,
          args.latitude ?? null,
          args.longitude ?? null,
          args.currencyId != null ? args.currencyId.toString() : null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to update POS terminal')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}

export function useCreatePosConfig(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_pos_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
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
        body: JSON.stringify([organizationId.toString(), configId.toString()]),
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
        body: JSON.stringify([organizationId.toString(), configId.toString()]),
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
      terminalId?: bigint | number | string
      openingBalance?: number
    }) => {
      const r = await apiFetch('/api/call/open_pos_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          args.configId.toString(),
          args.terminalId?.toString() ?? null,
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
      notes?: string
    }) => {
      const r = await apiFetch('/api/call/close_pos_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          args.sessionId.toString(),
          args.closingBalance,
          args.notes ?? null,
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
        body: JSON.stringify([organizationId.toString(), sessionId.toString()]),
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
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create POS order')
    },
    onSuccess: () => invalidatePosQueries(qc, organizationId),
  })
}
