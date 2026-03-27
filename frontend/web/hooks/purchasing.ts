/**
 * Purchasing hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Purchasing module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function usePurchaseOrders(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['purchase-orders', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/purchase-orders')
      if (!r.ok) throw new Error('Failed to fetch purchase orders')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function usePurchaseOrderLines(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['purchase-order-lines', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/purchase-order-lines')
      if (!r.ok) throw new Error('Failed to fetch purchase order lines')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function usePurchaseRequisitions(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['purchase-requisitions', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/purchase-requisitions')
      if (!r.ok) throw new Error('Failed to fetch purchase requisitions')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreatePurchaseOrder(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_purchase_order?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create purchase order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-orders', organizationId.toString()] }),
  })
}

export function useCreatePurchaseRequisition(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_purchase_requisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create purchase requisition')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['purchase-requisitions', organizationId.toString()] }),
  })
}

// Re-export cross-domain dependency so callers import from one place
export { useContacts } from "@/hooks/crm"
