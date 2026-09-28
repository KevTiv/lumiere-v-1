"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { scalarToU64, type ScalarId } from '@lumiere/erp-shared/u64'

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import { dispatchNamedOperation } from '../operation-dispatch'
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { useConfirmManufacturingOrder } from "./manufacturing-order-confirmation"
import { useConsumeMoMaterials, useStartManufacturingOrder } from "./manufacturing-material-consumption"
import { useFinishManufacturingOrder, useProduceManufacturingOrder } from "./manufacturing-production-close"
import { useFinishWorkorder, useLogWorkcenterProductivity, useStartWorkorder } from "./manufacturing-workorder-execution"
import { resolveBomByproductEffect, resolveManufacturingScrapEffect, resolveWorkorderQualityEffect } from './partial-slice-effects'
import { executeOperationWithCanonicalReadback, requireResolvedOperationEffect, type ResolvedOperationEffectOutcome } from './operation-effect'
import type {
  CreateBomParams,
  CreateMrpProductionParams,
  CreateWorkcenterParams,
  CreateWorkorderParams,
  MrpBom,
  MrpBomLine,
  MrpProduction,
  MrpRoutingWorkcenter,
  MrpWorkcenter,
  MrpWorkorder,
  QualityCheck,
  CreateBomByproductParams,
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

async function readRows(resource: string): Promise<Record<string, unknown>[]> {
  return fetchQueryList(`/api/query/${resource}`, `Failed to read ${resource}`);
}

async function refreshManufacturingEffects(
  qc: QueryClient,
  organizationId: bigint,
) {
  const key = rqBigIntKey(organizationId);
  await Promise.all(
    [
      'quality-checks',
      'mrp-workorders',
      'mrp-boms',
      'mrp-bom-byproducts',
      'mrp-productions',
      'stock-moves',
      'stock-quants',
    ].map((resource) => qc.invalidateQueries({ queryKey: [resource, key] })),
  );
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useMrpProductions(
  organizationId: bigint,
  initialData?: MrpProduction[],
) {
  return useQuery<MrpProduction[]>({
    queryKey: ['mrp-productions', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/mrp-productions', 'Failed to fetch manufacturing orders'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpBoms(
  organizationId: bigint,
  initialData?: MrpBom[],
) {
  return useQuery<MrpBom[]>({
    queryKey: ['mrp-boms', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/mrp-boms', 'Failed to fetch BOMs'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpBomLines(
  organizationId: bigint,
  initialData?: MrpBomLine[],
) {
  return useQuery<MrpBomLine[]>({
    queryKey: ['mrp-bom-lines', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/mrp-bom-lines', 'Failed to fetch BOM lines'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpWorkorders(
  organizationId: bigint,
  initialData?: MrpWorkorder[],
) {
  return useQuery<MrpWorkorder[]>({
    queryKey: ['mrp-workorders', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/mrp-workorders', 'Failed to fetch workorders'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpWorkcenters(
  organizationId: bigint,
  initialData?: MrpWorkcenter[],
) {
  return useQuery<MrpWorkcenter[]>({
    queryKey: ['mrp-workcenters', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/mrp-workcenters', 'Failed to fetch workcenters'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpRoutingWorkcenters(
  organizationId: bigint,
  initialData?: MrpRoutingWorkcenter[],
) {
  return useQuery<MrpRoutingWorkcenter[]>({
    queryKey: ['mrp-routing-workcenters', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/mrp-routing-workcenters', 'Failed to fetch routing operations'),
    staleTime: 30_000,
    initialData,
  })
}

export function useQualityChecks(
  organizationId: bigint,
  initialData?: QualityCheck[],
) {
  return useQuery<QualityCheck[]>({
    queryKey: ['quality-checks', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/quality-checks', 'Failed to fetch quality checks'),
    staleTime: 30_000,
    initialData,
  })
}

export function useMrpBomByproducts(organizationId: bigint) {
  return useQuery<Record<string, unknown>[]>({
    queryKey: ['mrp-bom-byproducts', rqBigIntKey(organizationId)],
    queryFn: () => readRows('mrp-bom-byproducts'),
    staleTime: 30_000,
  });
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
      const { urlPath, init } = stdbBffCommandPost("create_manufacturing_order", { params: stdbParamsToJson(scoped, "CreateMrpProductionParams") })
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
      const { urlPath, init } = stdbBffCommandPost("create_bom", { params: stdbParamsToJson(scoped, "CreateBomParams") })
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
      const { urlPath, init } = stdbBffCommandPost("create_workcenter", { params: stdbParamsToJson(scoped, "CreateWorkcenterParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create workcenter')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', rqBigIntKey(organizationId)] }),
  })
}

export function useCancelManufacturingOrder(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productionId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = stdbBffCommandPost("cancel_manufacturing_order", { companyId: companyId, moId: productionId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel manufacturing order')
    },
    onSuccess: () => {
      invalidateMrpProductions(qc, organizationId)
      invalidateMrpWorkorders(qc, organizationId)
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
      const { urlPath, init } = stdbBffCommandPost("block_workcenter", { workcenterId: workcenterId, reason: reason })
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
      const { urlPath, init } = stdbBffCommandPost("unblock_workcenter", { workcenterId: workcenterId })
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
      const { urlPath, init } = stdbBffCommandPost("check_mo_availability", { companyId: companyId, moId: moId })
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

export function useCreateWorkorder(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateWorkorderParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_workorder", {
        params: stdbParamsToJson(params, "CreateWorkorderParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mrp-workorders', rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({ queryKey: ['mrp-productions', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreateWorkorderQualityCheck(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workorderId: rawId,
      name,
    }: {
      workorderId: ScalarId;
      name: string;
    }) => {
      if (companyId <= 0n) throw new Error('Active company required');
      const workorderId = scalarToU64(rawId);
      const checkName = name.trim();
      if (!checkName) throw new Error('Quality check name is required');
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveWorkorderQualityEffect(
            await readRows('quality-checks'),
            organizationId,
            companyId,
            workorderId,
            'none',
          ),
        dispatch: async () => {
          return dispatchNamedOperation(
            'create_workorder_quality_check',
            {
              companyId,
              workorderId,
              name: checkName,
            },
            'Failed to create workorder quality check',
          );
        },
        afterDispatch: () => refreshManufacturingEffects(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      });
      return requireResolvedOperationEffect(outcome);
    },
  });
}

export function usePassWorkorderQualityCheck(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      checkId: rawCheckId,
      workorderId: rawWorkorderId,
      note,
    }: {
      checkId: ScalarId;
      workorderId: ScalarId;
      note?: string | null;
    }) => {
      if (companyId <= 0n) throw new Error('Active company required');
      const checkId = scalarToU64(rawCheckId);
      const workorderId = scalarToU64(rawWorkorderId);
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveWorkorderQualityEffect(
            await readRows('quality-checks'),
            organizationId,
            companyId,
            workorderId,
            'pass',
          ),
        dispatch: async () => {
          return dispatchNamedOperation(
            'pass_quality_check',
            {
              companyId,
              checkId,
              measure: null,
              note: note?.trim() || null,
              picture: null,
            },
            'Failed to pass workorder quality check',
          );
        },
        afterDispatch: () => refreshManufacturingEffects(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      });
      return requireResolvedOperationEffect(outcome);
    },
  });
}

export function useFailWorkorderQualityCheck(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      checkId: rawCheckId,
      workorderId: rawWorkorderId,
      note,
    }: {
      checkId: ScalarId;
      workorderId: ScalarId;
      note: string;
    }) => {
      if (companyId <= 0n) throw new Error('Active company required');
      const checkId = scalarToU64(rawCheckId);
      const workorderId = scalarToU64(rawWorkorderId);
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveWorkorderQualityEffect(
            await readRows('quality-checks'),
            organizationId,
            companyId,
            workorderId,
            'fail',
          ),
        dispatch: async () => {
          return dispatchNamedOperation(
            'fail_workorder_quality_check',
            {
              companyId,
              checkId,
              note: note.trim(),
            },
            'Failed to fail workorder quality check',
          );
        },
        afterDispatch: () => refreshManufacturingEffects(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      });
      return requireResolvedOperationEffect(outcome);
    },
  });
}

export function useScrapFinishedManufacturingOutput(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      moId: rawMoId,
      scrapLocationId: rawLocationId,
      quantity,
      requestId,
    }: {
      moId: ScalarId;
      scrapLocationId: ScalarId;
      quantity: number;
      requestId: string;
    }) => {
      if (companyId <= 0n) throw new Error('Active company required');
      const moId = scalarToU64(rawMoId);
      const scrapLocationId = scalarToU64(rawLocationId);
      const key = requestId.trim();
      if (!key) throw new Error('Scrap request id is required');
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Scrap quantity must be greater than 0');
      }
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveManufacturingScrapEffect(
            await readRows('stock-moves'),
            organizationId,
            companyId,
            moId,
            key,
          ),
        dispatch: async () => {
          return dispatchNamedOperation(
            'scrap_finished_manufacturing_output',
            {
              companyId,
              moId,
              scrapLocationId,
              quantity,
              requestId: key,
            },
            'Failed to scrap finished manufacturing output',
          );
        },
        afterDispatch: () => refreshManufacturingEffects(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      });
      return requireResolvedOperationEffect(outcome);
    },
  });
}

export function useCreateBomByproduct(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    ResolvedOperationEffectOutcome,
    Error,
    { bomId: ScalarId; params: CreateBomByproductParams }
  >({
    mutationFn: async ({ bomId: rawBomId, params }) => {
      if (companyId <= 0n) throw new Error('Active company required');
      const bomId = scalarToU64(rawBomId);
      const productId = scalarToU64(params.productId);
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveBomByproductEffect(
            await readRows('mrp-bom-byproducts'),
            organizationId,
            companyId,
            bomId,
            productId,
          ),
        dispatch: async () => {
          return dispatchNamedOperation(
            'create_bom_byproduct',
            {
              bomId,
              params: stdbParamsToJson(params, 'CreateBomByproductParams'),
            },
            'Failed to create BOM byproduct',
          );
        },
        afterDispatch: () => refreshManufacturingEffects(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      });
      return requireResolvedOperationEffect(outcome);
    },
  });
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
      const { urlPath, init } = stdbBffCommandPost("update_bom", { bomId: bomId, params: params })
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
      const { urlPath, init } = stdbBffCommandPost("delete_bom", { bomId: bomId })
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
      const { urlPath, init } = stdbBffCommandPost("compute_bom_cost", { bomId: bomId })
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
      const { urlPath, init } = stdbBffCommandPost("explode_bom", { bomId: bomId })
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
      const { urlPath, init } = stdbBffCommandPost("create_routing_workcenter", { params: params })
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
      const { urlPath, init } = stdbBffCommandPost("update_workcenter", { workcenterId: workcenterId, params: scoped })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['mrp-workcenters', rqBigIntKey(organizationId)] }),
  })
}

export function useCompleteProductivityLog(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (logId: string | number | bigint) => {
      if (!companyId) throw new Error("Active company required")
      const { urlPath, init } = stdbBffCommandPost("complete_productivity_log", { logId: logId })
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
      const { urlPath, init } = stdbBffCommandPost("import_workcenter_csv", { companyId: companyId, csvData: csvData })
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
      const { urlPath, init } = stdbBffCommandPost("import_bom_csv", { companyId: companyId, csvData: csvData })
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
      const { urlPath, init } = stdbBffCommandPost("import_bom_line_csv", { companyId: companyId, csvData: csvData })
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
      const { urlPath, init } = stdbBffCommandPost("import_manufacturing_order_csv", { companyId: companyId, csvData: csvData })
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
      const { urlPath, init } = stdbBffCommandPost("link_device_to_workcenter", { deviceId: deviceId, workcenterId: workcenterId })
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
    createWorkorderQualityCheck: useCreateWorkorderQualityCheck(
      organizationId,
      companyId,
    ),
    passWorkorderQualityCheck: usePassWorkorderQualityCheck(
      organizationId,
      companyId,
    ),
    failWorkorderQualityCheck: useFailWorkorderQualityCheck(
      organizationId,
      companyId,
    ),
    scrapFinishedOutput: useScrapFinishedManufacturingOutput(
      organizationId,
      companyId,
    ),
    createBomByproduct: useCreateBomByproduct(organizationId, companyId),
    startWo: useStartWorkorder(organizationId, companyId),
    finishWo: useFinishWorkorder(organizationId, companyId),
    blockWc: useBlockWorkcenter(organizationId),
    unblockWc: useUnblockWorkcenter(organizationId),
    updateBom: useUpdateBom(organizationId, companyId),
    deleteBom: useDeleteBom(organizationId, companyId),
    computeBomCost: useComputeBomCost(organizationId, companyId),
    explodeBom: useExplodeBom(organizationId, companyId),
    updateWorkcenter: useUpdateWorkcenter(organizationId, companyId),
    logProductivity: useLogWorkcenterProductivity(organizationId),
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

export { useConfirmManufacturingOrder }
export { useConsumeMoMaterials, useStartManufacturingOrder }
export { useFinishManufacturingOrder, useProduceManufacturingOrder }
export { useFinishWorkorder, useLogWorkcenterProductivity, useStartWorkorder }

// ── Types (re-exported so client components import from one place) ────────────
export type {
  MrpBom,
  MrpBomLine,
  MrpProduction,
  MrpRoutingWorkcenter,
  MrpWorkcenter,
  MrpWorkorder,
  QualityCheck,
} from "@lumiere/stdb/types"
