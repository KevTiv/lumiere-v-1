"use client"

/**
 * Sales hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Sales module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { salesBffPost } from "@lumiere/stdb/commands"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, coalesceQueryInitialData, type QueryRows, rqBigIntKey } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  CreateDeliveryCarrierParams,
  CreateDeliveryPriceRuleParams,
  CreateLoyaltyProgramParams,
  CreatePaymentMethodParams,
  CreatePickingBatchParams,
  CreatePricelistItemParams,
  CreatePricelistParams,
  CreateSaleOrderParams,
  CreateSaleOrderLineParams,
  CreateShippingMethodParams,
  CreateReturnOrderParams,
  CreateCreditNoteFromReturnOrderParams,
  UpdateSaleOrderParams,
} from "@lumiere/stdb/types"

import { finalizeUpdateSaleOrderParams } from "./sales-params-merge"

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
    initialData: coalesceQueryInitialData(initialData),
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
    initialData: coalesceQueryInitialData(initialData),
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
    initialData: coalesceQueryInitialData(initialData),
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
    initialData: coalesceQueryInitialData(initialData),
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
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useDeliveryCarriers(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['delivery-carriers', rqBigIntKey(companyId)],
    queryFn: () => fetchQueryList('/api/query/delivery-carriers', 'Failed to fetch delivery carriers'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useDeliveryPriceRules(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['delivery-price-rules', rqBigIntKey(companyId)],
    queryFn: () =>
      fetchQueryList('/api/query/delivery-price-rules', 'Failed to fetch delivery price rules'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useShippingMethods(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['shipping-methods', rqBigIntKey(companyId)],
    queryFn: () => fetchQueryList('/api/query/shipping-methods', 'Failed to fetch shipping methods'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePosPaymentMethods(companyId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['pos-payment-methods', rqBigIntKey(companyId)],
    queryFn: () =>
      fetchQueryList('/api/query/pos-payment-methods', 'Failed to fetch POS payment methods'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePosLoyaltyPrograms(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['pos-loyalty-programs', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/pos-loyalty-programs', 'Failed to fetch loyalty programs'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePosLoyaltyCards(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['pos-loyalty-cards', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/pos-loyalty-cards', 'Failed to fetch loyalty cards'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useReturnOrders(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['return-orders', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/return-orders', 'Failed to fetch return orders'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useReturnOrderLines(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['return-order-lines', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/return-order-lines', 'Failed to fetch return order lines'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useSaleCommissions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['sale-commissions', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/sale-commissions', 'Failed to fetch sale commissions'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateSaleOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateSaleOrderParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(
        withCompanyScope(params as Record<string, unknown>, companyId),
        "CreateSaleOrderParams",
      )
      const { urlPath, init } = salesBffPost("create_sale_order", [organizationId, json])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useConfirmSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const { urlPath, init } = salesBffPost("confirm_sales_order", [organizationId, orderId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to confirm sale order')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['sale-order-lines', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['stock-pickings', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['stock-moves', rqBigIntKey(organizationId)] })
    },
  })
}

export function useSendSaleOrderQuotation(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const { urlPath, init } = salesBffPost("send_sale_order_quotation", [
        organizationId,
        orderId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const body = await r.text().catch(() => "")
        throw new Error(body || "Failed to send quotation")
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sale-orders", rqBigIntKey(organizationId)] })
    },
  })
}

export function useApplySalePromotion(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { orderId: bigint | number | string; promotionCode: string }) => {
      const { urlPath, init } = salesBffPost("apply_sale_promotion_to_order", [
        organizationId,
        toScalarU64(params.orderId),
        stdbParamsToJson({ promotionCode: params.promotionCode }),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await r.text().catch(() => "Failed to apply promotion"))
    },
    onSuccess: async () => {
      const orgKey = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sale-orders", orgKey] }),
        qc.invalidateQueries({ queryKey: ["sale-order-lines", orgKey] }),
      ])
    },
  })
}

export function useApplySaleOrderOptions(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const { urlPath, init } = salesBffPost("apply_sale_order_options", [
        organizationId,
        toScalarU64(orderId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await r.text().catch(() => "Failed to apply options"))
    },
    onSuccess: async () => {
      const orgKey = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sale-orders", orgKey] }),
        qc.invalidateQueries({ queryKey: ["sale-order-lines", orgKey] }),
      ])
    },
  })
}

export function useCreateExchangeOrderFromReturn(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (returnOrderId: bigint | number | string) => {
      const { urlPath, init } = salesBffPost("create_exchange_order_from_return", [
        organizationId,
        companyId,
        toScalarU64(returnOrderId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await r.text().catch(() => "Failed to create exchange order"))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sale-orders", rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ["return-orders", rqBigIntKey(organizationId)] })
    },
  })
}

export function useCancelSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { orderId: bigint | number | string; reason?: string | null }) => {
      const { urlPath, init } = salesBffPost("cancel_sale_order", [
          organizationId,
          params.orderId,
          params.reason ?? null,
        ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("compute_so_totals", [organizationId, orderId])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("create_pricelist", [organizationId, json])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("update_pricelist", [
          organizationId,
          params.pricelistId,
          params.name ?? null,
          params.currencyId != null ? params.currencyId : null,
          params.discountPolicy ?? null,
          params.isActive ?? null,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update pricelist')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pricelists', rqBigIntKey(organizationId)] }),
  })
}

export function useCreatePricelistItem(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePricelistItemParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = salesBffPost("create_pricelist_item", [
        organizationId,
        stdbParamsToJson(params as object, "CreatePricelistItemParams"),
      ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("delete_pricelist", [organizationId, pricelistId])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("delete_pricelist_item", [organizationId, itemId])
      const r = await apiFetch(urlPath, init)
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
      const json = stdbParamsToJson(
        withCompanyScope(params as Record<string, unknown>, companyId),
        "CreatePickingBatchParams",
      )
      const { urlPath, init } = salesBffPost("create_picking_batch", [organizationId, json])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] }),
  })
}

export function useStartPickingBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: bigint | number | string) => {
      const { urlPath, init } = salesBffPost("start_picking_batch", [organizationId, batchId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to start picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] }),
  })
}

export function useCompletePickingBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: bigint | number | string) => {
      const { urlPath, init } = salesBffPost("complete_picking_batch", [organizationId, batchId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to complete picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] }),
  })
}

export function useCancelPickingBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: bigint | number | string) => {
      const { urlPath, init } = salesBffPost("cancel_picking_batch", [organizationId, batchId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] }),
  })
}

// ── Sale Order Updates ───────────────────────────────────────────────────────

export function useUpdateSaleOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { orderId: bigint | number | string; params: Partial<UpdateSaleOrderParams> }>({
    mutationFn: async ({ orderId, params }) => {
      const { urlPath, init } = salesBffPost("update_sale_order", [
          organizationId,
          companyId,
          toScalarU64(orderId),
          stdbParamsToJson(finalizeUpdateSaleOrderParams(params), "UpdateSaleOrderParams"),
        ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("lock_sale_order", [organizationId, toScalarU64(orderId)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to lock sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useUnlockSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number | string>({
    mutationFn: async (orderId) => {
      const { urlPath, init } = salesBffPost("unlock_sale_order", [organizationId, toScalarU64(orderId)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to unlock sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] }),
  })
}

// ── Sale Order Line Management ──────────────────────────────────────────────

export function useCreateSaleOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { orderId: bigint | number | string; params: CreateSaleOrderLineParams }>({
    mutationFn: async ({ orderId, params }) => {
      const { urlPath, init } = salesBffPost("create_sale_order_line", [
          organizationId,
          toScalarU64(orderId),
          stdbParamsToJson(params as object, "CreateSaleOrderLineParams"),
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create sale order line')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-order-lines', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateSaleOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { lineId: bigint | number | string; params: Record<string, unknown> }>({
    mutationFn: async ({ lineId, params }) => {
      const { urlPath, init } = salesBffPost("update_sale_order_line", [
          organizationId,
          toScalarU64(lineId),
          stdbParamsToJson(params as object),
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update sale order line')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-order-lines', rqBigIntKey(organizationId)] }),
  })
}

export function useDeleteSaleOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number | string>({
    mutationFn: async (lineId) => {
      const { urlPath, init } = salesBffPost("delete_sale_order_line", [organizationId, toScalarU64(lineId)])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete sale order line')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-order-lines', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateInvoiceFromSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      orderId: bigint | number | string
      params: import('@lumiere/stdb/types').CreateInvoiceFromSaleOrderParams
    }
  >({
    mutationFn: async ({ orderId, params }) => {
      const u64 = (v: bigint | number | string) => (typeof v === "bigint" ? v : BigInt(String(v)))
      const encodedParams = stdbParamsToJson(
        {
          journalId: params.journalId,
          defaultIncomeAccountId: params.defaultIncomeAccountId,
          receivableLine: stdbParamsToJson(
            params.receivableLine as object,
            "AddAccountMoveLineParams",
          ),
          incomeLine: stdbParamsToJson(params.incomeLine as object, "AddAccountMoveLineParams"),
          metadata: params.metadata,
        } as object,
        "CreateInvoiceFromSaleOrderParams",
      )
      const { urlPath, init } = salesBffPost("create_invoice_from_sale_order", [
          organizationId,
          u64(orderId),
          encodedParams,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['sale-orders', orgKey] })
      void qc.invalidateQueries({ queryKey: ['account-moves', orgKey] })
    },
  })
}

// ── Return orders (RMA) ─────────────────────────────────────────────────────

export function useCreateReturnOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateReturnOrderParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object, "CreateReturnOrderParams")
      const { urlPath, init } = salesBffPost("create_return_order", [
        organizationId,
        companyId,
        json,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['return-orders', k] })
      void qc.invalidateQueries({ queryKey: ['return-order-lines', k] })
    },
  })
}

export function useConfirmReturnOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (returnOrderId: bigint | number | string) => {
      const { urlPath, init } = salesBffPost("confirm_return_order", [
        organizationId,
        companyId,
        toScalarU64(returnOrderId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['return-orders', k] })
      void qc.invalidateQueries({ queryKey: ['stock-pickings', k] })
      void qc.invalidateQueries({ queryKey: ['stock-moves', k] })
    },
  })
}

export function useCancelReturnOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (returnOrderId: bigint | number | string) => {
      const { urlPath, init } = salesBffPost("cancel_return_order", [
        organizationId,
        companyId,
        toScalarU64(returnOrderId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['return-orders', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreateCreditNoteFromReturnOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { returnOrderId: bigint | number | string; params: CreateCreditNoteFromReturnOrderParams }
  >({
    mutationFn: async ({ returnOrderId, params }) => {
      const encodedParams = stdbParamsToJson(
        {
          journalId: params.journalId,
          defaultIncomeAccountId: params.defaultIncomeAccountId,
          receivableLine: stdbParamsToJson(
            params.receivableLine as object,
            "AddAccountMoveLineParams",
          ),
          incomeLine: stdbParamsToJson(params.incomeLine as object, "AddAccountMoveLineParams"),
          metadata: params.metadata,
        } as object,
        "CreateCreditNoteFromReturnOrderParams",
      )
      const { urlPath, init } = salesBffPost("create_credit_note_from_return_order", [
        organizationId,
        companyId,
        toScalarU64(returnOrderId),
        encodedParams,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['return-orders', k] })
      void qc.invalidateQueries({ queryKey: ['account-moves', k] })
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
      const { urlPath, init } = salesBffPost("import_sale_order_csv", [organizationId, companyId, csvData])
      const res = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("import_sale_order_line_csv", [organizationId, companyId, csvData])
      const res = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("create_delivery_carrier", [
          organizationId,
          companyId,
          json,
        ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("create_delivery_price_rule", [
          organizationId,
          companyId,
          json,
        ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("create_shipping_method", [
          organizationId,
          companyId,
          json,
        ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("create_payment_method", [
          organizationId,
          companyId,
          json,
        ])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("create_loyalty_program", [organizationId, json])
      const r = await apiFetch(urlPath, init)
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
      const { urlPath, init } = salesBffPost("create_loyalty_card", [
          organizationId,
          partnerId === null || partnerId === '' ? null : toScalarU64(partnerId),
          toScalarU64(programId),
          code,
          points,
        ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create loyalty card')
    },
    onSuccess: () => invalidateSalesLogistics(qc, organizationId, companyId),
  })
}

export function useSettleSaleCommissions(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      commissionIds: Array<bigint | number | string>
      journalId: bigint | number | string
      expenseAccountId: bigint | number | string
      payableAccountId: bigint | number | string
      date?: Date | number | bigint
      reference?: string | null
      metadata?: string | null
    }
  >({
    mutationFn: async (input) => {
      const dateMicros =
        input.date instanceof Date
          ? BigInt(input.date.getTime()) * 1000n
          : input.date != null
            ? BigInt(input.date)
            : BigInt(Date.now()) * 1000n
      const encoded = stdbParamsToJson(
        {
          commissionIds: input.commissionIds.map((id) => toScalarU64(id)),
          journalId: toScalarU64(input.journalId),
          expenseAccountId: toScalarU64(input.expenseAccountId),
          payableAccountId: toScalarU64(input.payableAccountId),
          date: { microsSinceUnixEpoch: dateMicros },
          reference: input.reference ?? null,
          metadata: input.metadata ?? null,
        },
        "SettleSaleCommissionsParams",
      )
      const { urlPath, init } = salesBffPost("settle_sale_commissions", [
        organizationId,
        companyId,
        encoded,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['sale-commissions', k] })
      void qc.invalidateQueries({ queryKey: ['account-moves', k] })
    },
  })
}

export function useCancelSaleCommission(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { commissionId: bigint | number | string }>({
    mutationFn: async ({ commissionId }) => {
      const { urlPath, init } = salesBffPost("cancel_sale_commission", [
        organizationId,
        companyId,
        toScalarU64(commissionId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['sale-commissions', rqBigIntKey(organizationId)],
      })
    },
  })
}

export function useAccrueSaleCommission(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { orderId: bigint | number | string; ratePercent: number }
  >({
    mutationFn: async ({ orderId, ratePercent }) => {
      const encoded = stdbParamsToJson(
        { ratePercent },
        "AccrueSaleCommissionParams",
      )
      const { urlPath, init } = salesBffPost("accrue_sale_commission", [
        organizationId,
        toScalarU64(orderId),
        encoded,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['sale-commissions', rqBigIntKey(organizationId)],
      })
    },
  })
}

export function useReverseSaleCommissionSettlement(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<void, Error, { commissionId: bigint | number | string }>({
    mutationFn: async ({ commissionId }) => {
      const { urlPath, init } = salesBffPost("reverse_sale_commission_settlement", [
        organizationId,
        companyId,
        toScalarU64(commissionId),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['sale-commissions', k] })
      void qc.invalidateQueries({ queryKey: ['account-moves', k] })
    },
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
} from '@lumiere/stdb/types'
