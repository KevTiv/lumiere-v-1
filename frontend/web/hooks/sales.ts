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

export function usePricelistItems(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['pricelist-items', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/pricelist-items', 'Failed to fetch pricelist items'),
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
      qc.invalidateQueries({ queryKey: ['sale-order-lines', organizationId.toString()] })
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale-orders', organizationId.toString()] })
      qc.invalidateQueries({ queryKey: ['sale-order-lines', organizationId.toString()] })
    },
  })
}

export function useComputeSoTotals(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const r = await fetch('/api/call/compute_so_totals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), orderId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to recalculate order totals')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale-orders', organizationId.toString()] })
      qc.invalidateQueries({ queryKey: ['sale-order-lines', organizationId.toString()] })
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricelists', organizationId.toString()] })
      qc.invalidateQueries({ queryKey: ['pricelist-items', organizationId.toString()] })
    },
  })
}

export function useDeletePricelist(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (pricelistId: bigint | number | string) => {
      const r = await fetch('/api/call/delete_pricelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), pricelistId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to delete pricelist')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricelists', organizationId.toString()] })
      qc.invalidateQueries({ queryKey: ['pricelist-items', organizationId.toString()] })
    },
  })
}

export function useDeletePricelistItem(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (itemId: bigint | number | string) => {
      const r = await fetch('/api/call/delete_pricelist_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), itemId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to delete pricelist item')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricelists', organizationId.toString()] })
      qc.invalidateQueries({ queryKey: ['pricelist-items', organizationId.toString()] })
    },
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

// ── Sale Order Updates ───────────────────────────────────────────────────────

export function useUpdateSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { orderId: bigint | number | string; params: Record<string, unknown> }>({
    mutationFn: async ({ orderId, params }) => {
      const r = await fetch('/api/call/update_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId), params]),
      })
      if (!r.ok) throw new Error('Failed to update sale order')
    },
    onSuccess: async () => {
      const orgKey = organizationId.toString()
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['sale-orders', orgKey] }),
        qc.invalidateQueries({ queryKey: ['sale-order-lines', orgKey] }),
      ])
    },
  })
}

export function useLockSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number | string>({
    mutationFn: async (orderId) => {
      const r = await fetch('/api/call/lock_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to lock sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', organizationId.toString()] }),
  })
}

export function useUnlockSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number | string>({
    mutationFn: async (orderId) => {
      const r = await fetch('/api/call/unlock_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to unlock sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', organizationId.toString()] }),
  })
}

// ── Sale Order Line Management ──────────────────────────────────────────────

export function useCreateSaleOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { orderId: bigint | number | string; params: Record<string, unknown> }>({
    mutationFn: async ({ orderId, params }) => {
      const r = await fetch('/api/call/create_sale_order_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId), params]),
      })
      if (!r.ok) throw new Error('Failed to create sale order line')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-order-lines', organizationId.toString()] }),
  })
}

export function useUpdateSaleOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { lineId: bigint | number | string; params: Record<string, unknown> }>({
    mutationFn: async ({ lineId, params }) => {
      const r = await fetch('/api/call/update_sale_order_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(lineId), params]),
      })
      if (!r.ok) throw new Error('Failed to update sale order line')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-order-lines', organizationId.toString()] }),
  })
}

export function useDeleteSaleOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number | string>({
    mutationFn: async (lineId) => {
      const r = await fetch('/api/call/delete_sale_order_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(lineId)]),
      })
      if (!r.ok) throw new Error('Failed to delete sale order line')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-order-lines', organizationId.toString()] }),
  })
}

// ── Invoice Creation ──────────────────────────────────────────────────────────

export function useCreateInvoiceFromSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { orderId: bigint | number | string; invoiceDate?: string; journalId?: bigint | number | string }>({
    mutationFn: async ({ orderId, invoiceDate, journalId }) => {
      const r = await fetch('/api/call/create_invoice_from_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId), invoiceDate ?? null, journalId ? Number(journalId) : null]),
      })
      if (!r.ok) throw new Error('Failed to create invoice from sale order')
    },
    onSuccess: () => {
      const orgKey = organizationId.toString()
      void qc.invalidateQueries({ queryKey: ['sale-orders', orgKey] })
      void qc.invalidateQueries({ queryKey: ['account-moves', orgKey] })
    },
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateSaleOrderParams,
  CreatePricelistParams,
  UpdateSaleOrderParams,
} from '@lumiere/stdb'
