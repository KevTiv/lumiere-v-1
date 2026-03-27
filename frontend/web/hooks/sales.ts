/**
 * Sales hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Sales module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useSaleOrders(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['sale-orders', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/sale-orders')
      if (!r.ok) throw new Error('Failed to fetch sale orders')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useSaleOrderLines(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['sale-order-lines', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/sale-order-lines')
      if (!r.ok) throw new Error('Failed to fetch sale order lines')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function usePricelists(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['pricelists', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/pricelists')
      if (!r.ok) throw new Error('Failed to fetch pricelists')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function usePickingBatches(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['picking-batches', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/picking-batches')
      if (!r.ok) throw new Error('Failed to fetch picking batches')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateSaleOrder(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_sale_order?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', organizationId.toString()] }),
  })
}

export function useCreatePricelist(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_product_pricelist?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create pricelist')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pricelists', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateSaleOrderParams,
  CreatePricelistParams,
} from '@lumiere/stdb'
