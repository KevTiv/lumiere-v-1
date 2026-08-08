"use client"

/**
 * Manufacturing hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Manufacturing module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { manufacturingBffPost } from "@lumiere/stdb/commands"
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  CreateBomParams,
  CreateMrpProductionParams,
  CreateWorkcenterParams,
} from "@lumiere/stdb/types"

function invalidateMrpBomsAndLines(qc: QueryClient, organizationId: bigint) {
  const key = rqBigIntKey(organizationId)
  void qc.invalidateQueries({ queryKey: ['mrp-boms', key] })
  void qc.invalidateQueries({ queryKey: ['mrp-bom-lines', key] })
}

function invalidateMrpProductions(qc: QueryClient, organizationId: bigint) {
  void qc.invalidateQueries({ queryKey: ['mrp-productions', rqBigIntKey(organizationId)] })
}

function invalidateMrpWorkorders(qc: QueryClient, organizationId: bigint) {
  void qc.invalidateQueries({ queryKey: ['mrp-workorders', rqBigIntKey(organizationId)] })
}

function invalidateMrpWorkcenters(qc: QueryClient, organizationId: bigint) {
  void qc.invalidateQueries({ queryKey: ['mrp-workcenters', rqBigIntKey(organizationId)] })
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useMrpProductions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-productions', rqBigIntKey(organizationId)],
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
    queryKey: ['mrp-boms', rqBigIntKey(organizationId)],
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
    queryKey: ['mrp-bom-lines', rqBigIntKey(organizationId)],
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
    queryKey: ['mrp-workorders', rqBigIntKey(organizationId)],
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
    queryKey: ['mrp-workcenters', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/mrp-workcenters', 'Failed to fetch workcenters'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpRoutingWorkcenters(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['mrp-routing-workcenters', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/mrp-routing-workcenters', 'Failed to fetch routing operations'),
    staleTime: 30_000,
    initialData,
  })
}

export function useQualityChecks(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['quality-checks', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/quality-checks', 'Failed to fetch quality checks'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateManufacturingOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateMrpProductionParams>({
    mutationFn: async (params) => {
      const scoped = withCompanyScope(
        params as unknown as Record<string, unknown>,
        companyId,
      ) as CreateMrpProductionParams
      const { urlPath, init } = manufacturingBffPost('create_manufacturing_order', [
        organizationId,
        stdbParamsToJson(scoped, "CreateMrpProductionParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create manufacturing order')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateBom(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateBomParams>({
    mutationFn: async (params) => {
      const scoped = withCompanyScope(
        params as unknown as Record<string, unknown>,
        companyId,
      ) as CreateBomParams
      const { urlPath, init } = manufacturingBffPost('create_bom', [
        organizationId,
        stdbParamsToJson(scoped, "CreateBomParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create BOM')
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useCreateWorkcenter(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateWorkcenterParams>({
    mutationFn: async (params) => {
      const scoped = withCompanyScope(
        params as unknown as Record<string, unknown>,
        companyId,
      ) as CreateWorkcenterParams
      const { urlPath, init } = manufacturingBffPost('create_workcenter', [
        organizationId,
        stdbParamsToJson(scoped, "CreateWorkcenterParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', rqBigIntKey(organizationId)] }),
  })
}

export function useConfirmManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('confirm_manufacturing_order', [
        organizationId,
        companyId,
        productionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to confirm manufacturing order')
    },
    onSuccess: () => {
      invalidateMrpProductions(qc, organizationId)
      invalidateMrpWorkorders(qc, organizationId)
    },
  })
}

export function useStartManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('start_manufacturing_order', [
        organizationId,
        companyId,
        productionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to start manufacturing order')
    },
    onSuccess: () => {
      invalidateMrpProductions(qc, organizationId)
      invalidateMrpWorkorders(qc, organizationId)
    },
  })
}

export function useFinishManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('finish_manufacturing_order', [
        organizationId,
        companyId,
        productionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to finish manufacturing order')
    },
    onSuccess: () => {
      invalidateMrpProductions(qc, organizationId)
      invalidateMrpWorkorders(qc, organizationId)
      // Finishing an MO posts finished-goods stock moves — refresh inventory quants.
      void qc.invalidateQueries({ queryKey: ['stock-quants', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCancelManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('cancel_manufacturing_order', [
        organizationId,
        companyId,
        productionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel manufacturing order')
    },
    onSuccess: () => {
      invalidateMrpProductions(qc, organizationId)
      invalidateMrpWorkorders(qc, organizationId)
    },
  })
}

export function useStartWorkorder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workorderId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('start_workorder', [
        organizationId,
        companyId,
        workorderId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to start workorder')
    },
    onSuccess: () => {
      invalidateMrpWorkorders(qc, organizationId)
      invalidateMrpProductions(qc, organizationId)
    },
  })
}

export function useFinishWorkorder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workorderId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('finish_workorder', [
        organizationId,
        companyId,
        workorderId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to finish workorder')
    },
    onSuccess: () => {
      invalidateMrpWorkorders(qc, organizationId)
      invalidateMrpProductions(qc, organizationId)
      invalidateMrpWorkcenters(qc, organizationId)
    },
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
      const { urlPath, init } = manufacturingBffPost('block_workcenter', [organizationId, workcenterId, reason])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to block workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', rqBigIntKey(organizationId)] }),
  })
}

export function useUnblockWorkcenter(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (workcenterId: string | number | bigint) => {
      const { urlPath, init } = manufacturingBffPost('unblock_workcenter', [organizationId, workcenterId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to unblock workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', rqBigIntKey(organizationId)] }),
  })
}

// ── Additional manufacturing reducers (HTTP bridge) ─────────────────────────

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

export function useCheckMoAvailability(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (moId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('check_mo_availability', [
        organizationId,
        companyId,
        moId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateMrpProductions(qc, organizationId)
      // Availability check may move stock reservations.
      void qc.invalidateQueries({ queryKey: ['stock-quants', rqBigIntKey(organizationId)] })
    },
  })
}

export function useProduceManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ moId, qty }: { moId: string | number | bigint; qty: number }) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('produce_manufacturing_order', [
        organizationId,
        companyId,
        moId,
        qty,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateMrpProductions(qc, organizationId)
      // Producing posts stock moves — refresh quants.
      void qc.invalidateQueries({ queryKey: ['stock-quants', rqBigIntKey(organizationId)] })
    },
  })
}

export function useConsumeMoMaterials(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (moId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('consume_mo_materials', [
        organizationId,
        companyId,
        moId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateMrpProductions(qc, organizationId)
      // Consumption moves material stock — refresh quants.
      void qc.invalidateQueries({ queryKey: ['stock-quants', rqBigIntKey(organizationId)] })
    },
  })
}

/** Params match generated `CreateWorkorderParams` (camelCase JSON). */
export function useCreateWorkorder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = manufacturingBffPost('create_workorder', [organizationId, params])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mrp-workorders', rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({ queryKey: ['mrp-productions', rqBigIntKey(organizationId)] })
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
      const { urlPath, init } = manufacturingBffPost('update_bom', [
        organizationId,
        companyId,
        bomId,
        params,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useDeleteBom(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (bomId: string | number | bigint) => {
      const { urlPath, init } = manufacturingBffPost('delete_bom', [organizationId, companyId, bomId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useComputeBomCost(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (bomId: string | number | bigint) => {
      const { urlPath, init } = manufacturingBffPost('compute_bom_cost', [organizationId, companyId, bomId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useExplodeBom(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (bomId: string | number | bigint) => {
      const { urlPath, init } = manufacturingBffPost('explode_bom', [organizationId, companyId, bomId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useCreateRoutingWorkcenter(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  const orgKey = rqBigIntKey(organizationId)
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = manufacturingBffPost('create_routing_workcenter', [organizationId, companyId, params])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mrp-routing-workcenters', orgKey] })
      void qc.invalidateQueries({ queryKey: ['mrp-workcenters', orgKey] })
    },
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
      const { urlPath, init } = manufacturingBffPost('update_workcenter', [organizationId, workcenterId, scoped])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', rqBigIntKey(organizationId)] }),
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
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('log_workcenter_productivity', [
        organizationId,
        companyId,
        workcenterId,
        params,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateMrpWorkcenters(qc, organizationId)
      // Productivity log targets a workorder — workorder totals may update.
      invalidateMrpWorkorders(qc, organizationId)
    },
  })
}

export function useCompleteProductivityLog(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (logId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = manufacturingBffPost('complete_productivity_log', [organizationId, companyId, logId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateMrpWorkcenters(qc, organizationId)
      invalidateMrpWorkorders(qc, organizationId)
    },
  })
}

export function useImportWorkcenterCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = manufacturingBffPost('import_workcenter_csv', [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', rqBigIntKey(organizationId)] }),
  })
}

export function useImportBomCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = manufacturingBffPost('import_bom_csv', [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useImportBomLineCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = manufacturingBffPost('import_bom_line_csv', [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateMrpBomsAndLines(qc, organizationId),
  })
}

export function useImportManufacturingOrderCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = manufacturingBffPost('import_manufacturing_order_csv', [organizationId, companyId, csvData])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-productions', rqBigIntKey(organizationId)] }),
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
      const { urlPath, init } = manufacturingBffPost('link_device_to_workcenter', [
        organizationId,
        deviceId,
        workcenterId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['iot-devices', rqBigIntKey(organizationId)] })
    },
  })
}

/** All manufacturing `/api/call` mutations for module UI (row actions, CSV). */
export function useManufacturingMutations(organizationId: bigint, companyId: bigint) {
  return {
    createManufacturingOrder: useCreateManufacturingOrder(organizationId, companyId),
    createBom: useCreateBom(organizationId, companyId),
    createWorkcenter: useCreateWorkcenter(organizationId, companyId),
    confirmMo: useConfirmManufacturingOrder(organizationId, companyId),
    startMo: useStartManufacturingOrder(organizationId, companyId),
    finishMo: useFinishManufacturingOrder(organizationId, companyId),
    cancelMo: useCancelManufacturingOrder(organizationId, companyId),
    checkMoAvailability: useCheckMoAvailability(organizationId, companyId),
    produceMo: useProduceManufacturingOrder(organizationId, companyId),
    consumeMoMaterials: useConsumeMoMaterials(organizationId, companyId),
    createWorkorder: useCreateWorkorder(organizationId),
    startWo: useStartWorkorder(organizationId, companyId),
    finishWo: useFinishWorkorder(organizationId, companyId),
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
    createRoutingWorkcenter: useCreateRoutingWorkcenter(organizationId, companyId),
    completeProductivityLog: useCompleteProductivityLog(organizationId, companyId),
  }
}

export type ManufacturingMutations = ReturnType<typeof useManufacturingMutations>
