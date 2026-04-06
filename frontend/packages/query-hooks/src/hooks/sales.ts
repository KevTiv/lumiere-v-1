"use client"

/**
 * Sales hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Sales module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"

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

export function useDeliveryCarriers(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['delivery-carriers', companyId.toString()],
    queryFn: () => fetchQueryList('/api/query/delivery-carriers', 'Failed to fetch delivery carriers'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDeliveryPriceRules(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['delivery-price-rules', companyId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/delivery-price-rules', 'Failed to fetch delivery price rules'),
    staleTime: 30_000,
    initialData,
  })
}

export function useShippingMethods(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['shipping-methods', companyId.toString()],
    queryFn: () => fetchQueryList('/api/query/shipping-methods', 'Failed to fetch shipping methods'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePosPaymentMethods(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['pos-payment-methods', companyId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/pos-payment-methods', 'Failed to fetch POS payment methods'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePosLoyaltyPrograms(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['pos-loyalty-programs', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/pos-loyalty-programs', 'Failed to fetch loyalty programs'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePosLoyaltyCards(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['pos-loyalty-cards', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/pos-loyalty-cards', 'Failed to fetch loyalty cards'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateSaleOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_sale_order', {
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
      const r = await apiFetch('/api/call/confirm_sales_order', {
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
      const r = await apiFetch('/api/call/cancel_sale_order', {
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
      const r = await apiFetch('/api/call/compute_so_totals', {
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
      const r = await apiFetch('/api/call/create_pricelist', {
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
      const r = await apiFetch('/api/call/update_pricelist', {
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
      const r = await apiFetch('/api/call/create_pricelist_item', {
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
      const r = await apiFetch('/api/call/delete_pricelist', {
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
      const r = await apiFetch('/api/call/delete_pricelist_item', {
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
      const r = await apiFetch('/api/call/create_picking_batch', {
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
      const r = await apiFetch('/api/call/start_picking_batch', {
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
      const r = await apiFetch('/api/call/complete_picking_batch', {
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
      const r = await apiFetch('/api/call/cancel_picking_batch', {
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
      const r = await apiFetch('/api/call/update_sale_order', {
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
      const r = await apiFetch('/api/call/lock_sale_order', {
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
      const r = await apiFetch('/api/call/unlock_sale_order', {
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
      const r = await apiFetch('/api/call/create_sale_order_line', {
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
      const r = await apiFetch('/api/call/update_sale_order_line', {
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
      const r = await apiFetch('/api/call/delete_sale_order_line', {
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
      const r = await apiFetch('/api/call/create_invoice_from_sale_order', {
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

// ── CSV imports (organization_id, company_id, csv_data) ───────────────────────

async function parseCallErrorSales(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string }
    return j.error ?? r.statusText
  } catch {
    return r.statusText
  }
}

export function useImportSaleOrderCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch('/api/call/import_sale_order_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorSales(res))
    },
    onSuccess: () => {
      const k = companyId.toString()
      void qc.invalidateQueries({ queryKey: ['sale-orders', k] })
    },
  })
}

export function useImportSaleOrderLineCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch('/api/call/import_sale_order_line_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorSales(res))
    },
    onSuccess: () => {
      const k = companyId.toString()
      void qc.invalidateQueries({ queryKey: ['sale-order-lines', k] })
    },
  })
}

export function useSalesCsvImportMutations(organizationId: bigint, companyId: bigint) {
  return {
    importSaleOrder: useImportSaleOrderCsv(organizationId, companyId),
    importSaleOrderLine: useImportSaleOrderLineCsv(organizationId, companyId),
  }
}

function invalidateSalesLogistics(qc: ReturnType<typeof useQueryClient>, orgId: bigint, companyId: bigint) {
  const o = orgId.toString()
  const c = companyId.toString()
  void qc.invalidateQueries({ queryKey: ['delivery-carriers', c] })
  void qc.invalidateQueries({ queryKey: ['delivery-price-rules', c] })
  void qc.invalidateQueries({ queryKey: ['shipping-methods', c] })
  void qc.invalidateQueries({ queryKey: ['pos-payment-methods', c] })
  void qc.invalidateQueries({ queryKey: ['pos-loyalty-programs', o] })
  void qc.invalidateQueries({ queryKey: ['pos-loyalty-cards', o] })
}

export function useCreateDeliveryCarrier(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_delivery_carrier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          companyId.toString(),
          params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create delivery carrier')
    },
    onSuccess: () => invalidateSalesLogistics(qc, organizationId, companyId),
  })
}

export function useCreateDeliveryPriceRule(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_delivery_price_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          companyId.toString(),
          params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create delivery price rule')
    },
    onSuccess: () => invalidateSalesLogistics(qc, organizationId, companyId),
  })
}

export function useCreateShippingMethod(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_shipping_method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          companyId.toString(),
          params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create shipping method')
    },
    onSuccess: () => invalidateSalesLogistics(qc, organizationId, companyId),
  })
}

export function useCreatePaymentMethod(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_payment_method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          companyId.toString(),
          params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create payment method')
    },
    onSuccess: () => invalidateSalesLogistics(qc, organizationId, companyId),
  })
}

export function useCreateLoyaltyProgram(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_loyalty_program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create loyalty program')
    },
    onSuccess: () => {
      invalidateSalesLogistics(qc, organizationId, organizationId)
    },
  })
}

export function useCreateLoyaltyCard(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { partnerId: bigint | number | string | null; programId: bigint | number | string; code: string; points: number }
  >({
    mutationFn: async ({ partnerId, programId, code, points }) => {
      const r = await apiFetch('/api/call/create_loyalty_card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          partnerId === null || partnerId === '' ? null : Number(partnerId),
          Number(programId),
          code,
          points,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create loyalty card')
    },
    onSuccess: () => invalidateSalesLogistics(qc, organizationId, companyId),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateSaleOrderParams,
  CreatePricelistParams,
  UpdateSaleOrderParams,
} from '@lumiere/stdb/generated/types'
