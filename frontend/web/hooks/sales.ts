/**
 * Sales hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Sales module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'
import { withCompanyScope } from '@/lib/org-scoped'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useSaleOrders(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['sale-orders', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/sale-orders', 'Failed to fetch sale orders'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSaleOrderLines(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['sale-order-lines', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/sale-order-lines', 'Failed to fetch sale order lines'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePricelists(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['pricelists', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/pricelists', 'Failed to fetch pricelists'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePickingBatches(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['picking-batches', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/picking-batches', 'Failed to fetch picking batches'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateSaleOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', organizationId.toString()] }),
  })
}

export function useConfirmSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const r = await fetch('/api/call/confirm_sales_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), orderId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to confirm sale order')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale-orders', organizationId.toString()] })
      qc.invalidateQueries({ queryKey: ['picking-batches', organizationId.toString()] })
    },
  })
}

export function useCancelSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { orderId: bigint | number | string; reason?: string | null }) => {
      const r = await fetch('/api/call/cancel_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          params.orderId.toString(),
          params.reason ?? null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to cancel sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', organizationId.toString()] }),
  })
}

export function useCreatePricelist(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_pricelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create pricelist')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pricelists', organizationId.toString()] }),
  })
}

export function useUpdatePricelist(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      pricelistId: bigint | number | string
      name?: string
      currencyId?: bigint | number | string
      discountPolicy?: string
      isActive?: boolean
    }) => {
      const r = await fetch('/api/call/update_pricelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          params.pricelistId.toString(),
          params.name ?? null,
          params.currencyId != null ? params.currencyId.toString() : null,
          params.discountPolicy ?? null,
          params.isActive ?? null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to update pricelist')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pricelists', organizationId.toString()] }),
  })
}

export function useCreatePricelistItem(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_pricelist_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create pricelist item')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pricelists', organizationId.toString()] }),
  })
}

export function useCreatePickingBatch(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_picking_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', organizationId.toString()] }),
  })
}

export function useStartPickingBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: bigint | number | string) => {
      const r = await fetch('/api/call/start_picking_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), batchId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to start picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', organizationId.toString()] }),
  })
}

export function useCompletePickingBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: bigint | number | string) => {
      const r = await fetch('/api/call/complete_picking_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), batchId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to complete picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', organizationId.toString()] }),
  })
}

export function useCancelPickingBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: bigint | number | string) => {
      const r = await fetch('/api/call/cancel_picking_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), batchId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to cancel picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateSaleOrderParams,
  CreatePricelistParams,
} from '@lumiere/stdb'
