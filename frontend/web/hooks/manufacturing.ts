/**
 * Manufacturing hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Manufacturing module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 *
 * Notes:
 * - useQualityChecks returns empty array (no route yet)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useMrpProductions(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['mrp-productions', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/mrp-productions')
      if (!r.ok) throw new Error('Failed to fetch manufacturing orders')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpBoms(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['mrp-boms', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/mrp-boms')
      if (!r.ok) throw new Error('Failed to fetch BOMs')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpWorkorders(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['mrp-workorders', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/mrp-workorders')
      if (!r.ok) throw new Error('Failed to fetch workorders')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpWorkcenters(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['mrp-workcenters', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/mrp-workcenters')
      if (!r.ok) throw new Error('Failed to fetch workcenters')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// TODO: No route yet — returns empty array until quality_check table/route is added
export function useQualityChecks(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['quality-checks', organizationId.toString()],
    queryFn: async () => [] as Record<string, unknown>[],
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateManufacturingOrder(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_mrp_production?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useCreateBom(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_mrp_bom?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create BOM')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mrp-boms', organizationId.toString()] }),
  })
}

export function useCreateWorkcenter(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_mrp_workcenter?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}
