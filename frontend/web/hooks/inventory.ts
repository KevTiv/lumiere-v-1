/**
 * Inventory hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Inventory module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 *
 * Notes:
 * - useStockLocations, useProductionLots, useQualityChecks return empty arrays (no route yet)
 * - useWarehouse3D returns empty zones/slots/items (no 3D route yet)
 * - useMoveStockItem3D posts to /api/call/create_inventory_adjustment as a proxy
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useProducts(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['products', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/products')
      if (!r.ok) throw new Error('Failed to fetch products')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useStockQuants(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['stock-quants', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/stock-quants')
      if (!r.ok) throw new Error('Failed to fetch stock quants')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useStockPickings(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['stock-pickings', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/stock-pickings')
      if (!r.ok) throw new Error('Failed to fetch stock pickings')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useWarehouses(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['warehouses', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/warehouses')
      if (!r.ok) throw new Error('Failed to fetch warehouses')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

export function useInventoryAdjustments(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['inventory-adjustments', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/inventory-adjustments')
      if (!r.ok) throw new Error('Failed to fetch inventory adjustments')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// TODO: No route yet — returns empty array until stock_location table/route is added
export function useStockLocations(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['stock-locations', organizationId.toString()],
    queryFn: async () => [] as Record<string, unknown>[],
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// TODO: No route yet — returns empty array until production_lot table/route is added
export function useProductionLots(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['production-lots', organizationId.toString()],
    queryFn: async () => [] as Record<string, unknown>[],
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// TODO: No route yet — returns empty array until quality_check table/route is added
export function useQualityChecks(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['quality-checks', organizationId.toString()],
    queryFn: async () => [] as Record<string, unknown>[],
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// TODO: No 3D warehouse route yet — returns empty zones/slots/items
export function useWarehouse3D(
  organizationId: bigint,
  _companyId: bigint,
  _warehouseId: bigint,
) {
  return { zones: [], slots: [], items: [] }
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateProduct(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create product')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', organizationId.toString()] }),
  })
}

export function useCreateStockPicking(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_stock_picking?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create stock picking')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['stock-pickings', organizationId.toString()] }),
  })
}

export function useCreateInventoryAdjustment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_inventory_adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create inventory adjustment')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['inventory-adjustments', organizationId.toString()] }),
  })
}

export function useMoveStockItem3D(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { quantId: bigint; targetLocationId: bigint; quantity: number }) => {
      const r = await fetch('/api/call/create_inventory_adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          {
            quantId: params.quantId.toString(),
            targetLocationId: params.targetLocationId.toString(),
            quantity: params.quantity,
          },
        ]),
      })
      if (!r.ok) throw new Error('Failed to move stock item')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['inventory-adjustments', organizationId.toString()] }),
  })
}
