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
import { emptyQueryRows, fetchQueryList, type QueryRows } from '@/lib/query-fetch'

type ScalarId = bigint | number | string

function invalidateInventoryQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  const orgKey = organizationId.toString()
  void qc.invalidateQueries({ queryKey: ['stock-locations', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-quants', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-pickings', orgKey] })
  void qc.invalidateQueries({ queryKey: ['inventory-adjustments', orgKey] })
  void qc.invalidateQueries({ queryKey: ['production-lots', orgKey] })
  void qc.invalidateQueries({ queryKey: ['warehouses', orgKey] })
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useProducts(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['products', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/products', 'Failed to fetch products'),
    staleTime: 30_000,
    initialData,
  })
}

export function useProductCategories(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['product-categories', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/product-categories', 'Failed to fetch product categories'),
    staleTime: 30_000,
    initialData,
  })
}

export function useUoms(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['uoms', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/uoms', 'Failed to fetch units of measure'),
    staleTime: 30_000,
    initialData,
  })
}

export function useStockQuants(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['stock-quants', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/stock-quants', 'Failed to fetch stock quants'),
    staleTime: 30_000,
    initialData,
  })
}

export function useStockPickings(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['stock-pickings', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/stock-pickings', 'Failed to fetch stock pickings'),
    staleTime: 30_000,
    initialData,
  })
}

export function useWarehouses(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['warehouses', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/warehouses', 'Failed to fetch warehouses'),
    staleTime: 30_000,
    initialData,
  })
}

export function useInventoryAdjustments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['inventory-adjustments', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/inventory-adjustments', 'Failed to fetch inventory adjustments'),
    staleTime: 30_000,
    initialData,
  })
}

// TODO: No route yet — returns empty array until stock_location table/route is added
export function useStockLocations(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['stock-locations', organizationId.toString()],
    queryFn: emptyQueryRows,
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// TODO: No route yet — returns empty array until production_lot table/route is added
export function useProductionLots(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['production-lots', organizationId.toString()],
    queryFn: emptyQueryRows,
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// TODO: No route yet — returns empty array until quality_check table/route is added
export function useQualityChecks(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['quality-checks', organizationId.toString()],
    queryFn: emptyQueryRows,
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// TODO: No 3D warehouse route yet — returns empty zones/slots/items
export function useWarehouse3D(..._args: [bigint, bigint, bigint]) {
  void _args
  return { zones: [], slots: [], items: [] }
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateProduct(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
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
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_stock_picking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create stock picking')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['stock-pickings', organizationId.toString()] }),
  })
}

export function useCreateInventoryAdjustment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
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
  return useMutation<
    void,
    Error,
    { quantId: bigint; targetLocationId: bigint; quantity: number }
  >({
    mutationFn: async (params) => {
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

export function useCreateStockLocation(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_stock_location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create stock location')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateStockLocation(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { locationId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ locationId, params }) => {
      const r = await fetch('/api/call/update_stock_location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(locationId), params]),
      })
      if (!r.ok) throw new Error('Failed to update stock location')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteStockLocation(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (locationId) => {
      const r = await fetch('/api/call/delete_stock_location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(locationId)]),
      })
      if (!r.ok) throw new Error('Failed to delete stock location')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateStockMove(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_stock_move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create stock move')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useConfirmStockMove(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (moveId) => {
      const r = await fetch('/api/call/confirm_stock_move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(moveId), { company_id: null }]),
      })
      if (!r.ok) throw new Error('Failed to confirm stock move')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useAssignStockMove(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (moveId) => {
      const r = await fetch('/api/call/assign_stock_move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(moveId), { company_id: null }]),
      })
      if (!r.ok) throw new Error('Failed to assign stock move')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDoneStockMove(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { moveId: ScalarId; quantityDone: number }>({
    mutationFn: async ({ moveId, quantityDone }) => {
      const r = await fetch('/api/call/done_stock_move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          Number(moveId),
          { company_id: null, quantity_done: quantityDone },
        ]),
      })
      if (!r.ok) throw new Error('Failed to complete stock move')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCancelStockMove(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (moveId) => {
      const r = await fetch('/api/call/cancel_stock_move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(moveId), { company_id: null }]),
      })
      if (!r.ok) throw new Error('Failed to cancel stock move')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useConfirmStockPicking(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (pickingId) => {
      const r = await fetch('/api/call/confirm_stock_picking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(pickingId), { company_id: null }]),
      })
      if (!r.ok) throw new Error('Failed to confirm stock picking')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useAssignStockPicking(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (pickingId) => {
      const r = await fetch('/api/call/assign_stock_picking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(pickingId), { company_id: null }]),
      })
      if (!r.ok) throw new Error('Failed to assign stock picking')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCancelStockPicking(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (pickingId) => {
      const r = await fetch('/api/call/cancel_stock_picking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(pickingId), { company_id: null }]),
      })
      if (!r.ok) throw new Error('Failed to cancel stock picking')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateStockInventory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_stock_inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create stock inventory')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateStockInventoryLine(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { inventoryId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ inventoryId, params }) => {
      const r = await fetch('/api/call/create_stock_inventory_line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(inventoryId), params]),
      })
      if (!r.ok) throw new Error('Failed to create stock inventory line')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateStockInventoryState(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { inventoryId: ScalarId; newState: string }>({
    mutationFn: async ({ inventoryId, newState }) => {
      const r = await fetch('/api/call/update_stock_inventory_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(inventoryId), newState]),
      })
      if (!r.ok) throw new Error('Failed to update stock inventory state')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateStockProductionLot(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_stock_production_lot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create stock production lot')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateStockProductionSerial(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_stock_production_serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create stock production serial')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useReserveSerial(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (serialId) => {
      const r = await fetch('/api/call/reserve_serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(serialId)]),
      })
      if (!r.ok) throw new Error('Failed to reserve serial')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useBlockSerial(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { serialId: ScalarId; reason?: string | null }>({
    mutationFn: async ({ serialId, reason }) => {
      const r = await fetch('/api/call/block_serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(serialId), reason ?? null]),
      })
      if (!r.ok) throw new Error('Failed to block serial')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}
