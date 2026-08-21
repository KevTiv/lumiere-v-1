"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
/**
 * Purchasing hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Purchasing module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 *
 * Added lifecycle hooks for purchase orders and requisitions so the UI can
 * confirm, send, cancel, submit, approve, and close records without falling
 * back to ad-hoc reducer calls.
 */


import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, coalesceQueryInitialData, type QueryRows, rqBigIntKey } from "../http"
import { invalidateResourceQueries, useSubscriptionAwareQuery } from "../subscription-query"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import {
  encodeIdentity,
  encodeOptionalString,
  encodeOptionalU64,
  stdbParamsToJson,
} from "@lumiere/erp-shared/stdb-params-json"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import type { CreatePurchaseOrderParams, CreatePartnerBankParams, CreatePurchaseRequisitionParams } from "@lumiere/stdb/types"

type ScalarId = bigint | number | string

function toScalarU64(v: ScalarId): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

/** Shallow merge for reducer JSON: `overrides` entries with value `undefined` are skipped. */
function mergeReducerParams(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

const CREATE_PURCHASE_ORDER_DEFAULTS: Record<string, unknown> = {
  invoiceIds: [],
  pickingIds: [],
  messageFollowerIds: [],
  messageIds: [],
  activityIds: [],
}

const CREATE_PURCHASE_REQUISITION_DEFAULTS: Record<string, unknown> = {
  multipleProduct: false,
  lineIds: [],
  lines: [],
  purchaseIds: [],
  activityIds: [],
  messageFollowerIds: [],
  messageIds: [],
}

const ADD_PURCHASE_ORDER_LINE_DEFAULTS: Record<string, unknown> = {
  discount: 0,
  taxIds: [],
}

function invalidateLandedAndPo(qc: QueryClient, organizationId: bigint) {
  const k = rqBigIntKey(organizationId)
  void qc.invalidateQueries({ queryKey: ['landed-costs', k] })
  void qc.invalidateQueries({ queryKey: ['landed-cost-lines', k] })
  void qc.invalidateQueries({ queryKey: ['purchase-orders', k] })
}

function invalidateSupplierIntakes(qc: QueryClient, organizationId: bigint) {
  const k = rqBigIntKey(organizationId)
  void qc.invalidateQueries({ queryKey: ['supplier-intakes', k] })
  void qc.invalidateQueries({ queryKey: ['contacts', k] })
}

import { responseErrorMessage as parseCallErrorPo } from "@lumiere/api-client/response-error"

// ── Reads ────────────────────────────────────────────────────────────────────

export function usePurchaseOrders(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['purchase-orders', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/purchase-orders', 'Failed to fetch purchase orders'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

/** Server-bounded: `purchase_order.state = ToApprove`. */
export function usePurchaseOrdersToApprove(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['purchase-orders-to-approve', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/purchase-orders-to-approve',
        'Failed to fetch purchase orders awaiting approval',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

/** Server-bounded: `purchase_order.receipt_status = partial`. */
export function usePurchaseOrdersPartialReceipt(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['purchase-orders-partial-receipt', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/purchase-orders-partial-receipt',
        'Failed to fetch partially received purchase orders',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

/** Server-bounded: `purchase_order_line.match_state = over_billed`. */
export function usePurchaseOrderLinesOverBilled(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['purchase-order-lines-over-billed', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/purchase-order-lines-over-billed',
        'Failed to fetch over-billed purchase order lines',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePurchaseOrderLines(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['purchase-order-lines', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/purchase-order-lines', 'Failed to fetch purchase order lines'),
    staleTime: 5_000,
    refetchOnMount: "always",
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePurchaseRequisitions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['purchase-requisitions', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/purchase-requisitions', 'Failed to fetch purchase requisitions'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useLandedCosts(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['landed-costs', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/landed-costs', 'Failed to fetch landed costs'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useLandedCostLines(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['landed-cost-lines', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/landed-cost-lines', 'Failed to fetch landed cost lines'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function useSupplierIntakes(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['supplier-intakes', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/supplier-intakes', 'Failed to fetch supplier intakes'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

export function usePartnerBanks(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['partner-banks', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/partner-banks', 'Failed to fetch partner bank accounts'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  })
}

/** Subscription-aware blanket order list with an HTTP fallback. */
export function usePurchaseBlanketOrders(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("purchase-blanket-orders", organizationId, { initialData })
}

/** Subscription-aware blanket order line list with an HTTP fallback. */
export function usePurchaseBlanketOrderLines(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("purchase-blanket-order-lines", organizationId, { initialData })
}

/** Subscription-aware blanket release list with an HTTP fallback. */
export function usePurchaseBlanketReleases(organizationId: bigint, initialData?: QueryRows) {
  return useSubscriptionAwareQuery("purchase-blanket-releases", organizationId, { initialData })
}


// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreatePurchaseOrder(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient()
  const scopedCompanyId = options?.companyId
  return useMutation<void, Error, CreatePurchaseOrderParams>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(CREATE_PURCHASE_ORDER_DEFAULTS, params)
      const scoped = withCompanyScope(merged, scopedCompanyId)
      const { urlPath, init } = stdbBffCommandPost("create_purchase_order", { params: stdbParamsToJson(scoped as object, "CreatePurchaseOrderParams") })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useCreatePurchaseRequisition(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient()
  const scopedCompanyId = options?.companyId
  return useMutation<void, Error, CreatePurchaseRequisitionParams>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(CREATE_PURCHASE_REQUISITION_DEFAULTS, params)
      const scoped = withCompanyScope(merged, scopedCompanyId)
      const { urlPath, init } = stdbBffCommandPost("create_purchase_requisition", { params: stdbParamsToJson(scoped as object, "CreatePurchaseRequisitionParams") })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create purchase requisition')
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['purchase-requisitions', k] })
      void qc.invalidateQueries({ queryKey: ['purchase-requisition-lines', k] })
    },
  })
}

export function useAddPurchaseRequisitionLine(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      requisitionId: ScalarId
      productId: ScalarId
      productUom: ScalarId
      productUomQty: number
      name?: string | null
      sequence?: number | null
    }
  >({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson(
        {
          productId: toScalarU64(params.productId),
          productUom: toScalarU64(params.productUom),
          productUomQty: params.productUomQty,
          name: params.name ?? null,
          sequence: params.sequence ?? null,
        },
        "AddPurchaseRequisitionLineParams",
      )
      const { urlPath, init } = stdbBffCommandPost("add_purchase_requisition_line", { companyId: companyId, requisitionId: toScalarU64(params.requisitionId), params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['purchase-requisitions', k] })
      void qc.invalidateQueries({ queryKey: ['purchase-requisition-lines', k] })
    },
  })
}

// Re-export cross-domain dependency so callers import from one place
export function useSendPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("send_purchase_order", { orderId: toScalarU64(orderId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to send purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useConfirmPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("confirm_purchase_order", { orderId: toScalarU64(orderId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to confirm purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useCancelPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_purchase_order", { orderId: toScalarU64(orderId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useAddPurchaseOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      orderId,
      params,
    }: {
      orderId: bigint | number | string
      params: Record<string, unknown>
    }) => {
      const { urlPath, init } = stdbBffCommandPost("add_purchase_order_line", { orderId: toScalarU64(orderId), params: stdbParamsToJson(
            mergeReducerParams(ADD_PURCHASE_ORDER_LINE_DEFAULTS, params) as object,
            "AddPurchaseOrderLineParams",
          ) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add purchase order line')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useRemovePurchaseOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("remove_purchase_order_line", { lineId: toScalarU64(lineId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to remove purchase order line')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useReceivePurchaseOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      lineId,
      qty,
      lotId,
    }: {
      lineId: bigint | number | string
      qty: number
      lotId?: bigint | number | string | null
    }) => {
      const lotArg =
        lotId == null || lotId === ""
          ? null
          : toScalarU64(lotId)
      const { urlPath, init } = stdbBffCommandPost("receive_po_line", { lineId: toScalarU64(lineId), qty: qty, lotId: lotArg })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to receive purchase order line')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useInvoicePurchaseOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      lineId,
      qty,
    }: {
      lineId: bigint | number | string
      qty: number
    }) => {
      const { urlPath, init } = stdbBffCommandPost("invoice_po_line", { lineId: toScalarU64(lineId), qty: qty })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to invoice purchase order line')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useSubmitPurchaseRequisition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (requisitionId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("submit_purchase_requisition", { requisitionId: toScalarU64(requisitionId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to submit purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', rqBigIntKey(organizationId)] }),
  })
}

export function useApprovePurchaseRequisition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (requisitionId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("approve_purchase_requisition", { requisitionId: toScalarU64(requisitionId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to approve purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', rqBigIntKey(organizationId)] }),
  })
}

export function useConvertPurchaseRequisitionToPo(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (requisitionId) => {
      const cid = companyId != null ? Number(companyId) : undefined
      if (cid == null || !Number.isFinite(cid)) {
        throw new Error('companyId is required to convert requisition to PO')
      }
      const { urlPath, init } = stdbBffCommandPost("convert_purchase_requisition_to_po", { companyId: BigInt(cid), requisitionId: toScalarU64(requisitionId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-requisitions', k] }),
        qc.invalidateQueries({ queryKey: ['purchase-orders', k] }),
        qc.invalidateQueries({ queryKey: ['purchase-orders-to-approve', k] }),
      ])
    },
  })
}

export function useClosePurchaseRequisition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (requisitionId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("close_purchase_requisition", { requisitionId: toScalarU64(requisitionId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to close purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', rqBigIntKey(organizationId)] }),
  })
}

export function useCancelPurchaseRequisition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (requisitionId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_purchase_requisition", { requisitionId: toScalarU64(requisitionId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', rqBigIntKey(organizationId)] }),
  })
}

export function useComputePurchaseOrderTotals(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("compute_purchase_order_totals", { orderId: toScalarU64(orderId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to compute purchase order totals')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useComputePurchaseOrderLineTotals(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const { urlPath, init } = stdbBffCommandPost("compute_purchase_order_line_totals", { orderId: toScalarU64(orderId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to compute purchase order line totals')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useUpdatePurchaseOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { orderId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ orderId, params }) => {
      const scoped = withCompanyScope(params, companyId)
      const cid =
        companyId != null
          ? Number(companyId)
          : scoped.companyId != null
            ? Number(scoped.companyId)
            : undefined
      if (cid == null || !Number.isFinite(cid)) {
        throw new Error('companyId is required to update purchase order')
      }
      const { companyId: _drop, ...payload } = scoped
      const { urlPath, init } = stdbBffCommandPost("update_purchase_order", { companyId: BigInt(cid), orderId: toScalarU64(orderId), params: stdbParamsToJson(payload as object, "UpdatePurchaseOrderParams") })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useLockPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (orderId) => {
      const { urlPath, init } = stdbBffCommandPost("lock_purchase_order", { orderId: toScalarU64(orderId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to lock purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useUnlockPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (orderId) => {
      const { urlPath, init } = stdbBffCommandPost("unlock_purchase_order", { orderId: toScalarU64(orderId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to unlock purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdatePurchaseOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { lineId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ lineId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("update_purchase_order_line", { lineId: toScalarU64(lineId), params: stdbParamsToJson(params as object, "UpdatePurchaseOrderLineParams") })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update purchase order line')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

// ── Landed Costs ──────────────────────────────────────────────────────────────

export function useCreateLandedCost(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const scoped = withCompanyScope(params, companyId)
      const cid =
        companyId != null
          ? Number(companyId)
          : scoped.companyId != null
            ? Number(scoped.companyId)
            : undefined
      if (cid == null || !Number.isFinite(cid)) {
        throw new Error('companyId is required to create landed cost')
      }
      const { companyId: _drop, ...payload } = scoped
      const { urlPath, init } = stdbBffCommandPost("create_landed_cost", { companyId: BigInt(cid), params: stdbParamsToJson(payload as object, "CreateLandedCostParams") })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create landed cost')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function useUpdateLandedCost(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { landedCostId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ landedCostId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("update_landed_cost", { landedCostId: toScalarU64(landedCostId), params: stdbParamsToJson(params as object, "UpdateLandedCostParams") })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update landed cost')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function useDeleteLandedCost(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (landedCostId) => {
      const { urlPath, init } = stdbBffCommandPost("delete_landed_cost", { landedCostId: toScalarU64(landedCostId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete landed cost')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function useAddLandedCostLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { landedCostId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ landedCostId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("add_landed_cost_line", { landedCostId: toScalarU64(landedCostId), params: stdbParamsToJson(params as object, "AddLandedCostLineParams") })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to add landed cost line')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function useRemoveLandedCostLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { landedCostId: ScalarId; lineId: ScalarId }>({
    mutationFn: async ({ lineId }) => {
      const { urlPath, init } = stdbBffCommandPost("remove_landed_cost_line", { lineId: toScalarU64(lineId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to remove landed cost line')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function useComputeLandedCosts(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (landedCostId) => {
      const { urlPath, init } = stdbBffCommandPost("compute_landed_costs", { landedCostId: toScalarU64(landedCostId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to compute landed costs')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function usePostLandedCosts(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (landedCostId) => {
      const { urlPath, init } = stdbBffCommandPost("post_landed_costs", { landedCostId: toScalarU64(landedCostId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to post landed costs')
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId)
      invalidateLandedAndPo(qc, organizationId)
      void qc.invalidateQueries({ queryKey: ['account-moves', orgKey] })
    },
  })
}

export function useApplyLandedCosts(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { landedCostId: ScalarId; companyId?: ScalarId }>({
    mutationFn: async ({ landedCostId, companyId: rowCompany }) => {
      const cid =
        companyId != null
          ? Number(companyId)
          : rowCompany != null
            ? Number(rowCompany)
            : undefined
      if (cid == null || !Number.isFinite(cid)) {
        throw new Error('companyId is required to apply landed costs')
      }
      const { urlPath, init } = stdbBffCommandPost("apply_landed_costs", { companyId: BigInt(cid), landedCostId: toScalarU64(landedCostId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to apply landed costs')
    },
    onSuccess: () => {
      invalidateLandedAndPo(qc, organizationId)
      void qc.invalidateQueries({ queryKey: ['stock-quants', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCancelLandedCost(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (landedCostId) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_landed_cost", { landedCostId: toScalarU64(landedCostId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel landed cost')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

// ── Supplier Intake ───────────────────────────────────────────────────────────

export function useCreateSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("submit_supplier_intake", { params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to submit supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useUpdateSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { intakeId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ intakeId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("update_supplier_intake", { intakeId: toScalarU64(intakeId), params: stdbParamsToJson(params as object) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useDeleteSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (intakeId) => {
      const { urlPath, init } = stdbBffCommandPost("delete_supplier_intake", { intakeId: toScalarU64(intakeId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

/** Submits a new supplier intake (same reducer as {@link useCreateSupplierIntake}). */
export function useSubmitSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("submit_supplier_intake", { params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to submit supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useReviewSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { intakeId: ScalarId; reviewerNotes?: string }>({
    mutationFn: async ({ intakeId, reviewerNotes }) => {
      const { urlPath, init } = stdbBffCommandPost("review_supplier_intake", { intakeId: toScalarU64(intakeId), notes: reviewerNotes ?? null })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to review supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useApproveSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { intakeId: ScalarId; partnerId: ScalarId }>({
    mutationFn: async ({ intakeId, partnerId }) => {
      const { urlPath, init } = stdbBffCommandPost("approve_supplier_intake", { intakeId: toScalarU64(intakeId), partnerId: toScalarU64(partnerId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to approve supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useRejectSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { intakeId: ScalarId; reason: string }>({
    mutationFn: async ({ intakeId, reason }) => {
      const { urlPath, init } = stdbBffCommandPost("reject_supplier_intake", { intakeId: toScalarU64(intakeId), rejectionReason: reason })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to reject supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useHoldSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { intakeId: ScalarId; reason: string }>({
    mutationFn: async ({ intakeId, reason }) => {
      const { urlPath, init } = stdbBffCommandPost("hold_supplier_intake", { intakeId: toScalarU64(intakeId), notes: reason })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to hold supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

// ── Bill Creation ─────────────────────────────────────────────────────────────

export type CreateBillFromPurchaseOrderInput = {
  orderId: ScalarId
  params: import("@lumiere/stdb/types").CreateBillFromPurchaseOrderParams
}

export function useCreateBillFromPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateBillFromPurchaseOrderInput>({
    mutationFn: async ({ orderId, params }) => {
      const u64 = (v: bigint | number | string) => (typeof v === "bigint" ? v : BigInt(String(v)))
      const encodedParams = stdbParamsToJson(
        {
          journalId: params.journalId,
          defaultExpenseAccountId: params.defaultExpenseAccountId,
          invoiceDate: params.invoiceDate,
          expenseLine: stdbParamsToJson(
            params.expenseLine as object,
            "AddAccountMoveLineParams",
          ),
          payableLine: stdbParamsToJson(params.payableLine as object, "AddAccountMoveLineParams"),
        } as object,
        "CreateBillFromPurchaseOrderParams",
      )
      const { urlPath, init } = stdbBffCommandPost("create_bill_from_purchase_order", { purchaseOrderId: u64(orderId), params: encodedParams })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create bill from purchase order")
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ["purchase-orders", orgKey] })
      void qc.invalidateQueries({ queryKey: ["purchase-order-lines", orgKey] })
      void qc.invalidateQueries({ queryKey: ["account-moves", orgKey] })
    },
  })
}

// ── CSV imports ───────────────────────────────────────────────────────────────

export function useImportPurchaseOrderCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_purchase_order_csv", { companyId: companyId, csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorPo(res))
    },
    onSuccess: () => {
      const k = rqBigIntKey(companyId)
      void qc.invalidateQueries({ queryKey: ['purchase-orders', k] })
    },
  })
}

export function useImportPurchaseOrderLineCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_purchase_order_line_csv", { companyId: companyId, csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorPo(res))
    },
    onSuccess: () => {
      const k = rqBigIntKey(companyId)
      void qc.invalidateQueries({ queryKey: ['purchase-order-lines', k] })
    },
  })
}

export function useImportSupplierInfoCsv(organizationId: bigint, productsQueryKeyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_supplier_info_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorPo(res))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products', productsQueryKeyId] })
    },
  })
}

export function usePurchasingCsvImportMutations(organizationId: bigint, companyId: bigint) {
  return {
    importPurchaseOrder: useImportPurchaseOrderCsv(organizationId, companyId),
    importPurchaseOrderLine: useImportPurchaseOrderLineCsv(organizationId, companyId),
    importSupplierInfo: useImportSupplierInfoCsv(organizationId, companyId),
  }
}

export function useUpdatePoReceiptStatus(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost("update_po_receipt_status", { orderId: toScalarU64(orderId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] })
    },
  })
}

export function useUpdatePoInvoiceStatus(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost("update_po_invoice_status", { orderId: toScalarU64(orderId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreatePartnerBank(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient()
  const scopedCompanyId = options?.companyId
  return useMutation<void, Error, CreatePartnerBankParams>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(
        scopedCompanyId != null ? { companyId: scopedCompanyId } : {},
        params,
      )
      const { urlPath, init } = stdbBffCommandPost("create_partner_bank", { params: stdbParamsToJson(merged as object, "CreatePartnerBankParams") })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner-banks', rqBigIntKey(organizationId)] })
    },
  })
}

export function useUpdatePartnerBank(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { bankId: ScalarId; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_partner_bank", { bankId: toScalarU64(args.bankId), params: stdbParamsToJson(args.params as object) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner-banks', rqBigIntKey(organizationId)] })
    },
  })
}

export function useDeletePartnerBank(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (bankId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost("delete_partner_bank", { bankId: toScalarU64(bankId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner-banks', rqBigIntKey(organizationId)] })
    },
  })
}

// ── Wave C — RFQ / purchase returns (prompt-driven MVP) ───────────────────────

export function useCreatePurchaseRfq(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      requisitionId?: ScalarId | null
      currencyId: ScalarId
      notes?: string | null
      lines: Array<{
        productId: ScalarId
        productUom: ScalarId
        productUomQty: number
        name?: string | null
        sequence?: number | null
      }>
      metadata?: string | null
    }
  >({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson(
        {
          requisitionId:
            params.requisitionId != null
              ? toScalarU64(params.requisitionId)
              : null,
          currencyId: toScalarU64(params.currencyId),
          notes: params.notes ?? null,
          lines: params.lines.map((l) => ({
            productId: toScalarU64(l.productId),
            productUom: toScalarU64(l.productUom),
            productUomQty: l.productUomQty,
            name: l.name ?? null,
            sequence: l.sequence ?? null,
          })),
          metadata: params.metadata ?? null,
        },
        "CreatePurchaseRfqParams",
      )
      const { urlPath, init } = stdbBffCommandPost("create_purchase_rfq", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ["purchase-rfqs", k] })
      void qc.invalidateQueries({ queryKey: ["purchase-rfq-lines", k] })
    },
  })
}

export function useAddPurchaseRfqBid(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      rfqId: ScalarId
      partnerId: ScalarId
      currencyId: ScalarId
      priceUnit: number
      notes?: string | null
    }
  >({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson(
        {
          partnerId: toScalarU64(params.partnerId),
          currencyId: toScalarU64(params.currencyId),
          priceUnit: params.priceUnit,
          notes: params.notes ?? null,
        },
        "CreatePurchaseRfqBidParams",
      )
      const { urlPath, init } = stdbBffCommandPost("add_purchase_rfq_bid", { companyId: companyId, rfqId: toScalarU64(params.rfqId), params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ["purchase-rfqs", k] })
      void qc.invalidateQueries({ queryKey: ["purchase-rfq-bids", k] })
    },
  })
}

export function useAwardPurchaseRfqBid(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<void, Error, { rfqId: ScalarId; bidId: ScalarId }>({
    mutationFn: async ({ rfqId, bidId }) => {
      const { urlPath, init } = stdbBffCommandPost("award_purchase_rfq_bid", { companyId: companyId, rfqId: toScalarU64(rfqId), bidId: toScalarU64(bidId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["purchase-rfqs", k] }),
        qc.invalidateQueries({ queryKey: ["purchase-rfq-bids", k] }),
        qc.invalidateQueries({ queryKey: ["purchase-orders", k] }),
        qc.invalidateQueries({ queryKey: ["purchase-order-lines", k] }),
      ])
    },
  })
}

export function useCreatePurchaseReturn(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      purchaseOrderId?: ScalarId | null
      partnerId: ScalarId
      returnReason?: string | null
      lines: Array<{
        purchaseOrderLineId?: ScalarId | null
        productId: ScalarId
        productUom: ScalarId
        productUomQty: number
        priceUnit: number
        toRefund: boolean
      }>
    }
  >({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson(
        {
          purchaseOrderId:
            params.purchaseOrderId != null
              ? toScalarU64(params.purchaseOrderId)
              : null,
          partnerId: toScalarU64(params.partnerId),
          returnReason: params.returnReason ?? null,
          lines: params.lines.map((l) => ({
            purchaseOrderLineId:
              l.purchaseOrderLineId != null
                ? toScalarU64(l.purchaseOrderLineId)
                : null,
            productId: toScalarU64(l.productId),
            productUom: toScalarU64(l.productUom),
            productUomQty: l.productUomQty,
            priceUnit: l.priceUnit,
            toRefund: l.toRefund,
          })),
        },
        "CreatePurchaseReturnParams",
      )
      const { urlPath, init } = stdbBffCommandPost("create_purchase_return", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ["purchase-returns", k] })
      void qc.invalidateQueries({ queryKey: ["purchase-return-lines", k] })
    },
  })
}

export function useConfirmPurchaseReturn(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (purchaseReturnId) => {
      const { urlPath, init } = stdbBffCommandPost("confirm_purchase_return", { companyId: companyId, purchaseReturnId: toScalarU64(purchaseReturnId) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["purchase-returns", k] }),
        qc.invalidateQueries({ queryKey: ["stock-pickings", k] }),
        qc.invalidateQueries({ queryKey: ["stock-moves", k] }),
      ])
    },
  })
}

export function useCreateVendorCreditFromPurchaseReturn(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      purchaseReturnId: ScalarId
      journalId: ScalarId
      expenseAccountId: ScalarId
      payableAccountId: ScalarId
      metadata?: string | null
    }
  >({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson(
        {
          journalId: toScalarU64(params.journalId),
          expenseAccountId: toScalarU64(params.expenseAccountId),
          payableAccountId: toScalarU64(params.payableAccountId),
          metadata: params.metadata ?? null,
        },
        "CreateVendorCreditFromPurchaseReturnParams",
      )
      const { urlPath, init } = stdbBffCommandPost("create_vendor_credit_from_purchase_return", { companyId: companyId, purchaseReturnId: toScalarU64(params.purchaseReturnId), params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: async () => {
      const k = rqBigIntKey(organizationId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["purchase-returns", k] }),
        qc.invalidateQueries({ queryKey: ["account-moves", k] }),
      ])
    },
  })
}

// ── Procurement advanced (Wave D) — creates via BFF; no QueryResourceKey lists yet ─

export type CreatePurchaseBlanketOrderParams = {
  name: string
  partnerId: bigint
  currencyId: bigint
  dateStart?: unknown | null
  dateEnd?: unknown | null
  lines: Array<{
    productId: bigint
    productUom: bigint
    committedQuantity: number
    priceUnit: number
    metadata?: string | null
  }>
  metadata?: string | null
}

export type ReleaseBlanketToPoParams = {
  idempotencyKey: string
  lines: Array<{ blanketLineId: bigint; quantity: number }>
  notes?: string | null
  datePlanned?: unknown | null
  metadata?: string | null
}

export type CreatePurchaseContractParams = {
  name: string
  partnerId: bigint
  dateStart?: unknown | null
  dateEnd?: unknown | null
  metadata?: string | null
}

export type UpsertVendorScorecardParams = {
  partnerId: bigint
  otifScore: number
  qualityScore: number
  metadata?: string | null
}

export type SetVendorRiskFlagParams = {
  partnerId: bigint
  isFlagged: boolean
  riskLevel: string
  reason?: string | null
  metadata?: string | null
}

export type CreateConsignmentAgreementParams = {
  name: string
  partnerId: bigint
  productId: bigint
  warehouseId: bigint
  metadata?: string | null
}

export type SetPurchaseApprovalDelegateParams = {
  principalIdentity: string
  delegateIdentity: string
  isActive: boolean
  metadata?: string | null
}

export type SetCommodityPriceIndexParams = {
  code: string
  rate: number
  asOf: Date | string
  metadata?: string | null
}

export type CreatePurchasingIntegrationIntentParams = {
  provider: string
  intentType: string
  purchaseOrderId?: bigint | null
  idempotencyKey: string
  requestPayload?: string | null
  metadata?: string | null
}

export type RecordPurchasingIntegrationResultParams = {
  status: string
  externalReference?: string | null
  lastError?: string | null
  metadata?: string | null
}

function optTs(v: unknown | null | undefined): { none: [] } | { some: unknown } {
  if (v == null || v === "") return { none: [] }
  return { some: v }
}

export function useCreatePurchaseBlanketOrder(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePurchaseBlanketOrderParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson({
        name: params.name,
        partnerId: params.partnerId,
        currencyId: params.currencyId,
        dateStart: optTs(params.dateStart),
        dateEnd: optTs(params.dateEnd),
        lines: params.lines.map((line) => ({
          productId: line.productId,
          productUom: line.productUom,
          committedQuantity: line.committedQuantity,
          priceUnit: line.priceUnit,
          metadata: encodeOptionalString(line.metadata),
        })),
        metadata: encodeOptionalString(params.metadata),
      })
      const { urlPath, init } = stdbBffCommandPost("create_purchase_blanket_order", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, [
        "purchase-blanket-orders",
        "purchase-blanket-order-lines",
      ]),
  })
}

export function useReleaseBlanketToPo(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { blanketOrderId: ScalarId; params: ReleaseBlanketToPoParams }
  >({
    mutationFn: async ({ blanketOrderId, params }) => {
      const encoded = stdbParamsToJson({
        idempotencyKey: params.idempotencyKey,
        lines: params.lines,
        notes: encodeOptionalString(params.notes),
        datePlanned: optTs(params.datePlanned),
        metadata: encodeOptionalString(params.metadata),
      })
      const { urlPath, init } = stdbBffCommandPost("release_blanket_to_po", { companyId: companyId, blanketOrderId: toScalarU64(blanketOrderId), params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () =>
      invalidateResourceQueries(qc, organizationId, [
        "purchase-orders",
        "purchase-orders-to-approve",
        "purchase-order-lines",
        "purchase-blanket-orders",
        "purchase-blanket-order-lines",
        "purchase-blanket-releases",
      ]),
  })
}

export function useCreatePurchaseContract(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, CreatePurchaseContractParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson({
        name: params.name,
        partnerId: params.partnerId,
        dateStart: optTs(params.dateStart),
        dateEnd: optTs(params.dateEnd),
        metadata: encodeOptionalString(params.metadata),
      })
      const { urlPath, init } = stdbBffCommandPost("create_purchase_contract", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
  })
}

export function useUpsertVendorScorecard(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, UpsertVendorScorecardParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson({
        partnerId: params.partnerId,
        otifScore: params.otifScore,
        qualityScore: params.qualityScore,
        metadata: encodeOptionalString(params.metadata),
      })
      const { urlPath, init } = stdbBffCommandPost("upsert_vendor_scorecard", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
  })
}

export function useSetVendorRiskFlag(organizationId: bigint, companyId: bigint) {
  return useMutation<void, Error, SetVendorRiskFlagParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson({
        partnerId: params.partnerId,
        isFlagged: params.isFlagged,
        riskLevel: params.riskLevel,
        reason: encodeOptionalString(params.reason),
        metadata: encodeOptionalString(params.metadata),
      })
      const { urlPath, init } = stdbBffCommandPost("set_vendor_risk_flag", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
  })
}

export function useCreateConsignmentAgreement(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, CreateConsignmentAgreementParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson({
        name: params.name,
        partnerId: params.partnerId,
        productId: params.productId,
        warehouseId: params.warehouseId,
        metadata: encodeOptionalString(params.metadata),
      })
      const { urlPath, init } = stdbBffCommandPost("create_consignment_agreement", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
  })
}

export function useSetPurchaseApprovalDelegate(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, SetPurchaseApprovalDelegateParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson({
        principalIdentity: encodeIdentity(params.principalIdentity),
        delegateIdentity: encodeIdentity(params.delegateIdentity),
        isActive: params.isActive,
        metadata: encodeOptionalString(params.metadata),
      })
      const { urlPath, init } = stdbBffCommandPost("set_purchase_approval_delegate", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
  })
}

export function useSetCommodityPriceIndex(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, SetCommodityPriceIndexParams>({
    mutationFn: async (params) => {
      const asOfDate =
        params.asOf instanceof Date ? params.asOf : new Date(String(params.asOf))
      const encoded = stdbParamsToJson({
        code: params.code,
        rate: params.rate,
        asOf: stbTimestampFromDate(asOfDate),
        metadata: encodeOptionalString(params.metadata),
      })
      const { urlPath, init } = stdbBffCommandPost("set_commodity_price_index", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
  })
}

export function useCreatePurchasingIntegrationIntent(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<void, Error, CreatePurchasingIntegrationIntentParams>({
    mutationFn: async (params) => {
      const encoded = stdbParamsToJson({
        provider: params.provider,
        intentType: params.intentType,
        purchaseOrderId: encodeOptionalU64(params.purchaseOrderId ?? null),
        idempotencyKey: params.idempotencyKey,
        requestPayload: encodeOptionalString(params.requestPayload),
        metadata: encodeOptionalString(params.metadata),
      })
      const { urlPath, init } = stdbBffCommandPost("create_purchasing_integration_intent", { companyId: companyId, params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
  })
}

export function useRecordPurchasingIntegrationResult(
  organizationId: bigint,
  companyId: bigint,
) {
  return useMutation<
    void,
    Error,
    {
      intentId: ScalarId
      params: RecordPurchasingIntegrationResultParams
    }
  >({
    mutationFn: async ({ intentId, params }) => {
      const encoded = stdbParamsToJson({
        status: params.status,
        externalReference: encodeOptionalString(params.externalReference),
        lastError: encodeOptionalString(params.lastError),
        metadata: encodeOptionalString(params.metadata),
      })
      const { urlPath, init } = stdbBffCommandPost("record_purchasing_integration_result", { companyId: companyId, intentId: toScalarU64(intentId), params: encoded })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
  })
}

// Re-export cross-domain dependency so callers import from one place
export { useContacts } from "./crm"
