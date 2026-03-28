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

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'
import { withCompanyScope } from '@/lib/org-scoped'

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

// Re-export cross-domain dependency so callers import from one place
export { useContacts } from "@/hooks/crm"
