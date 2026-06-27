"use client"

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
import { purchasingBffPost } from "@lumiere/stdb/commands"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"

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

async function parseCallErrorPo(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string }
    return j.error ?? r.statusText
  } catch {
    return r.statusText
  }
}

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

export function usePurchaseOrderLines(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['purchase-order-lines', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/purchase-order-lines', 'Failed to fetch purchase order lines'),
    staleTime: 30_000,
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

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreatePurchaseOrder(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient()
  const scopedCompanyId = options?.companyId
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(CREATE_PURCHASE_ORDER_DEFAULTS, params)
      const scoped = withCompanyScope(merged, scopedCompanyId)
      const { urlPath, init } = purchasingBffPost("create_purchase_order", [organizationId, stdbParamsToJson(scoped as object)])

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
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(CREATE_PURCHASE_REQUISITION_DEFAULTS, params)
      const scoped = withCompanyScope(merged, scopedCompanyId)
      const { urlPath, init } = purchasingBffPost("create_purchase_requisition", [organizationId, stdbParamsToJson(scoped as object)])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', rqBigIntKey(organizationId)] }),
  })
}

// Re-export cross-domain dependency so callers import from one place
export function useSendPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const { urlPath, init } = purchasingBffPost("send_purchase_order", [organizationId, toScalarU64(orderId)])

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
      const { urlPath, init } = purchasingBffPost("confirm_purchase_order", [organizationId, toScalarU64(orderId)])

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
      const { urlPath, init } = purchasingBffPost("cancel_purchase_order", [organizationId, toScalarU64(orderId)])

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
      const { urlPath, init } = purchasingBffPost("add_purchase_order_line", [
          organizationId,
          toScalarU64(orderId),
          stdbParamsToJson(
            mergeReducerParams(ADD_PURCHASE_ORDER_LINE_DEFAULTS, params) as object,
          ),
        ])

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
      const { urlPath, init } = purchasingBffPost("remove_purchase_order_line", [organizationId, toScalarU64(lineId)])

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
    }: {
      lineId: bigint | number | string
      qty: number
    }) => {
      const { urlPath, init } = purchasingBffPost("receive_po_line", [organizationId, toScalarU64(lineId), qty])

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
      const { urlPath, init } = purchasingBffPost("invoice_po_line", [organizationId, toScalarU64(lineId), qty])

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
      const { urlPath, init } = purchasingBffPost("submit_purchase_requisition", [organizationId, toScalarU64(requisitionId)])

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
      const { urlPath, init } = purchasingBffPost("approve_purchase_requisition", [organizationId, toScalarU64(requisitionId)])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to approve purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', rqBigIntKey(organizationId)] }),
  })
}

export function useClosePurchaseRequisition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (requisitionId: bigint | number | string) => {
      const { urlPath, init } = purchasingBffPost("close_purchase_requisition", [organizationId, toScalarU64(requisitionId)])

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
      const { urlPath, init } = purchasingBffPost("cancel_purchase_requisition", [organizationId, toScalarU64(requisitionId)])

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
      const { urlPath, init } = purchasingBffPost("compute_purchase_order_totals", [organizationId, toScalarU64(orderId)])

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
      const { urlPath, init } = purchasingBffPost("compute_purchase_order_line_totals", [organizationId, toScalarU64(orderId)])

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
      const { urlPath, init } = purchasingBffPost("update_purchase_order", [
          organizationId,
          BigInt(cid),
          toScalarU64(orderId),
          stdbParamsToJson(payload as object),
        ])

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
      const { urlPath, init } = purchasingBffPost("lock_purchase_order", [organizationId, toScalarU64(orderId)])

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
      const { urlPath, init } = purchasingBffPost("unlock_purchase_order", [organizationId, toScalarU64(orderId)])

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
      const { urlPath, init } = purchasingBffPost("update_purchase_order_line", [
          organizationId,
          toScalarU64(lineId),
          stdbParamsToJson(params as object),
        ])

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
      const { urlPath, init } = purchasingBffPost("create_landed_cost", [
          organizationId,
          BigInt(cid),
          stdbParamsToJson(payload as object),
        ])

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
      const { urlPath, init } = purchasingBffPost("update_landed_cost", [
          organizationId,
          toScalarU64(landedCostId),
          stdbParamsToJson(params as object),
        ])

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
      const { urlPath, init } = purchasingBffPost("delete_landed_cost", [organizationId, toScalarU64(landedCostId)])

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
      const { urlPath, init } = purchasingBffPost("add_landed_cost_line", [
          organizationId,
          toScalarU64(landedCostId),
          stdbParamsToJson(params as object),
        ])

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
      const { urlPath, init } = purchasingBffPost("remove_landed_cost_line", [organizationId, toScalarU64(lineId)])

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
      const { urlPath, init } = purchasingBffPost("compute_landed_costs", [organizationId, toScalarU64(landedCostId)])

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
      const { urlPath, init } = purchasingBffPost("post_landed_costs", [organizationId, toScalarU64(landedCostId)])

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
      const { urlPath, init } = purchasingBffPost("apply_landed_costs", [organizationId, BigInt(cid), toScalarU64(landedCostId)])

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
      const { urlPath, init } = purchasingBffPost("cancel_landed_cost", [organizationId, toScalarU64(landedCostId)])

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
      const { urlPath, init } = purchasingBffPost("submit_supplier_intake", [
        organizationId,
        stdbParamsToJson(params as object),
      ])
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
      const { urlPath, init } = purchasingBffPost("update_supplier_intake", [
          organizationId,
          toScalarU64(intakeId),
          stdbParamsToJson(params as object),
        ])

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
      const { urlPath, init } = purchasingBffPost("delete_supplier_intake", [organizationId, toScalarU64(intakeId)])

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
      const { urlPath, init } = purchasingBffPost("submit_supplier_intake", [
        organizationId,
        stdbParamsToJson(params as object),
      ])
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
      const { urlPath, init } = purchasingBffPost("review_supplier_intake", [
          organizationId,
          toScalarU64(intakeId),
          reviewerNotes ?? null,
        ])

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
      const { urlPath, init } = purchasingBffPost("approve_supplier_intake", [
          organizationId,
          toScalarU64(intakeId),
          toScalarU64(partnerId),
        ])

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
      const { urlPath, init } = purchasingBffPost("reject_supplier_intake", [organizationId, toScalarU64(intakeId), reason])

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
      const { urlPath, init } = purchasingBffPost("hold_supplier_intake", [organizationId, toScalarU64(intakeId), reason])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to hold supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

// ── Bill Creation ─────────────────────────────────────────────────────────────

export type CreateBillFromPurchaseOrderInput = {
  orderId: ScalarId
  journalId: ScalarId
  defaultExpenseAccountId: ScalarId
  invoiceDate: Date | string | number
}

export function useCreateBillFromPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateBillFromPurchaseOrderInput>({
    mutationFn: async ({ orderId, journalId, defaultExpenseAccountId, invoiceDate }) => {
      const when =
        invoiceDate instanceof Date ? invoiceDate : new Date(invoiceDate)
      const { urlPath, init } = purchasingBffPost("create_bill_from_purchase_order", [
          organizationId,
          toScalarU64(orderId),
          toScalarU64(journalId),
          toScalarU64(defaultExpenseAccountId),
          stbTimestampFromDate(when),
        ])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create bill from purchase order')
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId)
      void qc.invalidateQueries({ queryKey: ['purchase-orders', orgKey] })
      void qc.invalidateQueries({ queryKey: ['account-moves', orgKey] })
    },
  })
}

// ── CSV imports ───────────────────────────────────────────────────────────────

export function useImportPurchaseOrderCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = purchasingBffPost("import_purchase_order_csv", [organizationId, companyId, csvData])

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
      const { urlPath, init } = purchasingBffPost("import_purchase_order_line_csv", [organizationId, companyId, csvData])

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
      const { urlPath, init } = purchasingBffPost("import_supplier_info_csv", [organizationId, csvData])

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
      const { urlPath, init } = purchasingBffPost("update_po_receipt_status", [organizationId, toScalarU64(orderId)])

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
      const { urlPath, init } = purchasingBffPost("update_po_invoice_status", [organizationId, toScalarU64(orderId)])

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
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(
        scopedCompanyId != null ? { companyId: scopedCompanyId } : {},
        params,
      )
      const { urlPath, init } = purchasingBffPost("create_partner_bank", [organizationId, stdbParamsToJson(merged as object)])

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
      const { urlPath, init } = purchasingBffPost("update_partner_bank", [
          organizationId,
          toScalarU64(args.bankId),
          stdbParamsToJson(args.params as object),
        ])

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
      const { urlPath, init } = purchasingBffPost("delete_partner_bank", [organizationId, toScalarU64(bankId)])

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallErrorPo(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner-banks', rqBigIntKey(organizationId)] })
    },
  })
}

// Re-export cross-domain dependency so callers import from one place
export { useContacts } from "./crm"
