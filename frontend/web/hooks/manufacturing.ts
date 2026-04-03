/**
 * Manufacturing hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Manufacturing module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'
import { withCompanyScope } from '@/lib/org-scoped'

function invalidateMrpBomsAndLines(qc: QueryClient, organizationId: bigint) {
  const key = organizationId.toString()
  void qc.invalidateQueries({ queryKey: ['mrp-boms', key] })
  void qc.invalidateQueries({ queryKey: ['mrp-bom-lines', key] })
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useMrpProductions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-productions', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/mrp-productions', 'Failed to fetch manufacturing orders'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpBoms(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-boms', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/mrp-boms', 'Failed to fetch BOMs'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpBomLines(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-bom-lines', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/mrp-bom-lines', 'Failed to fetch BOM lines'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpWorkorders(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-workorders', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/mrp-workorders', 'Failed to fetch workorders'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpWorkcenters(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-workcenters', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/mrp-workcenters', 'Failed to fetch workcenters'),
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

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateManufacturingOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useCreateBom(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create BOM')
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useCreateWorkcenter(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_workcenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}

export function useConfirmManufacturingOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      const r = await fetch('/api/call/confirm_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), productionId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to confirm manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useStartManufacturingOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      const r = await fetch('/api/call/start_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), productionId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to start manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useFinishManufacturingOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      const r = await fetch('/api/call/finish_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), productionId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to finish manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useCancelManufacturingOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      const r = await fetch('/api/call/cancel_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), productionId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to cancel manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useStartWorkorder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workorderId: string | number | bigint) => {
      const r = await fetch('/api/call/start_workorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workorderId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to start workorder')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workorders', organizationId.toString()] }),
  })
}

export function useFinishWorkorder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workorderId: string | number | bigint) => {
      const r = await fetch('/api/call/finish_workorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workorderId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to finish workorder')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workorders', organizationId.toString()] }),
  })
}

export function useBlockWorkcenter(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workcenterId,
      reason,
    }: {
      workcenterId: string | number | bigint
      reason: string
    }) => {
      const r = await fetch('/api/call/block_workcenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workcenterId.toString(), reason]),
      })
      if (!r.ok) throw new Error('Failed to block workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}

export function useUnblockWorkcenter(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workcenterId: string | number | bigint) => {
      const r = await fetch('/api/call/unblock_workcenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workcenterId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to unblock workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}

// ── Additional manufacturing reducers (HTTP bridge) ─────────────────────────

async function parseCallError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string }
    return j.error ?? r.statusText
  } catch {
    return r.statusText
  }
}

export function useCheckMoAvailability(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (moId: string | number | bigint) => {
      const r = await fetch('/api/call/check_mo_availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), moId.toString()]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useProduceManufacturingOrder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ moId, qty }: { moId: string | number | bigint; qty: number }) => {
      const r = await fetch('/api/call/produce_manufacturing_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), moId.toString(), qty]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

export function useConsumeMoMaterials(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (moId: string | number | bigint) => {
      const r = await fetch('/api/call/consume_mo_materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), moId.toString()]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

/** Params match generated `CreateWorkorderParams` (camelCase JSON). */
export function useCreateWorkorder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_workorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mrp-workorders', organizationId.toString()] })
      void qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] })
    },
  })
}

export function useUpdateBom(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      bomId,
      params,
    }: {
      bomId: string | number | bigint
      params: Record<string, unknown>
    }) => {
      const r = await fetch('/api/call/update_bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          companyId.toString(),
          bomId.toString(),
          params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useDeleteBom(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (bomId: string | number | bigint) => {
      const r = await fetch('/api/call/delete_bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), bomId.toString()]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useComputeBomCost(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (bomId: string | number | bigint) => {
      const r = await fetch('/api/call/compute_bom_cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), bomId.toString()]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useExplodeBom(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (bomId: string | number | bigint) => {
      const r = await fetch('/api/call/explode_bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), bomId.toString()]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useCreateRoutingWorkcenter(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_routing_workcenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), params]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useUpdateWorkcenter(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workcenterId,
      params,
    }: {
      workcenterId: string | number | bigint
      params: Record<string, unknown>
    }) => {
      const scoped = withCompanyScope(params, companyId)
      const r = await fetch('/api/call/update_workcenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), workcenterId.toString(), scoped]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}

export function useLogWorkcenterProductivity(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workcenterId,
      params,
    }: {
      workcenterId: string | number | bigint
      params: Record<string, unknown>
    }) => {
      const r = await fetch('/api/call/log_workcenter_productivity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          companyId.toString(),
          workcenterId.toString(),
          params,
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}

export function useCompleteProductivityLog(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (logId: string | number | bigint) => {
      const r = await fetch('/api/call/complete_productivity_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), logId.toString()]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}

export function useImportWorkcenterCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await fetch('/api/call/import_workcenter_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', organizationId.toString()] }),
  })
}

export function useImportBomCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await fetch('/api/call/import_bom_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useImportBomLineCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await fetch('/api/call/import_bom_line_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useImportManufacturingOrderCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const r = await fetch('/api/call/import_manufacturing_order_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), companyId.toString(), csvData]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', organizationId.toString()] }),
  })
}

/** Links an IoT device to an MRP work center. Reducer is scoped by `organization_id` only (no company arg). */
export function useLinkDeviceToWorkcenter(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      deviceId,
      workcenterId,
    }: {
      deviceId: string | number | bigint
      workcenterId: string | number | bigint
    }) => {
      const r = await fetch('/api/call/link_device_to_workcenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          deviceId.toString(),
          workcenterId.toString(),
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['iot-devices', organizationId.toString()] })
    },
  })
}

/** All manufacturing `/api/call` mutations for module UI (row actions, CSV). */
export function useManufacturingMutations(organizationId: bigint, companyId: bigint) {
  return {
    createManufacturingOrder: useCreateManufacturingOrder(organizationId, companyId),
    createBom: useCreateBom(organizationId, companyId),
    createWorkcenter: useCreateWorkcenter(organizationId, companyId),
    confirmMo: useConfirmManufacturingOrder(organizationId),
    startMo: useStartManufacturingOrder(organizationId),
    finishMo: useFinishManufacturingOrder(organizationId),
    cancelMo: useCancelManufacturingOrder(organizationId),
    checkMoAvailability: useCheckMoAvailability(organizationId),
    produceMo: useProduceManufacturingOrder(organizationId),
    consumeMoMaterials: useConsumeMoMaterials(organizationId),
    createWorkorder: useCreateWorkorder(organizationId),
    startWo: useStartWorkorder(organizationId),
    finishWo: useFinishWorkorder(organizationId),
    blockWc: useBlockWorkcenter(organizationId),
    unblockWc: useUnblockWorkcenter(organizationId),
    updateBom: useUpdateBom(organizationId, companyId),
    deleteBom: useDeleteBom(organizationId, companyId),
    computeBomCost: useComputeBomCost(organizationId, companyId),
    explodeBom: useExplodeBom(organizationId, companyId),
    updateWorkcenter: useUpdateWorkcenter(organizationId, companyId),
    logProductivity: useLogWorkcenterProductivity(organizationId, companyId),
    importWorkcenterCsv: useImportWorkcenterCsv(organizationId, companyId),
    importBomCsv: useImportBomCsv(organizationId, companyId),
    importBomLineCsv: useImportBomLineCsv(organizationId, companyId),
    importMoCsv: useImportManufacturingOrderCsv(organizationId, companyId),
    linkDeviceToWorkcenter: useLinkDeviceToWorkcenter(organizationId),
  }
}

export type ManufacturingMutations = ReturnType<typeof useManufacturingMutations>
