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

import { fetchQueryList, emptyQueryRows, type QueryRows } from '@/lib/query-fetch'
import { withCompanyScope } from '@/lib/org-scoped'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useMrpProductions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-productions', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/mrp-productions', 'Failed to fetch manufacturing orders'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpBoms(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-boms', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/mrp-boms', 'Failed to fetch BOMs'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpWorkorders(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-workorders', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/mrp-workorders', 'Failed to fetch workorders'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpWorkcenters(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-workcenters', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/mrp-workcenters', 'Failed to fetch workcenters'),
    staleTime: 30_000,
    initialData,
  })
}

// TODO: No route yet — returns empty array until quality_check table/route is added
export function useQualityChecks(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['quality-checks', organizationId.toString()],
    queryFn: emptyQueryRows,
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateManufacturingOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useCreateBom(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create BOM')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mrp-boms', organizationId.toString()] }),
  })
}

export function useCreateWorkcenter(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_workcenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}

export function useConfirmManufacturingOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      const r = await fetch('/api/call/confirm_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), productionId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to confirm manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useStartManufacturingOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      const r = await fetch('/api/call/start_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), productionId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to start manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useFinishManufacturingOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      const r = await fetch('/api/call/finish_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), productionId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to finish manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useCancelManufacturingOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      const r = await fetch('/api/call/cancel_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), productionId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to cancel manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useStartWorkorder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workorderId: string | number | bigint) => {
      const r = await fetch('/api/call/start_workorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workorderId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to start workorder')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workorders', organizationId.toString()] }),
  })
}

export function useFinishWorkorder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workorderId: string | number | bigint) => {
      const r = await fetch('/api/call/finish_workorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workorderId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to finish workorder')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workorders', organizationId.toString()] }),
  })
}

export function useBlockWorkcenter(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workcenterId,
      reason,
    }: {
      workcenterId: string | number | bigint
      reason: string
    }) => {
      const r = await fetch('/api/call/block_workcenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workcenterId.toString(), reason]),
      })
      if (!r.ok) throw new Error('Failed to block workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}

export function useUnblockWorkcenter(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workcenterId: string | number | bigint) => {
      const r = await fetch('/api/call/unblock_workcenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workcenterId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to unblock workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}
