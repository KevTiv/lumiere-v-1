"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, coalesceQueryInitialData, rqBigIntKey } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { scalarToU64 as toScalarU64 } from "@lumiere/erp-shared/u64"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  ApplyOmnichannelAllocationParams,
  CreateDeliveryCarrierParams,
  CreateDeliveryPriceRuleParams,
  CreateLoyaltyProgramParams,
  CreatePaymentMethodParams,
  CreatePickingBatchParams,
  CreatePricelistItemParams,
  CreatePricelistParams,
  CreateSaleCommissionPlanParams,
  CreateSaleCommissionPlanSplitParams,
  CreateSaleContractParams,
  CreateSaleCpqConstraintParams,
  CreateSaleOrderParams,
  CreateSaleOrderLineParams,
  CreateSalesIntegrationIntentParams,
  CreateShippingMethodParams,
  CreateReturnOrderParams,
  CreateCreditNoteFromReturnOrderParams,
  RecordSalesIntegrationResultParams,
  UpdateSaleOrderParams,
  SaleOrder,
  SaleOrderLine,
  ProductPricelist,
  ProductPricelistItem,
  StockPickingBatch,
  DeliveryCarrier,
  DeliveryPriceRule,
  ShippingMethod,
  PosPaymentMethod,
  PosLoyaltyProgram,
  PosLoyaltyCard,
  ReturnOrder,
  ReturnOrderLine,
  SaleCommission,
} from "@lumiere/stdb/types"

import { finalizeUpdateSaleOrderParams } from "./sales-params-merge"
import { invalidateQueryResources } from "./workflow"
import {
  ACCEPT_SALE_ORDER_QUOTATION_AFFECTS,
  CANCEL_SALE_ORDER_AFFECTS,
  COMPUTE_SALE_ORDER_TOTALS_AFFECTS,
  CONFIRM_SALE_ORDER_AFFECTS,
  SALE_ORDER_LINE_AFFECTS,
  SALE_ORDER_LOCK_AFFECTS,
  UPDATE_SALE_ORDER_AFFECTS,
  SEND_SALE_ORDER_QUOTATION_AFFECTS,
  CANCEL_RETURN_AFFECTS,
  CONFIRM_RETURN_AFFECTS,
  CREATE_INVOICE_FROM_SALE_ORDER_AFFECTS,
  CREDIT_NOTE_FROM_RETURN_AFFECTS,
  EXCHANGE_FROM_RETURN_AFFECTS,
  WorkflowError,
  workflowErrorFromResponse,
} from "@lumiere/erp-workflows"

// ── Reads ────────────────────────────────────────────────────────────────────

export const saleOrdersQueryOptions = (organizationId: bigint) => ({
  queryKey: ['sale-orders', rqBigIntKey(organizationId)] as const,
  queryFn: () => fetchQueryList('/api/query/sale-orders', 'Failed to fetch sale orders'),
  staleTime: 30_000,
})

export function useSaleOrders(
  organizationId: bigint,
  initialData?: SaleOrder[],
) {
  return useQuery<SaleOrder[]>({
    ...saleOrdersQueryOptions(organizationId),
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useSaleOrderLines(
  organizationId: bigint,
  initialData?: SaleOrderLine[],
) {
  return useQuery<SaleOrderLine[]>({
    queryKey: ['sale-order-lines', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/sale-order-lines', 'Failed to fetch sale order lines'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePricelists(
  organizationId: bigint,
  initialData?: ProductPricelist[],
) {
  return useQuery<ProductPricelist[]>({
    queryKey: ['pricelists', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/pricelists', 'Failed to fetch pricelists'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePricelistItems(
  organizationId: bigint,
  initialData?: ProductPricelistItem[],
) {
  return useQuery<ProductPricelistItem[]>({
    queryKey: ['pricelist-items', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/pricelist-items', 'Failed to fetch pricelist items'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePickingBatches(
  organizationId: bigint,
  initialData?: StockPickingBatch[],
) {
  return useQuery<StockPickingBatch[]>({
    queryKey: ['picking-batches', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/picking-batches', 'Failed to fetch picking batches'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useDeliveryCarriers(companyId: bigint, initialData?: DeliveryCarrier[]) {
  return useQuery<DeliveryCarrier[]>({
    queryKey: ['delivery-carriers', rqBigIntKey(companyId)],
    queryFn: () => fetchQueryList('/api/query/delivery-carriers', 'Failed to fetch delivery carriers'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useDeliveryPriceRules(companyId: bigint, initialData?: DeliveryPriceRule[]) {
  return useQuery<DeliveryPriceRule[]>({
    queryKey: ['delivery-price-rules', rqBigIntKey(companyId)],
    queryFn: () =>
      fetchQueryList('/api/query/delivery-price-rules', 'Failed to fetch delivery price rules'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useShippingMethods(companyId: bigint, initialData?: ShippingMethod[]) {
  return useQuery<ShippingMethod[]>({
    queryKey: ['shipping-methods', rqBigIntKey(companyId)],
    queryFn: () => fetchQueryList('/api/query/shipping-methods', 'Failed to fetch shipping methods'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePosPaymentMethods(companyId: bigint, initialData?: PosPaymentMethod[]) {
  return useQuery<PosPaymentMethod[]>({
    queryKey: ['pos-payment-methods', rqBigIntKey(companyId)],
    queryFn: () =>
      fetchQueryList('/api/query/pos-payment-methods', 'Failed to fetch POS payment methods'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePosLoyaltyPrograms(organizationId: bigint, initialData?: PosLoyaltyProgram[]) {
  return useQuery<PosLoyaltyProgram[]>({
    queryKey: ['pos-loyalty-programs', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/pos-loyalty-programs', 'Failed to fetch loyalty programs'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePosLoyaltyCards(organizationId: bigint, initialData?: PosLoyaltyCard[]) {
  return useQuery<PosLoyaltyCard[]>({
    queryKey: ['pos-loyalty-cards', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/pos-loyalty-cards', 'Failed to fetch loyalty cards'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useReturnOrders(organizationId: bigint, initialData?: ReturnOrder[]) {
  return useQuery<ReturnOrder[]>({
    ...returnOrdersQueryOptions(organizationId),
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useReturnOrderLines(organizationId: bigint, initialData?: ReturnOrderLine[]) {
  return useQuery<ReturnOrderLine[]>({
    queryKey: ['return-order-lines', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/return-order-lines', 'Failed to fetch return order lines'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useSaleCommissions(organizationId: bigint, initialData?: SaleCommission[]) {
  return useQuery<SaleCommission[]>({
    queryKey: ['sale-commissions', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/sale-commissions', 'Failed to fetch sale commissions'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

/** Server-bounded: `sale_order.state = ToApprove`. */
export function useSaleOrdersToApprove(organizationId: bigint, initialData?: SaleOrder[]) {
  return useQuery<SaleOrder[]>({
    queryKey: ['sale-orders-to-approve', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/sale-orders-to-approve',
        'Failed to fetch sale orders awaiting approval',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

/** Server-bounded: `sale_commission.state = accrued` (awaiting settle). */
export function useSaleCommissionsPending(organizationId: bigint, initialData?: SaleCommission[]) {
  return useQuery<SaleCommission[]>({
    queryKey: ['sale-commissions-pending', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/sale-commissions-pending',
        'Failed to fetch pending sale commissions',
      ),
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
      const { urlPath, init } = stdbBffCommandPost("create_sale_order", { params: json })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create sale order')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sale-orders', rqBigIntKey(organizationId)] }),
  })
}

async function salesReducerError(r: Response, fallback: string): Promise<Error> {
  const body = await r.text().catch(() => "")
  return new Error(body || fallback)
}

/** The one `confirm_sales_order` invocation, shared by the mutation hook and the workflow action. */
export async function confirmSaleOrderCommand(
  companyId: bigint | undefined,
  orderId: bigint | number | string,
): Promise<void> {
  if (companyId == null || companyId === 0n) {
    throw new WorkflowError("validation", "companyId is required to confirm a sale order")
  }
  const { urlPath, init } = stdbBffCommandPost("confirm_sales_order", { companyId: companyId, orderId: orderId })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) {
    throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to confirm sale order")
  }
}

export function useConfirmSaleOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: bigint | number | string) => confirmSaleOrderCommand(companyId, orderId),
    onSuccess: () => invalidateQueryResources(qc, organizationId, CONFIRM_SALE_ORDER_AFFECTS),
  })
}

/** Multi-WH promise ATP: refresh line scheduled_date / free_qty_today / SO commitment_date. */
export function useRefreshSaleOrderPromiseDates(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("refresh_sale_order_promise_dates", { companyId: companyId, orderId: orderId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw await salesReducerError(r, "Failed to refresh promise dates")
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      qc.invalidateQueries({ queryKey: ['sale-orders', k] })
      qc.invalidateQueries({ queryKey: ['sale-orders-to-approve', k] })
      qc.invalidateQueries({ queryKey: ['sale-order-lines', k] })
    },
  })
}

/** The one `send_sale_order_quotation` invocation, shared by the mutation hook and the workflow action. */
export async function sendSaleOrderQuotationCommand(orderId: bigint | number | string): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost("send_sale_order_quotation", { orderId: orderId })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) {
    throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to send quotation")
  }
}

export function useSendSaleOrderQuotation(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: sendSaleOrderQuotationCommand,
    onSuccess: () => invalidateQueryResources(qc, organizationId, SEND_SALE_ORDER_QUOTATION_AFFECTS),
  })
}

export interface AcceptSaleOrderQuotationCommandInput {
  orderId: bigint | number | string
  signedBy: string
  signature?: string | null
}

/** The one `accept_sale_order_quotation` invocation, shared by the mutation hook and the workflow action. */
export async function acceptSaleOrderQuotationCommand(params: AcceptSaleOrderQuotationCommandInput): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost("accept_sale_order_quotation", { orderId: toScalarU64(params.orderId), params: stdbParamsToJson(
      {
        signedBy: params.signedBy,
        signature: params.signature ?? null,
      },
      "AcceptSaleOrderQuotationParams",
    ) })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) {
    throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to accept quotation")
  }
}

export function useAcceptSaleOrderQuotation(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: acceptSaleOrderQuotationCommand,
    onSuccess: () => invalidateQueryResources(qc, organizationId, ACCEPT_SALE_ORDER_QUOTATION_AFFECTS),
  })
}

export function useApplySalePromotion(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { orderId: bigint | number | string; promotionCode: string }) => {
      const { urlPath, init } = stdbBffCommandPost("apply_sale_promotion_to_order", { orderId: toScalarU64(params.orderId), params: stdbParamsToJson({ promotionCode: params.promotionCode }) })
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
      const { urlPath, init } = stdbBffCommandPost("apply_sale_order_options", { orderId: toScalarU64(orderId) })
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
    mutationFn: (returnOrderId: bigint | number | string) => createExchangeOrderFromReturnCommand(companyId, returnOrderId),
    onSuccess: () => invalidateQueryResources(qc, organizationId, EXCHANGE_FROM_RETURN_AFFECTS),
  })
}

/** The one `cancel_sale_order` invocation, shared by the mutation hook and the workflow action. */
export async function cancelSaleOrderCommand(params: {
  orderId: bigint | number | string
  reason?: string | null
}): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost("cancel_sale_order", { orderId: params.orderId, reason: params.reason ?? null })
  const r = await apiFetch(urlPath, init)
  if (r.ok) return
  const error = workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to cancel sale order")
  if (/invoic/i.test(error.message)) {
    throw new WorkflowError(
      error.kind,
      `${error.message} — create an RMA and credit note instead of cancelling an invoiced order.`,
      { status: error.status },
    )
  }
  throw error
}

export function useCancelSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: cancelSaleOrderCommand,
    onSuccess: () => invalidateQueryResources(qc, organizationId, CANCEL_SALE_ORDER_AFFECTS),
  })
}

/** The one `compute_so_totals` invocation, shared by the mutation hook and the workflow action. */
export async function computeSaleOrderTotalsCommand(orderId: bigint | number | string): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost("compute_so_totals", { orderId: orderId })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) {
    throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to recalculate order totals")
  }
}

export function useComputeSoTotals(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: computeSaleOrderTotalsCommand,
    onSuccess: () => invalidateQueryResources(qc, organizationId, COMPUTE_SALE_ORDER_TOTALS_AFFECTS),
  })
}

export function useCreatePricelist(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePricelistParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object, "CreatePricelistParams")
      const { urlPath, init } = stdbBffCommandPost("create_pricelist", { params: json })
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
      const discountPolicy = params.discountPolicy
      if (
        discountPolicy != null &&
        discountPolicy !== "WithDiscount" &&
        discountPolicy !== "WithoutDiscount"
      ) {
        throw new Error("Invalid discount policy")
      }
      const { urlPath, init } = stdbBffCommandPost("update_pricelist", {
        pricelistId: params.pricelistId,
        name: params.name ?? null,
        currencyId: params.currencyId ?? null,
        discountPolicy: discountPolicy == null ? null : { tag: discountPolicy },
        isActive: params.isActive ?? null,
      })
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
      const { urlPath, init } = stdbBffCommandPost("create_pricelist_item", { params: stdbParamsToJson(params as object, "CreatePricelistItemParams") })
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
      const { urlPath, init } = stdbBffCommandPost("delete_pricelist", { pricelistId: pricelistId })
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
      const { urlPath, init } = stdbBffCommandPost("delete_pricelist_item", { itemId: itemId })
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
      const { urlPath, init } = stdbBffCommandPost("create_picking_batch", { params: json })
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
      const { urlPath, init } = stdbBffCommandPost("start_picking_batch", { batchId: batchId })
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
      const { urlPath, init } = stdbBffCommandPost("complete_picking_batch", { batchId: batchId })
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
      const { urlPath, init } = stdbBffCommandPost("cancel_picking_batch", { batchId: batchId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel picking batch')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-batches', rqBigIntKey(organizationId)] }),
  })
}

// ── Sale Order Updates ───────────────────────────────────────────────────────

export interface UpdateSaleOrderCommandInput {
  orderId: bigint | number | string
  params: Partial<UpdateSaleOrderParams>
}

/** The one `update_sale_order` invocation, shared by the mutation hook and the workflow action. */
export async function updateSaleOrderCommand(
  companyId: bigint,
  { orderId, params }: UpdateSaleOrderCommandInput,
): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost("update_sale_order", { companyId: companyId, orderId: toScalarU64(orderId), params: stdbParamsToJson(finalizeUpdateSaleOrderParams(params), "UpdateSaleOrderParams") })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) {
    throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to update sale order")
  }
}

export function useUpdateSaleOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, UpdateSaleOrderCommandInput>({
    mutationFn: (input) => updateSaleOrderCommand(companyId, input),
    onSuccess: () => invalidateQueryResources(qc, organizationId, UPDATE_SALE_ORDER_AFFECTS),
  })
}

async function saleOrderLockCommand(
  operation: "lock_sale_order" | "unlock_sale_order",
  orderId: bigint | number | string,
  fallback: string,
): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost(operation, { orderId: toScalarU64(orderId) })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), fallback)
}

export const lockSaleOrderCommand = (orderId: bigint | number | string) =>
  saleOrderLockCommand("lock_sale_order", orderId, "Failed to lock sale order")

export const unlockSaleOrderCommand = (orderId: bigint | number | string) =>
  saleOrderLockCommand("unlock_sale_order", orderId, "Failed to unlock sale order")

export function useLockSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number | string>({
    mutationFn: lockSaleOrderCommand,
    onSuccess: () => invalidateQueryResources(qc, organizationId, SALE_ORDER_LOCK_AFFECTS),
  })
}

export function useUnlockSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number | string>({
    mutationFn: unlockSaleOrderCommand,
    onSuccess: () => invalidateQueryResources(qc, organizationId, SALE_ORDER_LOCK_AFFECTS),
  })
}

// ── Sale Order Line Management ──────────────────────────────────────────────

export interface CreateSaleOrderLineCommandInput {
  orderId: bigint | number | string
  params: CreateSaleOrderLineParams
}

export interface UpdateSaleOrderLineCommandInput {
  lineId: bigint | number | string
  params: Record<string, unknown>
}

/** The one `create_sale_order_line` invocation, shared by the mutation hook and the workflow action. */
export async function createSaleOrderLineCommand({ orderId, params }: CreateSaleOrderLineCommandInput): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost("create_sale_order_line", { orderId: toScalarU64(orderId), params: stdbParamsToJson(params as object, "CreateSaleOrderLineParams") })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) {
    throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to create sale order line")
  }
}

/** The one `update_sale_order_line` invocation, shared by the mutation hook and the workflow action. */
export async function updateSaleOrderLineCommand(
  companyId: bigint,
  { lineId, params }: UpdateSaleOrderLineCommandInput,
): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost("update_sale_order_line", { companyId: companyId, lineId: toScalarU64(lineId), params: stdbParamsToJson(params as object) })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) {
    throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to update sale order line")
  }
}

/** The one `delete_sale_order_line` invocation, shared by the mutation hook and the workflow action. */
export async function deleteSaleOrderLineCommand(lineId: bigint | number | string): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost("delete_sale_order_line", { lineId: toScalarU64(lineId) })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) {
    throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to delete sale order line")
  }
}

export function useCreateSaleOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateSaleOrderLineCommandInput>({
    mutationFn: createSaleOrderLineCommand,
    onSuccess: () => invalidateQueryResources(qc, organizationId, SALE_ORDER_LINE_AFFECTS),
  })
}

export function useUpdateSaleOrderLine(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, UpdateSaleOrderLineCommandInput>({
    mutationFn: (input) => updateSaleOrderLineCommand(companyId, input),
    onSuccess: () => invalidateQueryResources(qc, organizationId, SALE_ORDER_LINE_AFFECTS),
  })
}

export function useDeleteSaleOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, bigint | number | string>({
    mutationFn: deleteSaleOrderLineCommand,
    onSuccess: () => invalidateQueryResources(qc, organizationId, SALE_ORDER_LINE_AFFECTS),
  })
}

type CreateInvoiceFromSaleOrderInput = {
  orderId: bigint | number | string
  params: import('@lumiere/stdb/types').CreateInvoiceFromSaleOrderParams
}

/** The one `create_invoice_from_sale_order` invocation, shared by the mutation hook and the workflow action. */
export async function createInvoiceFromSaleOrderCommand({
  orderId,
  params,
}: CreateInvoiceFromSaleOrderInput): Promise<void> {
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
  const { urlPath, init } = stdbBffCommandPost("create_invoice_from_sale_order", { saleOrderId: u64(orderId), params: encodedParams })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) {
    throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to create invoice")
  }
}

export function useCreateInvoiceFromSaleOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateInvoiceFromSaleOrderInput>({
    mutationFn: createInvoiceFromSaleOrderCommand,
    onSuccess: () => invalidateQueryResources(qc, organizationId, CREATE_INVOICE_FROM_SALE_ORDER_AFFECTS),
  })
}

// ── Return orders (RMA) ─────────────────────────────────────────────────────

export function useCreateReturnOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateReturnOrderParams>({
    mutationFn: async (params) => {
      const json = stdbParamsToJson(params as object, "CreateReturnOrderParams")
      const { urlPath, init } = stdbBffCommandPost("create_return_order", { companyId: companyId, params: json })
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

async function returnOrderCommand(
  reducer: "confirm_return_order" | "cancel_return_order" | "create_exchange_order_from_return",
  companyId: bigint,
  returnOrderId: bigint | number | string,
  fallback: string,
): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost(reducer, { companyId: companyId, returnOrderId: toScalarU64(returnOrderId) })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), fallback)
}

export const confirmReturnOrderCommand = (companyId: bigint, returnOrderId: bigint | number | string) =>
  returnOrderCommand("confirm_return_order", companyId, returnOrderId, "Failed to confirm return order")
export const cancelReturnOrderCommand = (companyId: bigint, returnOrderId: bigint | number | string) =>
  returnOrderCommand("cancel_return_order", companyId, returnOrderId, "Failed to cancel return order")
export const createExchangeOrderFromReturnCommand = (companyId: bigint, returnOrderId: bigint | number | string) =>
  returnOrderCommand("create_exchange_order_from_return", companyId, returnOrderId, "Failed to create exchange order")

type CreateCreditNoteFromReturnOrderInput = {
  returnOrderId: bigint | number | string
  params: CreateCreditNoteFromReturnOrderParams
}

export async function createCreditNoteFromReturnOrderCommand(
  companyId: bigint,
  { returnOrderId, params }: CreateCreditNoteFromReturnOrderInput,
): Promise<void> {
  const encodedParams = stdbParamsToJson(
    {
      journalId: params.journalId,
      defaultIncomeAccountId: params.defaultIncomeAccountId,
      receivableLine: stdbParamsToJson(params.receivableLine as object, "AddAccountMoveLineParams"),
      incomeLine: stdbParamsToJson(params.incomeLine as object, "AddAccountMoveLineParams"),
      metadata: params.metadata,
    } as object,
    "CreateCreditNoteFromReturnOrderParams",
  )
  const { urlPath, init } = stdbBffCommandPost("create_credit_note_from_return_order", { companyId: companyId, returnOrderId: toScalarU64(returnOrderId), params: encodedParams })
  const r = await apiFetch(urlPath, init)
  if (!r.ok) throw workflowErrorFromResponse(r.status, await r.text().catch(() => ""), "Failed to create credit note")
}

export const returnOrdersQueryOptions = (organizationId: bigint) => ({
  queryKey: ['return-orders', rqBigIntKey(organizationId)] as const,
  queryFn: () => fetchQueryList('/api/query/return-orders', 'Failed to fetch return orders'),
  staleTime: 30_000,
})

export function useConfirmReturnOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (returnOrderId: bigint | number | string) => confirmReturnOrderCommand(companyId, returnOrderId),
    onSuccess: () => invalidateQueryResources(qc, organizationId, CONFIRM_RETURN_AFFECTS),
  })
}

export function useCancelReturnOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (returnOrderId: bigint | number | string) => cancelReturnOrderCommand(companyId, returnOrderId),
    onSuccess: () => invalidateQueryResources(qc, organizationId, CANCEL_RETURN_AFFECTS),
  })
}

export function useCreateCreditNoteFromReturnOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateCreditNoteFromReturnOrderInput>({
    mutationFn: (input) => createCreditNoteFromReturnOrderCommand(companyId, input),
    onSuccess: () => invalidateQueryResources(qc, organizationId, CREDIT_NOTE_FROM_RETURN_AFFECTS),
  })
}

// ── CSV imports (organization_id, company_id, csv_data) ───────────────────────

import { responseErrorMessage as parseCallErrorSales } from "@lumiere/api-client/response-error"

export function useImportSaleOrderCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_sale_order_csv", { companyId: companyId, csvData: csvData })
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
      const { urlPath, init } = stdbBffCommandPost("import_sale_order_line_csv", { companyId: companyId, csvData: csvData })
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
      const { urlPath, init } = stdbBffCommandPost("create_delivery_carrier", { companyId: companyId, params: json })
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
      const { urlPath, init } = stdbBffCommandPost("create_delivery_price_rule", { companyId: companyId, params: json })
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
      const { urlPath, init } = stdbBffCommandPost("create_shipping_method", { companyId: companyId, params: json })
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
      const { urlPath, init } = stdbBffCommandPost("create_payment_method", { companyId: companyId, params: json })
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
      const { urlPath, init } = stdbBffCommandPost("create_loyalty_program", { params: json })
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
      const { urlPath, init } = stdbBffCommandPost("create_loyalty_card", { partnerId: partnerId === null || partnerId === '' ? null : toScalarU64(partnerId), programId: toScalarU64(programId), code: code, points: points })
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
      const { urlPath, init } = stdbBffCommandPost("settle_sale_commissions", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['sale-commissions', k] })
      void qc.invalidateQueries({ queryKey: ['sale-commissions-pending', k] })
      void qc.invalidateQueries({ queryKey: ['account-moves', k] })
    },
  })
}

export function useCancelSaleCommission(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { commissionId: bigint | number | string }>({
    mutationFn: async ({ commissionId }) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_sale_commission", { companyId: companyId, commissionId: toScalarU64(commissionId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['sale-commissions', k] })
      void qc.invalidateQueries({ queryKey: ['sale-commissions-pending', k] })
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
      const { urlPath, init } = stdbBffCommandPost("accrue_sale_commission", { orderId: toScalarU64(orderId), params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['sale-commissions', k] })
      void qc.invalidateQueries({ queryKey: ['sale-commissions-pending', k] })
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
      const { urlPath, init } = stdbBffCommandPost("reverse_sale_commission_settlement", { companyId: companyId, commissionId: toScalarU64(commissionId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['sale-commissions', k] })
      void qc.invalidateQueries({ queryKey: ['sale-commissions-pending', k] })
      void qc.invalidateQueries({ queryKey: ['account-moves', k] })
    },
  })
}

// ── OMS advanced (Wave D) — creates via BFF; no QueryResourceKey list hooks yet ─

export function useCreateSaleCommissionPlan(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, CreateSaleCommissionPlanParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson(
        withCompanyScope(params as Record<string, unknown>, companyId),
        "CreateSaleCommissionPlanParams",
      )
      const { urlPath, init } = stdbBffCommandPost("create_sale_commission_plan", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
  })
}

export function useCreateSaleCommissionPlanSplit(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, CreateSaleCommissionPlanSplitParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson(
        params as object,
        "CreateSaleCommissionPlanSplitParams",
      )
      const { urlPath, init } = stdbBffCommandPost("create_sale_commission_plan_split", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
  })
}

export function useCreateSaleContract(organizationId: bigint, companyId: bigint) {
  return useMutation<void, Error, CreateSaleContractParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson(
        withCompanyScope(params as Record<string, unknown>, companyId),
        "CreateSaleContractParams",
      )
      const { urlPath, init } = stdbBffCommandPost("create_sale_contract", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
  })
}

export function useCreateSaleCpqConstraint(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, CreateSaleCpqConstraintParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson(
        withCompanyScope(params as Record<string, unknown>, companyId),
        "CreateSaleCpqConstraintParams",
      )
      const { urlPath, init } = stdbBffCommandPost("create_sale_cpq_constraint", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
  })
}

export function useCreateSalesIntegrationIntent(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, CreateSalesIntegrationIntentParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson(
        withCompanyScope(params as Record<string, unknown>, companyId),
        "CreateSalesIntegrationIntentParams",
      )
      const { urlPath, init } = stdbBffCommandPost("create_sales_integration_intent", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
  })
}

export function useRecordSalesIntegrationResult(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<
    void,
    Error,
    {
      intentId: bigint | number | string
      params: RecordSalesIntegrationResultParams
    }
  >({
    mutationFn: async ({ intentId, params }) => {
      const encoded = stdbParamsToJson(
        params as object,
        "RecordSalesIntegrationResultParams",
      )
      const { urlPath, init } = stdbBffCommandPost("record_sales_integration_result", { companyId: companyId, intentId: toScalarU64(intentId), params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
  })
}

export function useApplyOmnichannelAllocation(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      orderId: bigint | number | string
      params: ApplyOmnichannelAllocationParams
    }
  >({
    mutationFn: async ({ orderId, params }) => {
      const encoded = stdbParamsToJson(
        params as object,
        "ApplyOmnichannelAllocationParams",
      )
      const { urlPath, init } = stdbBffCommandPost("apply_omnichannel_allocation", { companyId: companyId, orderId: toScalarU64(orderId), params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['sale-orders', rqBigIntKey(organizationId)],
      })
    },
  })
}

export function useScheduleSalesSlaEscalation(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, { delaySecs: number }>({
    mutationFn: async ({ delaySecs }) => {
      const { urlPath, init } = stdbBffCommandPost("schedule_sales_sla_escalation", { companyId: companyId, delaySecs: delaySecs })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorSales(r))
    },
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  SaleOrder,
  SaleOrderLine,
  ProductPricelist,
  ProductPricelistItem,
  StockPickingBatch,
  DeliveryCarrier,
  DeliveryPriceRule,
  ShippingMethod,
  PosPaymentMethod,
  PosLoyaltyProgram,
  PosLoyaltyCard,
  ReturnOrder,
  ReturnOrderLine,
  SaleCommission,
  ApplyOmnichannelAllocationParams,
  CreateDeliveryCarrierParams,
  CreateDeliveryPriceRuleParams,
  CreateLoyaltyProgramParams,
  CreatePaymentMethodParams,
  CreatePickingBatchParams,
  CreatePricelistParams,
  CreateSaleCommissionPlanParams,
  CreateSaleCommissionPlanSplitParams,
  CreateSaleContractParams,
  CreateSaleCpqConstraintParams,
  CreateSaleOrderParams,
  CreateSalesIntegrationIntentParams,
  CreateShippingMethodParams,
  RecordSalesIntegrationResultParams,
  UpdateSaleOrderParams,
} from '@lumiere/stdb/types'
