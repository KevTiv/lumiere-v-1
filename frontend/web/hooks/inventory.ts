/**
 * Inventory hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Inventory module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'
import { buildWarehouse3DView } from '@/lib/warehouse-3d-from-api'

type ScalarId = bigint | number | string

function invalidateInventoryQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  const orgKey = organizationId.toString()
  void qc.invalidateQueries({ queryKey: ['stock-locations', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-quants', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-pickings', orgKey] })
  void qc.invalidateQueries({ queryKey: ['inventory-adjustments', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-production-lots', orgKey] })
  void qc.invalidateQueries({ queryKey: ['warehouses', orgKey] })
  void qc.invalidateQueries({ queryKey: ['quality-checks', orgKey] })
  void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-cycle-counts', orgKey] })
  void qc.invalidateQueries({ queryKey: ['warehouse-3d', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-inventories', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-moves', orgKey] })
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

export function useStockLocations(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['stock-locations', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/stock-locations', 'Failed to fetch stock locations'),
    staleTime: 30_000,
    initialData,
  })
}

export function useProductionLots(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['stock-production-lots', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/stock-production-lots', 'Failed to fetch production lots'),
    staleTime: 30_000,
    initialData,
  })
}

export function useQualityChecks(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['quality-checks', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/quality-checks', 'Failed to fetch quality checks'),
    staleTime: 30_000,
    initialData,
  })
}

export function useWarehouse3D(organizationId: bigint, _companyId: bigint, warehouseId: bigint) {
  const orgKey = organizationId.toString()
  const { data: zones3D = [] } = useQuery<QueryRows>({
    queryKey: ['warehouse-3d-zones', orgKey],
    queryFn: () =>
      fetchQueryList('/api/query/warehouse-3d-zones', 'Failed to fetch warehouse 3D zones'),
    staleTime: 30_000,
  })
  const { data: allLocations = [] } = useQuery<QueryRows>({
    queryKey: ['stock-locations', orgKey],
    queryFn: () => fetchQueryList('/api/query/stock-locations', 'Failed to fetch stock locations'),
    staleTime: 30_000,
  })
  const { data: allQuants = [] } = useQuery<QueryRows>({
    queryKey: ['stock-quants', orgKey],
    queryFn: () => fetchQueryList('/api/query/stock-quants', 'Failed to fetch stock quants'),
    staleTime: 30_000,
  })
  const { data: products = [] } = useQuery<QueryRows>({
    queryKey: ['products', orgKey],
    queryFn: () => fetchQueryList('/api/query/products', 'Failed to fetch products'),
    staleTime: 30_000,
  })

  return useMemo(() => {
    if (warehouseId === 0n) {
      return { zones: [], slots: [], items: [] }
    }
    const productById = new Map<string, { name: string; sku: string }>()
    for (const p of products) {
      const id = String(p.id ?? '')
      productById.set(id, {
        name: String(p.name ?? ''),
        sku: String(p.defaultCode ?? ''),
      })
    }
    return buildWarehouse3DView(warehouseId, zones3D, allLocations, allQuants, productById)
  }, [warehouseId, zones3D, allLocations, allQuants, products])
}

// ── Reads: advanced inventory (query API + hooks; use in future tabs or dashboards) ──

export function useStockCycleCounts(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['stock-cycle-counts', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/stock-cycle-counts', 'Failed to fetch cycle counts'),
    staleTime: 30_000,
    initialData,
  })
}

export function useStockInventories(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['stock-inventories', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/stock-inventories', 'Failed to fetch stock inventories'),
    staleTime: 30_000,
    initialData,
  })
}

export function useStockMoves(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['stock-moves', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/stock-moves', 'Failed to fetch stock moves'),
    staleTime: 30_000,
    initialData,
  })
}

export function useStockRoutes(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['stock-routes', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/stock-routes', 'Failed to fetch stock routes'),
    staleTime: 30_000,
    initialData,
  })
}

export function useStockRules(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['stock-rules', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/stock-rules', 'Failed to fetch stock rules'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePickingWaves(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['picking-waves', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/picking-waves', 'Failed to fetch picking waves'),
    staleTime: 30_000,
    initialData,
  })
}

export function useWarehouseTasks(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['warehouse-tasks', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/warehouse-tasks', 'Failed to fetch warehouse tasks'),
    staleTime: 30_000,
    initialData,
  })
}

export function useReplenishmentRules(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['replenishment-rules', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/replenishment-rules', 'Failed to fetch replenishment rules'),
    staleTime: 30_000,
    initialData,
  })
}

export function useBarcodeRules(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['barcode-rules', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/barcode-rules', 'Failed to fetch barcode rules'),
    staleTime: 30_000,
    initialData,
  })
}

export function useInventoryValuations(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['inventory-valuations', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/inventory-valuations', 'Failed to fetch inventory valuations'),
    staleTime: 30_000,
    initialData,
  })
}

export function useStockProductionSerials(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['stock-production-serials', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/stock-production-serials', 'Failed to fetch serial numbers'),
    staleTime: 30_000,
    initialData,
  })
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

export function useUpdateProduct(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { productId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ productId, params }) => {
      const r = await fetch('/api/call/update_product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(productId), params]),
      })
      if (!r.ok) throw new Error('Failed to update product')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteProduct(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (productId) => {
      const r = await fetch('/api/call/delete_product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(productId)]),
      })
      if (!r.ok) throw new Error('Failed to delete product')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateProductVariant(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { productTmplId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ productTmplId, params }) => {
      const r = await fetch('/api/call/create_product_variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(productTmplId), params]),
      })
      if (!r.ok) throw new Error('Failed to create product variant')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateWarehouse(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_warehouse?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([params]),
      })
      if (!r.ok) throw new Error('Failed to create warehouse')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateWarehouse(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { warehouseId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ warehouseId, params }) => {
      const r = await fetch('/api/call/update_warehouse?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(warehouseId), params]),
      })
      if (!r.ok) throw new Error('Failed to update warehouse')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteWarehouse(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (warehouseId) => {
      const r = await fetch('/api/call/delete_warehouse?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(warehouseId)]),
      })
      if (!r.ok) throw new Error('Failed to delete warehouse')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useOrgUsers() {
  return useQuery({
    queryKey: ['org-users'],
    queryFn: async () => {
      const r = await fetch('/api/settings/users?limit=100')
      if (!r.ok) throw new Error('Failed to load users')
      const json = (await r.json()) as { data?: Record<string, unknown>[] }
      return json.data ?? []
    },
    staleTime: 60_000,
  })
}

export function useAssignUserToPicking(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { pickingId: ScalarId; userIdentityHex: string | null }
  >({
    mutationFn: async ({ pickingId, userIdentityHex }) => {
      const r = await fetch('/api/call/assign_user_to_picking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          Number(pickingId),
          {
            company_id: null,
            user_id: userIdentityHex && userIdentityHex.length > 0 ? userIdentityHex : null,
          },
        ]),
      })
      if (!r.ok) throw new Error('Failed to assign user to picking')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
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
      const r = await fetch('/api/call/move_stock_quant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          Number(params.quantId),
          {
            company_id: null,
            dest_location_id: Number(params.targetLocationId),
            quantity: params.quantity,
          },
        ]),
      })
      if (!r.ok) throw new Error('Failed to move stock item')
    },
    onSuccess: () => {
      const orgKey = organizationId.toString()
      void qc.invalidateQueries({ queryKey: ['stock-quants', orgKey] })
      void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] })
    },
  })
}

export function useProcessInventoryAdjustment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (adjustmentId) => {
      const r = await fetch('/api/call/process_inventory_adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(adjustmentId)]),
      })
      if (!r.ok) throw new Error('Failed to process inventory adjustment')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['inventory-adjustments', organizationId.toString()] }),
  })
}

export function useValidateStockPicking(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (pickingId) => {
      const r = await fetch('/api/call/validate_stock_picking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(pickingId), { company_id: null }]),
      })
      if (!r.ok) throw new Error('Failed to validate stock picking')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useReserveStockQuant(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { quantId: ScalarId; reserveQty: number }>({
    mutationFn: async ({ quantId, reserveQty }) => {
      const r = await fetch('/api/call/reserve_stock_quant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          Number(quantId),
          { company_id: null, reserve_qty: reserveQty },
        ]),
      })
      if (!r.ok) throw new Error('Failed to reserve stock')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUnreserveStockQuant(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { quantId: ScalarId; unreserveQty: number }>({
    mutationFn: async ({ quantId, unreserveQty }) => {
      const r = await fetch('/api/call/unreserve_stock_quant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          Number(quantId),
          { company_id: null, unreserve_qty: unreserveQty },
        ]),
      })
      if (!r.ok) throw new Error('Failed to unreserve stock')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateCycleCountPlan(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { locationId: number; params: Record<string, unknown> }
  >({
    mutationFn: async ({ locationId, params }) => {
      const r = await fetch('/api/call/create_cycle_count_plan?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(locationId), params]),
      })
      if (!r.ok) throw new Error('Failed to create cycle count plan')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['stock-cycle-counts', organizationId.toString()] }),
  })
}

export function useStartCycleCountSession(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (cycleCountId) => {
      const r = await fetch('/api/call/start_cycle_count_session?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(cycleCountId)]),
      })
      if (!r.ok) throw new Error('Failed to start cycle count session')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['stock-cycle-counts', organizationId.toString()] }),
  })
}

export function useRecordCycleCountLine(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { cycleCountId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ cycleCountId, params }) => {
      const r = await fetch('/api/call/record_cycle_count_line?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(cycleCountId), params]),
      })
      if (!r.ok) throw new Error('Failed to record cycle count line')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['stock-cycle-counts', organizationId.toString()] }),
  })
}

export function useValidateCycleCount(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (cycleCountId) => {
      const r = await fetch('/api/call/validate_cycle_count?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(cycleCountId)]),
      })
      if (!r.ok) throw new Error('Failed to validate cycle count')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['stock-cycle-counts', organizationId.toString()] }),
  })
}

export function usePostCycleCountAdjustments(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (cycleCountId) => {
      const r = await fetch('/api/call/post_cycle_count_adjustments?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(cycleCountId)]),
      })
      if (!r.ok) throw new Error('Failed to post cycle count adjustments')
    },
    onSuccess: () => {
      const orgKey = organizationId.toString()
      void qc.invalidateQueries({ queryKey: ['stock-cycle-counts', orgKey] })
      void qc.invalidateQueries({ queryKey: ['stock-quants', orgKey] })
    },
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
