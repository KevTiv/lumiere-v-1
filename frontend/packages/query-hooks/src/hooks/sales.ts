"use client"

/**
 * Sales hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Sales module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { stringifyReducerCallBody } from "@lumiere/api-client"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  CreateDeliveryCarrierParams,
  CreateDeliveryPriceRuleParams,
  CreateLoyaltyProgramParams,
  CreatePaymentMethodParams,
  CreatePickingBatchParams,
  CreatePricelistParams,
  CreateSaleOrderParams,
  CreateShippingMethodParams,
} from "@lumiere/stdb/generated/types"

function toScalarU64(v: bigint | number | string): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useSaleOrders(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['sale-orders', rqBigIntKey(organizationId)],
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
    queryKey: ['sale-order-lines', rqBigIntKey(organizationId)],
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
    queryKey: ['pricelists', rqBigIntKey(organizationId)],
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
    queryKey: ['pricelist-items', rqBigIntKey(organizationId)],
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
    queryKey: ['picking-batches', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/picking-batches', 'Failed to fetch picking batches'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDeliveryCarriers(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['delivery-carriers', rqBigIntKey(companyId)],
    queryFn: () => fetchQueryList('/api/query/delivery-carriers', 'Failed to fetch delivery carriers'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDeliveryPriceRules(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['delivery-price-rules', rqBigIntKey(companyId)],
    queryFn: () =>
      fetchQueryList('/api/query/delivery-price-rules', 'Failed to fetch delivery price rules'),
    staleTime: 30_000,
    initialData,
  })
}

export function useShippingMethods(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['shipping-methods', rqBigIntKey(companyId)],
    queryFn: () => fetchQueryList('/api/query/shipping-methods', 'Failed to fetch shipping methods'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePosPaymentMethods(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['pos-payment-methods', rqBigIntKey(companyId)],
    queryFn: () =>
      fetchQueryList('/api/query/pos-payment-methods', 'Failed to fetch POS payment methods'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePosLoyaltyPrograms(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['pos-loyalty-programs', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/pos-loyalty-programs', 'Failed to fetch loyalty programs'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePosLoyaltyCards(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['pos-loyalty-cards', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/pos-loyalty-cards', 'Failed to fetch loyalty cards'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateSaleOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateSaleOrderParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object)
      const r = await apiFetch('/api/call/create_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(json, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useConfirmSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const r = await apiFetch('/api/call/confirm_sales_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, orderId]),
      })
      if (!r.ok) throw new Error('Failed to confirm sale order')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['sale-order-lines', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] })
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
        body: stringifyReducerCallBody([
          organizationId,
          params.orderId,
          params.reason ?? null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to cancel sale order')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['sale-order-lines', rqBigIntKey(organizationId)] })
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
        body: stringifyReducerCallBody([organizationId, orderId]),
      })
      if (!r.ok) throw new Error('Failed to recalculate order totals')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['sale-order-lines', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreatePricelist(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePricelistParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object)
      const r = await apiFetch('/api/call/create_pricelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, json]),
      })
      if (!r.ok) throw new Error('Failed to create pricelist')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pricelists', rqBigIntKey(organizationId)] }),
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
        body: stringifyReducerCallBody([
          organizationId,
          params.pricelistId,
          params.name ?? null,
          params.currencyId != null ? params.currencyId : null,
          params.discountPolicy ?? null,
          params.isActive ?? null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to update pricelist')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pricelists', rqBigIntKey(organizationId)] }),
  })
}

export function useCreatePricelistItem(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_pricelist_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, params]),
      })
      if (!r.ok) throw new Error('Failed to create pricelist item')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricelists', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['pricelist-items', rqBigIntKey(organizationId)] })
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
        body: stringifyReducerCallBody([organizationId, pricelistId]),
      })
      if (!r.ok) throw new Error('Failed to delete pricelist')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricelists', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['pricelist-items', rqBigIntKey(organizationId)] })
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
        body: stringifyReducerCallBody([organizationId, itemId]),
      })
      if (!r.ok) throw new Error('Failed to delete pricelist item')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricelists', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['pricelist-items', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreatePickingBatch(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePickingBatchParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object)
      const r = await apiFetch('/api/call/create_picking_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, withCompanyScope(json, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] }),
  })
}

export function useStartPickingBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: bigint | number | string) => {
      const r = await apiFetch('/api/call/start_picking_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, batchId]),
      })
      if (!r.ok) throw new Error('Failed to start picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] }),
  })
}

export function useCompletePickingBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: bigint | number | string) => {
      const r = await apiFetch('/api/call/complete_picking_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, batchId]),
      })
      if (!r.ok) throw new Error('Failed to complete picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] }),
  })
}

export function useCancelPickingBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: bigint | number | string) => {
      const r = await apiFetch('/api/call/cancel_picking_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, batchId]),
      })
      if (!r.ok) throw new Error('Failed to cancel picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] }),
  })
}

// ── Sale Order Updates ───────────────────────────────────────────────────────

export function useUpdateSaleOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { orderId: bigint | number | string; params: Record<string, unknown> }>({
    mutationFn: async ({ orderId, params }) => {
      const r = await apiFetch('/api/call/update_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          toScalarU64(orderId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update sale order')
    },
    onSuccess: async () => {
      const orgKey = rqBigIntKey(organizationId)
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
        body: stringifyReducerCallBody([organizationId, toScalarU64(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to lock sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useUnlockSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number | string>({
    mutationFn: async (orderId) => {
      const r = await apiFetch('/api/call/unlock_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to unlock sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] }),
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
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(orderId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to create sale order line')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-order-lines', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateSaleOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { lineId: bigint | number | string; params: Record<string, unknown> }>({
    mutationFn: async ({ lineId, params }) => {
      const r = await apiFetch('/api/call/update_sale_order_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          toScalarU64(lineId),
          stdbParamsToJson(params as object),
        ]),
      })
      if (!r.ok) throw new Error('Failed to update sale order line')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-order-lines', rqBigIntKey(organizationId)] }),
  })
}

export function useDeleteSaleOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number | string>({
    mutationFn: async (lineId) => {
      const r = await apiFetch('/api/call/delete_sale_order_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, toScalarU64(lineId)]),
      })
      if (!r.ok) throw new Error('Failed to delete sale order line')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-order-lines', rqBigIntKey(organizationId)] }),
  })
}

// ── Invoice Creation ──────────────────────────────────────────────────────────

export function useCreateInvoiceFromSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      orderId: bigint | number | string
      journalId: bigint | number | string
      defaultIncomeAccountId: bigint | number | string
    }
  >({
    mutationFn: async ({ orderId, journalId, defaultIncomeAccountId }) => {
      const u64 = (v: bigint | number | string) => (typeof v === "bigint" ? v : BigInt(String(v)))
      const r = await apiFetch('/api/call/create_invoice_from_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          u64(orderId),
          u64(journalId),
          u64(defaultIncomeAccountId),
        ]),
      })
      if (!r.ok) throw new Error('Failed to create invoice from sale order')
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId)
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
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorSales(res))
    },
    onSuccess: () => {
      const k = rqBigIntKey(companyId)
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
        body: stringifyReducerCallBody([organizationId, companyId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorSales(res))
    },
    onSuccess: () => {
      const k = rqBigIntKey(companyId)
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
  const o = rqBigIntKey(orgId)
  const c = rqBigIntKey(companyId)
  void qc.invalidateQueries({ queryKey: ['delivery-carriers', c] })
  void qc.invalidateQueries({ queryKey: ['delivery-price-rules', c] })
  void qc.invalidateQueries({ queryKey: ['shipping-methods', c] })
  void qc.invalidateQueries({ queryKey: ['pos-payment-methods', c] })
  void qc.invalidateQueries({ queryKey: ['pos-loyalty-programs', o] })
  void qc.invalidateQueries({ queryKey: ['pos-loyalty-cards', o] })
}

export function useCreateDeliveryCarrier(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateDeliveryCarrierParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object)
      const r = await apiFetch('/api/call/create_delivery_carrier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          json,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create delivery carrier')
    },
    onSuccess: () => invalidateSalesLogistics(qc, organizationId, companyId),
  })
}

export function useCreateDeliveryPriceRule(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateDeliveryPriceRuleParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object)
      const r = await apiFetch('/api/call/create_delivery_price_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          json,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create delivery price rule')
    },
    onSuccess: () => invalidateSalesLogistics(qc, organizationId, companyId),
  })
}

export function useCreateShippingMethod(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateShippingMethodParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object)
      const r = await apiFetch('/api/call/create_shipping_method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          json,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create shipping method')
    },
    onSuccess: () => invalidateSalesLogistics(qc, organizationId, companyId),
  })
}

export function useCreatePaymentMethod(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePaymentMethodParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object)
      const r = await apiFetch('/api/call/create_payment_method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([
          organizationId,
          companyId,
          json,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create payment method')
    },
    onSuccess: () => invalidateSalesLogistics(qc, organizationId, companyId),
  })
}

export function useCreateLoyaltyProgram(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateLoyaltyProgramParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object)
      const r = await apiFetch('/api/call/create_loyalty_program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyReducerCallBody([organizationId, json]),
      })
      if (!r.ok) throw new Error('Failed to create loyalty program')
    },
    onSuccess: () => {
      invalidateSalesLogistics(qc, organizationId, companyId)
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
        body: stringifyReducerCallBody([
          organizationId,
          partnerId === null || partnerId === '' ? null : toScalarU64(partnerId),
          toScalarU64(programId),
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
  CreateDeliveryCarrierParams,
  CreateDeliveryPriceRuleParams,
  CreateLoyaltyProgramParams,
  CreatePaymentMethodParams,
  CreatePickingBatchParams,
  CreatePricelistParams,
  CreateSaleOrderParams,
  CreateShippingMethodParams,
  UpdateSaleOrderParams,
} from '@lumiere/stdb/generated/types'
