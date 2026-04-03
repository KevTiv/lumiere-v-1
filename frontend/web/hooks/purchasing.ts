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

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'
import { withCompanyScope } from '@/lib/org-scoped'

type ScalarId = bigint | number | string

function invalidateLandedAndPo(qc: QueryClient, organizationId: bigint) {
  const k = organizationId.toString()
  void qc.invalidateQueries({ queryKey: ['landed-costs', k] })
  void qc.invalidateQueries({ queryKey: ['purchase-orders', k] })
}

function invalidateSupplierIntakes(qc: QueryClient, organizationId: bigint) {
  const k = organizationId.toString()
  void qc.invalidateQueries({ queryKey: ['supplier-intakes', k] })
  void qc.invalidateQueries({ queryKey: ['contacts', k] })
}

async function postSubmitSupplierIntake(
  organizationId: bigint,
  params: Record<string, unknown>,
): Promise<void> {
  const r = await fetch('/api/call/submit_supplier_intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([organizationId.toString(), params]),
  })
  if (!r.ok) throw new Error('Failed to submit supplier intake')
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function usePurchaseOrders(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['purchase-orders', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/purchase-orders', 'Failed to fetch purchase orders'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePurchaseOrderLines(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['purchase-order-lines', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/purchase-order-lines', 'Failed to fetch purchase order lines'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePurchaseRequisitions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['purchase-requisitions', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/purchase-requisitions', 'Failed to fetch purchase requisitions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useLandedCosts(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['landed-costs', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/landed-costs', 'Failed to fetch landed costs'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSupplierIntakes(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['supplier-intakes', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/supplier-intakes', 'Failed to fetch supplier intakes'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreatePurchaseOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_purchase_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
  })
}

export function useCreatePurchaseRequisition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_purchase_requisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', organizationId.toString()] }),
  })
}

// Re-export cross-domain dependency so callers import from one place
export function useSendPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const r = await fetch('/api/call/send_purchase_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to send purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
  })
}

export function useConfirmPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const r = await fetch('/api/call/confirm_purchase_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to confirm purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
  })
}

export function useCancelPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const r = await fetch('/api/call/cancel_purchase_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to cancel purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
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
      const r = await fetch('/api/call/add_purchase_order_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId), params]),
      })
      if (!r.ok) throw new Error('Failed to add purchase order line')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', organizationId.toString()] }),
      ])
    },
  })
}

export function useRemovePurchaseOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lineId: bigint | number | string) => {
      const r = await fetch('/api/call/remove_purchase_order_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(lineId)]),
      })
      if (!r.ok) throw new Error('Failed to remove purchase order line')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', organizationId.toString()] }),
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
      const r = await fetch('/api/call/receive_po_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(lineId), qty]),
      })
      if (!r.ok) throw new Error('Failed to receive purchase order line')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', organizationId.toString()] }),
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
      const r = await fetch('/api/call/invoice_po_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(lineId), qty]),
      })
      if (!r.ok) throw new Error('Failed to invoice purchase order line')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', organizationId.toString()] }),
      ])
    },
  })
}

export function useSubmitPurchaseRequisition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (requisitionId: bigint | number | string) => {
      const r = await fetch('/api/call/submit_purchase_requisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(requisitionId)]),
      })
      if (!r.ok) throw new Error('Failed to submit purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', organizationId.toString()] }),
  })
}

export function useApprovePurchaseRequisition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (requisitionId: bigint | number | string) => {
      const r = await fetch('/api/call/approve_purchase_requisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(requisitionId)]),
      })
      if (!r.ok) throw new Error('Failed to approve purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', organizationId.toString()] }),
  })
}

export function useClosePurchaseRequisition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (requisitionId: bigint | number | string) => {
      const r = await fetch('/api/call/close_purchase_requisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(requisitionId)]),
      })
      if (!r.ok) throw new Error('Failed to close purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', organizationId.toString()] }),
  })
}

export function useCancelPurchaseRequisition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (requisitionId: bigint | number | string) => {
      const r = await fetch('/api/call/cancel_purchase_requisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(requisitionId)]),
      })
      if (!r.ok) throw new Error('Failed to cancel purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', organizationId.toString()] }),
  })
}

export function useComputePurchaseOrderTotals(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const r = await fetch('/api/call/compute_purchase_order_totals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to compute purchase order totals')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', organizationId.toString()] }),
      ])
    },
  })
}

export function useComputePurchaseOrderLineTotals(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: bigint | number | string) => {
      const r = await fetch('/api/call/compute_purchase_order_line_totals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to compute purchase order line totals')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', organizationId.toString()] }),
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
      const r = await fetch('/api/call/update_purchase_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), cid, Number(orderId), payload]),
      })
      if (!r.ok) throw new Error('Failed to update purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
  })
}

export function useLockPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (orderId) => {
      const r = await fetch('/api/call/lock_purchase_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to lock purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
  })
}

export function useUnlockPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (orderId) => {
      const r = await fetch('/api/call/unlock_purchase_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId)]),
      })
      if (!r.ok) throw new Error('Failed to unlock purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
  })
}

export function useUpdatePurchaseOrderLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { lineId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ lineId, params }) => {
      const r = await fetch('/api/call/update_purchase_order_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(lineId), params]),
      })
      if (!r.ok) throw new Error('Failed to update purchase order line')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['purchase-order-lines', organizationId.toString()] }),
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
      const r = await fetch('/api/call/create_landed_cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), cid, payload]),
      })
      if (!r.ok) throw new Error('Failed to create landed cost')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function useUpdateLandedCost(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { landedCostId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ landedCostId, params }) => {
      const r = await fetch('/api/call/update_landed_cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(landedCostId), params]),
      })
      if (!r.ok) throw new Error('Failed to update landed cost')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function useDeleteLandedCost(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (landedCostId) => {
      const r = await fetch('/api/call/delete_landed_cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(landedCostId)]),
      })
      if (!r.ok) throw new Error('Failed to delete landed cost')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function useAddLandedCostLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { landedCostId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ landedCostId, params }) => {
      const r = await fetch('/api/call/add_landed_cost_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(landedCostId), params]),
      })
      if (!r.ok) throw new Error('Failed to add landed cost line')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function useRemoveLandedCostLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { landedCostId: ScalarId; lineId: ScalarId }>({
    mutationFn: async ({ lineId }) => {
      const r = await fetch('/api/call/remove_landed_cost_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(lineId)]),
      })
      if (!r.ok) throw new Error('Failed to remove landed cost line')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function useComputeLandedCosts(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (landedCostId) => {
      const r = await fetch('/api/call/compute_landed_costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(landedCostId)]),
      })
      if (!r.ok) throw new Error('Failed to compute landed costs')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

export function usePostLandedCosts(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (landedCostId) => {
      const r = await fetch('/api/call/post_landed_costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(landedCostId)]),
      })
      if (!r.ok) throw new Error('Failed to post landed costs')
    },
    onSuccess: () => {
      const orgKey = organizationId.toString()
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
      const r = await fetch('/api/call/apply_landed_costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), cid, Number(landedCostId)]),
      })
      if (!r.ok) throw new Error('Failed to apply landed costs')
    },
    onSuccess: () => {
      invalidateLandedAndPo(qc, organizationId)
      void qc.invalidateQueries({ queryKey: ['stock-quants', organizationId.toString()] })
    },
  })
}

export function useCancelLandedCost(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (landedCostId) => {
      const r = await fetch('/api/call/cancel_landed_cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(landedCostId)]),
      })
      if (!r.ok) throw new Error('Failed to cancel landed cost')
    },
    onSuccess: () => invalidateLandedAndPo(qc, organizationId),
  })
}

// ── Supplier Intake ───────────────────────────────────────────────────────────

export function useCreateSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => postSubmitSupplierIntake(organizationId, params),
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useUpdateSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { intakeId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ intakeId, params }) => {
      const r = await fetch('/api/call/update_supplier_intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(intakeId), params]),
      })
      if (!r.ok) throw new Error('Failed to update supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useDeleteSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (intakeId) => {
      const r = await fetch('/api/call/delete_supplier_intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(intakeId)]),
      })
      if (!r.ok) throw new Error('Failed to delete supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

/** Submits a new supplier intake (same reducer as {@link useCreateSupplierIntake}). */
export function useSubmitSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => postSubmitSupplierIntake(organizationId, params),
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useReviewSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { intakeId: ScalarId; reviewerNotes?: string }>({
    mutationFn: async ({ intakeId, reviewerNotes }) => {
      const r = await fetch('/api/call/review_supplier_intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(intakeId), reviewerNotes ?? null]),
      })
      if (!r.ok) throw new Error('Failed to review supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useApproveSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (intakeId) => {
      const r = await fetch('/api/call/approve_supplier_intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(intakeId)]),
      })
      if (!r.ok) throw new Error('Failed to approve supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useRejectSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { intakeId: ScalarId; reason: string }>({
    mutationFn: async ({ intakeId, reason }) => {
      const r = await fetch('/api/call/reject_supplier_intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(intakeId), reason]),
      })
      if (!r.ok) throw new Error('Failed to reject supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

export function useHoldSupplierIntake(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { intakeId: ScalarId; reason: string }>({
    mutationFn: async ({ intakeId, reason }) => {
      const r = await fetch('/api/call/hold_supplier_intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(intakeId), reason]),
      })
      if (!r.ok) throw new Error('Failed to hold supplier intake')
    },
    onSuccess: () => invalidateSupplierIntakes(qc, organizationId),
  })
}

// ── Bill Creation ─────────────────────────────────────────────────────────────

export function useCreateBillFromPurchaseOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { orderId: ScalarId; billDate?: string; journalId?: ScalarId }>({
    mutationFn: async ({ orderId, billDate, journalId }) => {
      const r = await fetch('/api/call/create_bill_from_purchase_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(orderId), billDate ?? null, journalId ? Number(journalId) : null]),
      })
      if (!r.ok) throw new Error('Failed to create bill from purchase order')
    },
    onSuccess: () => {
      const orgKey = organizationId.toString()
      void qc.invalidateQueries({ queryKey: ['purchase-orders', orgKey] })
      void qc.invalidateQueries({ queryKey: ['account-moves', orgKey] })
    },
  })
}

// Re-export cross-domain dependency so callers import from one place
export { useContacts } from "@/hooks/crm"
