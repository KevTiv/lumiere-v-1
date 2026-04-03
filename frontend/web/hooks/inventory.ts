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
  void qc.invalidateQueries({ queryKey: ['stock-production-serials', orgKey] })
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

// ── Quality Management ───────────────────────────────────────────────────────

export function useCreateQualityCheck(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_quality_check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create quality check')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateQualityCheck(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { checkId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ checkId, params }) => {
      const r = await fetch('/api/call/update_quality_check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(checkId), params]),
      })
      if (!r.ok) throw new Error('Failed to update quality check')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteQualityCheck(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (checkId) => {
      const r = await fetch('/api/call/delete_quality_check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(checkId)]),
      })
      if (!r.ok) throw new Error('Failed to delete quality check')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function usePassQualityCheck(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (checkId) => {
      const r = await fetch('/api/call/pass_quality_check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(checkId)]),
      })
      if (!r.ok) throw new Error('Failed to pass quality check')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useFailQualityCheck(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { checkId: ScalarId; reason?: string }>({
    mutationFn: async ({ checkId, reason }) => {
      const r = await fetch('/api/call/fail_quality_check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(checkId), reason ?? null]),
      })
      if (!r.ok) throw new Error('Failed to fail quality check')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateQualityAlert(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_quality_alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create quality alert')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateQualityAlert(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { alertId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ alertId, params }) => {
      const r = await fetch('/api/call/update_quality_alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(alertId), params]),
      })
      if (!r.ok) throw new Error('Failed to update quality alert')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteQualityAlert(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (alertId) => {
      const r = await fetch('/api/call/delete_quality_alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(alertId)]),
      })
      if (!r.ok) throw new Error('Failed to delete quality alert')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useAssignQualityAlert(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { alertId: ScalarId; userId: string | null }>({
    mutationFn: async ({ alertId, userId }) => {
      const r = await fetch('/api/call/assign_quality_alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(alertId), userId]),
      })
      if (!r.ok) throw new Error('Failed to assign quality alert')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCancelQualityAlert(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (alertId) => {
      const r = await fetch('/api/call/cancel_quality_alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(alertId)]),
      })
      if (!r.ok) throw new Error('Failed to cancel quality alert')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateQualityPoint(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_quality_point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create quality point')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateQualityPoint(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { pointId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ pointId, params }) => {
      const r = await fetch('/api/call/update_quality_point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(pointId), params]),
      })
      if (!r.ok) throw new Error('Failed to update quality point')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteQualityPoint(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (pointId) => {
      const r = await fetch('/api/call/delete_quality_point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(pointId)]),
      })
      if (!r.ok) throw new Error('Failed to delete quality point')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateQualityTeam(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_quality_team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create quality team')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateQualityTeam(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { teamId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ teamId, params }) => {
      const r = await fetch('/api/call/update_quality_team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(teamId), params]),
      })
      if (!r.ok) throw new Error('Failed to update quality team')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteQualityTeam(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (teamId) => {
      const r = await fetch('/api/call/delete_quality_team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(teamId)]),
      })
      if (!r.ok) throw new Error('Failed to delete quality team')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

// ── Barcode Management ─────────────────────────────────────────────────────────

export function useCreateBarcodeRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_barcode_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create barcode rule')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['barcode-rules', organizationId.toString()] }),
  })
}

export function useUpdateBarcodeRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ruleId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ ruleId, params }) => {
      const r = await fetch('/api/call/update_barcode_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(ruleId), params]),
      })
      if (!r.ok) throw new Error('Failed to update barcode rule')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['barcode-rules', organizationId.toString()] }),
  })
}

export function useDeleteBarcodeRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (ruleId) => {
      const r = await fetch('/api/call/delete_barcode_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(ruleId)]),
      })
      if (!r.ok) throw new Error('Failed to delete barcode rule')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['barcode-rules', organizationId.toString()] }),
  })
}

export function useRecordBarcodeScan(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { barcode: string; context?: Record<string, unknown> }>({
    mutationFn: async ({ barcode, context }) => {
      const r = await fetch('/api/call/record_barcode_scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), barcode, context ?? {}]),
      })
      if (!r.ok) throw new Error('Failed to record barcode scan')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateBarcodeNomenclature(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_barcode_nomenclature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create barcode nomenclature')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateBarcodeNomenclature(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { nomenclatureId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ nomenclatureId, params }) => {
      const r = await fetch('/api/call/update_barcode_nomenclature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(nomenclatureId), params]),
      })
      if (!r.ok) throw new Error('Failed to update barcode nomenclature')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteBarcodeNomenclature(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (nomenclatureId) => {
      const r = await fetch('/api/call/delete_barcode_nomenclature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(nomenclatureId)]),
      })
      if (!r.ok) throw new Error('Failed to delete barcode nomenclature')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useAddRuleToNomenclature(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { nomenclatureId: ScalarId; ruleId: ScalarId }>({
    mutationFn: async ({ nomenclatureId, ruleId }) => {
      const r = await fetch('/api/call/add_rule_to_nomenclature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(nomenclatureId), Number(ruleId)]),
      })
      if (!r.ok) throw new Error('Failed to add rule to nomenclature')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

// ── UOM Management ─────────────────────────────────────────────────────────────

export function useCreateUomCategory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_uom_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create UOM category')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uoms', organizationId.toString()] }),
  })
}

export function useCreateUom(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_uom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create UOM')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uoms', organizationId.toString()] }),
  })
}

export function useUpdateUom(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { uomId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ uomId, params }) => {
      const r = await fetch('/api/call/update_uom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(uomId), params]),
      })
      if (!r.ok) throw new Error('Failed to update UOM')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uoms', organizationId.toString()] }),
  })
}

export function useDeleteUom(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (uomId) => {
      const r = await fetch('/api/call/delete_uom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(uomId)]),
      })
      if (!r.ok) throw new Error('Failed to delete UOM')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uoms', organizationId.toString()] }),
  })
}

export function useCreateUomConversion(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_uom_conversion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create UOM conversion')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uoms', organizationId.toString()] }),
  })
}

// ── Replenishment ────────────────────────────────────────────────────────────

export function useCreateReplenishmentRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_replenishment_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create replenishment rule')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['replenishment-rules', organizationId.toString()] }),
  })
}

export function useUpdateReplenishmentRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ruleId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ ruleId, params }) => {
      const r = await fetch('/api/call/update_replenishment_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(ruleId), params]),
      })
      if (!r.ok) throw new Error('Failed to update replenishment rule')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['replenishment-rules', organizationId.toString()] }),
  })
}

export function useDeleteReplenishmentRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (ruleId) => {
      const r = await fetch('/api/call/delete_replenishment_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(ruleId)]),
      })
      if (!r.ok) throw new Error('Failed to delete replenishment rule')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['replenishment-rules', organizationId.toString()] }),
  })
}

export function useTriggerReplenishment(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { productId?: ScalarId; locationId?: ScalarId; warehouseId?: ScalarId }>({
    mutationFn: async ({ productId, locationId, warehouseId }) => {
      const r = await fetch('/api/call/trigger_replenishment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), productId ? Number(productId) : null, locationId ? Number(locationId) : null, warehouseId ? Number(warehouseId) : null]),
      })
      if (!r.ok) throw new Error('Failed to trigger replenishment')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['replenishment-rules', organizationId.toString()] })
      qc.invalidateQueries({ queryKey: ['stock-quants', organizationId.toString()] })
    },
  })
}

// ── Picking Wave ─────────────────────────────────────────────────────────────

export function useCreatePickingWave(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_picking_wave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create picking wave')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-waves', organizationId.toString()] }),
  })
}

export function useUpdatePickingWave(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { waveId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ waveId, params }) => {
      const r = await fetch('/api/call/update_picking_wave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(waveId), params]),
      })
      if (!r.ok) throw new Error('Failed to update picking wave')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-waves', organizationId.toString()] }),
  })
}

export function useDeletePickingWave(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (waveId) => {
      const r = await fetch('/api/call/delete_picking_wave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(waveId)]),
      })
      if (!r.ok) throw new Error('Failed to delete picking wave')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-waves', organizationId.toString()] }),
  })
}

export function useConfirmPickingWave(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (waveId) => {
      const r = await fetch('/api/call/confirm_picking_wave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(waveId)]),
      })
      if (!r.ok) throw new Error('Failed to confirm picking wave')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-waves', organizationId.toString()] }),
  })
}

export function useProcessPickingWave(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (waveId) => {
      const r = await fetch('/api/call/process_picking_wave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(waveId)]),
      })
      if (!r.ok) throw new Error('Failed to process picking wave')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picking-waves', organizationId.toString()] }),
  })
}

export function useCompletePickingWave(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (waveId) => {
      const r = await fetch('/api/call/complete_picking_wave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(waveId)]),
      })
      if (!r.ok) throw new Error('Failed to complete picking wave')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

// ── Stock Inventory Operations ─────────────────────────────────────────────────

export function useConfirmStockInventory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (inventoryId) => {
      const r = await fetch('/api/call/confirm_stock_inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(inventoryId)]),
      })
      if (!r.ok) throw new Error('Failed to confirm stock inventory')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useStartStockInventory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (inventoryId) => {
      const r = await fetch('/api/call/start_stock_inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(inventoryId)]),
      })
      if (!r.ok) throw new Error('Failed to start stock inventory')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useValidateStockInventory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (inventoryId) => {
      const r = await fetch('/api/call/validate_stock_inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(inventoryId)]),
      })
      if (!r.ok) throw new Error('Failed to validate stock inventory')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCancelStockInventory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (inventoryId) => {
      const r = await fetch('/api/call/cancel_stock_inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(inventoryId)]),
      })
      if (!r.ok) throw new Error('Failed to cancel stock inventory')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

// ── Product Category ───────────────────────────────────────────────────────────

export function useCreateProductCategory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_product_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create product category')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories', organizationId.toString()] }),
  })
}

export function useUpdateProductCategory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { categoryId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ categoryId, params }) => {
      const r = await fetch('/api/call/update_product_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(categoryId), params]),
      })
      if (!r.ok) throw new Error('Failed to update product category')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories', organizationId.toString()] }),
  })
}

export function useDeleteProductCategory(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (categoryId) => {
      const r = await fetch('/api/call/delete_product_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(categoryId)]),
      })
      if (!r.ok) throw new Error('Failed to delete product category')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories', organizationId.toString()] }),
  })
}

// ── Stock Routes & Rules ────────────────────────────────────────────────────

export function useCreateStockRoute(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_stock_route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create stock route')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-routes', organizationId.toString()] }),
  })
}

export function useUpdateStockRoute(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { routeId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ routeId, params }) => {
      const r = await fetch('/api/call/update_stock_route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(routeId), params]),
      })
      if (!r.ok) throw new Error('Failed to update stock route')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-routes', organizationId.toString()] }),
  })
}

export function useDeleteStockRoute(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (routeId) => {
      const r = await fetch('/api/call/delete_stock_route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(routeId)]),
      })
      if (!r.ok) throw new Error('Failed to delete stock route')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-routes', organizationId.toString()] }),
  })
}

export function useCreateStockRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_stock_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create stock rule')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-rules', organizationId.toString()] }),
  })
}

export function useUpdateStockRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ruleId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ ruleId, params }) => {
      const r = await fetch('/api/call/update_stock_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(ruleId), params]),
      })
      if (!r.ok) throw new Error('Failed to update stock rule')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-rules', organizationId.toString()] }),
  })
}

export function useDeleteStockRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (ruleId) => {
      const r = await fetch('/api/call/delete_stock_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(ruleId)]),
      })
      if (!r.ok) throw new Error('Failed to delete stock rule')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-rules', organizationId.toString()] }),
  })
}

// ── Warehouse Tasks ────────────────────────────────────────────────────────────

export function useCreateWarehouseTask(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_warehouse_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create warehouse task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-tasks', organizationId.toString()] }),
  })
}

export function useUpdateWarehouseTask(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { taskId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ taskId, params }) => {
      const r = await fetch('/api/call/update_warehouse_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(taskId), params]),
      })
      if (!r.ok) throw new Error('Failed to update warehouse task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-tasks', organizationId.toString()] }),
  })
}

export function useDeleteWarehouseTask(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (taskId) => {
      const r = await fetch('/api/call/delete_warehouse_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(taskId)]),
      })
      if (!r.ok) throw new Error('Failed to delete warehouse task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-tasks', organizationId.toString()] }),
  })
}

export function useStartWarehouseTask(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (taskId) => {
      const r = await fetch('/api/call/start_warehouse_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(taskId)]),
      })
      if (!r.ok) throw new Error('Failed to start warehouse task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-tasks', organizationId.toString()] }),
  })
}

export function useCompleteWarehouseTask(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { taskId: ScalarId; result?: Record<string, unknown> }>({
    mutationFn: async ({ taskId, result }) => {
      const r = await fetch('/api/call/complete_warehouse_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(taskId), result ?? {}]),
      })
      if (!r.ok) throw new Error('Failed to complete warehouse task')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCancelWarehouseTask(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (taskId) => {
      const r = await fetch('/api/call/cancel_warehouse_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(taskId)]),
      })
      if (!r.ok) throw new Error('Failed to cancel warehouse task')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-tasks', organizationId.toString()] }),
  })
}

// ── Product Operations ───────────────────────────────────────────────────────

export function useUpdateProductVariant(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { variantId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ variantId, params }) => {
      const r = await fetch('/api/call/update_product_variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(variantId), params]),
      })
      if (!r.ok) throw new Error('Failed to update product variant')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateProductInventoryData(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { productId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ productId, params }) => {
      const r = await fetch('/api/call/update_product_inventory_data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(productId), params]),
      })
      if (!r.ok) throw new Error('Failed to update product inventory data')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateProductPricing(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { productId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ productId, params }) => {
      const r = await fetch('/api/call/update_product_pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(productId), params]),
      })
      if (!r.ok) throw new Error('Failed to update product pricing')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', organizationId.toString()] }),
  })
}

// ── Reducer coverage: inventory mission (quality, quants, lots/serials, 3D, product extensions, etc.) ──

export function useStartQualityCheck(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (checkId) => {
      const r = await fetch('/api/call/start_quality_check?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(checkId)]),
      })
      if (!r.ok) throw new Error('Failed to start quality check')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useOpenQualityAlert(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (alertId) => {
      const r = await fetch('/api/call/open_quality_alert?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(alertId)]),
      })
      if (!r.ok) throw new Error('Failed to open quality alert')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useSolveQualityAlert(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { alertId: ScalarId; description?: string | null }>({
    mutationFn: async ({ alertId, description }) => {
      const r = await fetch('/api/call/solve_quality_alert?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(alertId), description ?? null]),
      })
      if (!r.ok) throw new Error('Failed to solve quality alert')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateQualityAlertReason(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { name: string; description?: string | null; metadata?: string | null }>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_quality_alert_reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          {
            name: params.name,
            description: params.description ?? null,
            metadata: params.metadata ?? null,
          },
        ]),
      })
      if (!r.ok) throw new Error('Failed to create quality alert reason')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateQualityAlertReason(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      reasonId: ScalarId
      params: { name?: string | null; description?: string | null; is_active?: boolean | null }
    }
  >({
    mutationFn: async ({ reasonId, params }) => {
      const r = await fetch('/api/call/update_quality_alert_reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(reasonId), params]),
      })
      if (!r.ok) throw new Error('Failed to update quality alert reason')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteQualityAlertReason(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (reasonId) => {
      const r = await fetch('/api/call/delete_quality_alert_reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(reasonId)]),
      })
      if (!r.ok) throw new Error('Failed to delete quality alert reason')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useAddMemberToQualityTeam(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { teamId: ScalarId; memberIdentityHex: string }>({
    mutationFn: async ({ teamId, memberIdentityHex }) => {
      const r = await fetch('/api/call/add_member_to_quality_team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(teamId), memberIdentityHex]),
      })
      if (!r.ok) throw new Error('Failed to add team member')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useRemoveMemberFromQualityTeam(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { teamId: ScalarId; memberIdentityHex: string }>({
    mutationFn: async ({ teamId, memberIdentityHex }) => {
      const r = await fetch('/api/call/remove_member_from_quality_team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(teamId), memberIdentityHex]),
      })
      if (!r.ok) throw new Error('Failed to remove team member')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

/** Stamps rule last_run / next_run (differs from trigger_replenishment which evaluates stock). */
export function useExecuteReplenishmentRule(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (ruleId) => {
      const r = await fetch('/api/call/execute_replenishment_rule?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(ruleId)]),
      })
      if (!r.ok) throw new Error('Failed to execute replenishment rule')
    },
    onSuccess: () => {
      const orgKey = organizationId.toString()
      void qc.invalidateQueries({ queryKey: ['replenishment-rules', orgKey] })
      void qc.invalidateQueries({ queryKey: ['stock-quants', orgKey] })
    },
  })
}

export function useCreateStockQuant(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_stock_quant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create stock quant')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateStockQuantQuantity(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { quantId: ScalarId; quantity: number }>({
    mutationFn: async ({ quantId, quantity }) => {
      const r = await fetch('/api/call/update_stock_quant_quantity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          Number(quantId),
          { company_id: null, quantity },
        ]),
      })
      if (!r.ok) throw new Error('Failed to update quant quantity')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateStockProductionLot(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { lotId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ lotId, params }) => {
      const r = await fetch('/api/call/update_stock_production_lot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(lotId), params]),
      })
      if (!r.ok) throw new Error('Failed to update lot')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteStockProductionLot(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (lotId) => {
      const r = await fetch('/api/call/delete_stock_production_lot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(lotId)]),
      })
      if (!r.ok) throw new Error('Failed to delete lot')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useUpdateStockProductionSerial(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { serialId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ serialId, params }) => {
      const r = await fetch('/api/call/update_stock_production_serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(serialId), params]),
      })
      if (!r.ok) throw new Error('Failed to update serial')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useDeleteStockProductionSerial(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (serialId) => {
      const r = await fetch('/api/call/delete_stock_production_serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(serialId)]),
      })
      if (!r.ok) throw new Error('Failed to delete serial')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateWarehouse3dZone(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { warehouseId: ScalarId; locationId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ warehouseId, locationId, params }) => {
      const r = await fetch('/api/call/create_warehouse_3d_zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(warehouseId), Number(locationId), params]),
      })
      if (!r.ok) throw new Error('Failed to create 3D zone')
    },
    onSuccess: () => {
      const orgKey = organizationId.toString()
      void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] })
      void qc.invalidateQueries({ queryKey: ['stock-locations', orgKey] })
    },
  })
}

export function useUpdateWarehouse3dZone(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { zoneId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ zoneId, params }) => {
      const r = await fetch('/api/call/update_warehouse_3d_zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(zoneId), params]),
      })
      if (!r.ok) throw new Error('Failed to update 3D zone')
    },
    onSuccess: () => {
      const orgKey = organizationId.toString()
      void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] })
    },
  })
}

export function useDeleteWarehouse3dZone(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (zoneId) => {
      const r = await fetch('/api/call/delete_warehouse_3d_zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(zoneId)]),
      })
      if (!r.ok) throw new Error('Failed to delete 3D zone')
    },
    onSuccess: () => {
      const orgKey = organizationId.toString()
      void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] })
    },
  })
}

export function useUpdateWarehouseTaskStatus(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { taskId: ScalarId; newStatus: string }>({
    mutationFn: async ({ taskId, newStatus }) => {
      const r = await fetch('/api/call/update_warehouse_task_status?withCompany=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([Number(taskId), newStatus]),
      })
      if (!r.ok) throw new Error('Failed to update task status')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-tasks', organizationId.toString()] }),
  })
}

export function useLinkDeviceToQualityCheck(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { deviceId: ScalarId; checkId: ScalarId }>({
    mutationFn: async ({ deviceId, checkId }) => {
      const r = await fetch('/api/call/link_device_to_quality_check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(deviceId), Number(checkId)]),
      })
      if (!r.ok) throw new Error('Failed to link device to quality check')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

export function useCreateProductSupplierInfo(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_product_supplier_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create supplier info')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', organizationId.toString()] }),
  })
}

export function useUpdateProductSupplierInfo(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { supplierInfoId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ supplierInfoId, params }) => {
      const r = await fetch('/api/call/update_product_supplier_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(supplierInfoId), params]),
      })
      if (!r.ok) throw new Error('Failed to update supplier info')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', organizationId.toString()] }),
  })
}

export function useCreateProductPackaging(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { productId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ productId, params }) => {
      const r = await fetch('/api/call/create_product_packaging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(productId), params]),
      })
      if (!r.ok) throw new Error('Failed to create packaging')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', organizationId.toString()] }),
  })
}

export function useUpdateProductPackaging(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { packagingId: ScalarId; params: Record<string, unknown> }>({
    mutationFn: async ({ packagingId, params }) => {
      const r = await fetch('/api/call/update_product_packaging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(packagingId), params]),
      })
      if (!r.ok) throw new Error('Failed to update packaging')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', organizationId.toString()] }),
  })
}

export function useRestoreProductCategory(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (categoryId) => {
      const r = await fetch('/api/call/restore_product_category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(categoryId)]),
      })
      if (!r.ok) throw new Error('Failed to restore category')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories', organizationId.toString()] }),
  })
}

export function useUpsertWarehouseGeo(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      warehouseId: ScalarId
      latitude: number
      longitude: number
      address?: string | null
      city?: string | null
      countryCode?: string | null
      managerName?: string | null
    }
  >({
    mutationFn: async (p) => {
      const r = await fetch('/api/call/upsert_warehouse_geo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          Number(p.warehouseId),
          p.latitude,
          p.longitude,
          p.address ?? null,
          p.city ?? null,
          p.countryCode ?? null,
          p.managerName ?? null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to save warehouse geo')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}

/** Integration / admin: Meta WhatsApp quality score — no inventory tab UI. */
export function useUpdateWhatsappQualityScore(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { accountId: ScalarId; qualityScore: string }>({
    mutationFn: async ({ accountId, qualityScore }) => {
      const r = await fetch('/api/call/update_whatsapp_quality_score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(accountId), qualityScore]),
      })
      if (!r.ok) throw new Error('Failed to update WhatsApp quality score')
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  })
}
