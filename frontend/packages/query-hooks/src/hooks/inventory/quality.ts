"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, coalesceQueryInitialData, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64, type ScalarId } from "@lumiere/erp-shared/u64"


// ── Shared helpers ───────────────────────────────────────────────────────────
import {
  companyScopeParams,
  mergeReducerParams,
  CREATE_PRODUCT_DEFAULTS,
  CREATE_STOCK_QUANT_DEFAULTS,
  CREATE_STOCK_PICKING_DEFAULTS,
  CREATE_STOCK_LOCATION_DEFAULTS,
  invalidateInventoryQueries,
} from "./shared"


import type {
  UpdateProductParams,
  Product,
  ProductCategory,
  Uom,
  StockQuant,
  StockPicking,
  Warehouse,
  InventoryAdjustment,
  StockLocation,
  StockProductionLot,
  QualityCheck,
  QualityAlert,
  Warehouse3DZone,
  StockCycleCount,
  StockInventory,
  StockMove,
  StockRoute,
  StockRule,
  PickingWave,
  WarehouseTask,
  ReplenishmentRule,
  BarcodeRule,
  AdjustmentReason,
  BarcodeNomenclature,
  SerialLotTraceability,
  StockTraceabilityReport,
  InventoryValuation,
  StockProductionSerial,
  StockPackage,
  InventoryException,
  WarehouseSyncIntent,
  CreateProductParams,
  CreateWarehouseParams,
  UpdateWarehouseParams,
  CreateStockPickingParams,
  CreateInventoryAdjustmentParams,
  CreateCycleCountPlanParams,
  RecordCycleCountLineParams,
  CreateStockLocationParams,
  UpdateStockLocationParams,
  CreateStockMoveParams,
  CreateStockProductionLotParams,
  CreateStockProductionSerialParams,
  CreateQualityCheckParams,
  CreateQualityAlertParams,
  CreateQualityPointParams,
  UpdateQualityPointParams,
  CreateQualityTeamParams,
  UpdateQualityTeamParams,
  CreateBarcodeRuleParams,
  UpdateBarcodeRuleParams,
  RecordBarcodeScanParams,
  UpdateBarcodeNomenclatureParams,
  CreateAdjustmentReasonParams,
  CreateTraceabilityRecordParams,
  CreateStockTraceabilityReportParams,
  CreatePickingWaveParams,
  CreateInventoryCloseParams,
  RunInventoryCloseParams,
  CreateInventoryIntegrationIntentParams,
  RecordInventoryIntegrationResultParams,
  CreatePackagingMaterialParams,
  RunCartonizationParams,
  ReceiveConsignmentStockParams,
  ExecuteCrossDockParams,
  ExecuteDirectedPutawayParams,
  PackStockPickingParams,
  RefreshInventoryExceptionsParams,
  CreateWarehouseSyncIntentParams,
  CreateProductCategoryParams,
  UpdateProductCategoryParams,
  CreateStockRouteParams,
  UpdateStockRouteParams,
  CreateStockRuleParams,
  UpdateStockRuleParams,
  CreateWarehouseTaskParams,
  UpdateProductVariantParams,
  UpdateProductInventoryDataParams,
  UpdateProductPricingParams,
  UpdateStockProductionLotParams,
  UpdateStockProductionSerialParams,
  CreateWarehouse3DZoneParams,
  UpdateWarehouse3DZoneParams,
  UpdateProductSupplierInfoParams,
  UpdateProductPackagingParams,
  CreateStockQuantParams,
} from '@lumiere/stdb/types';

export function useQualityChecks(
  organizationId: bigint,
  initialData?: QualityCheck[],
) {
  return useQuery<QualityCheck[]>({
    queryKey: ['quality-checks', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/quality-checks',
        'Failed to fetch quality checks',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useQualityAlerts(
  organizationId: bigint,
  initialData?: QualityAlert[],
) {
  return useQuery<QualityAlert[]>({
    queryKey: ['quality-alerts', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/quality-alerts',
        'Failed to fetch quality alerts',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useQualityTeams(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['quality-teams', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/quality-teams',
        'Failed to fetch quality teams',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useCreateQualityCheck(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateQualityCheckParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_quality_check', {
        companyId: companyId,
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create quality check');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function usePassQualityCheck(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    {
      checkId: ScalarId;
      measure?: number | null;
      note?: string | null;
      picture?: string | null;
    }
  >({
    mutationFn: async ({ checkId, measure, note, picture }) => {
      const { urlPath, init } = stdbBffCommandPost('pass_quality_check', {
        companyId: companyId,
        checkId: toScalarU64(checkId),
        measure: measure ?? null,
        note: note ?? null,
        picture: picture ?? null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to pass quality check');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useFailQualityCheck(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    {
      checkId: ScalarId;
      qtyFailed: number;
      note?: string | null;
      pictureFail?: string | null;
      failureLocationId?: ScalarId | null;
    }
  >({
    mutationFn: async ({
      checkId,
      qtyFailed,
      note,
      pictureFail,
      failureLocationId,
    }) => {
      const { urlPath, init } = stdbBffCommandPost('fail_quality_check', {
        companyId: companyId,
        checkId: toScalarU64(checkId),
        qtyFailed: qtyFailed,
        note: note ?? null,
        pictureFail: pictureFail ?? null,
        failureLocationId:
          failureLocationId != null ? toScalarU64(failureLocationId) : null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to fail quality check');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateQualityAlert(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { teamId: ScalarId; params: CreateQualityAlertParams }
  >({
    mutationFn: async ({ teamId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('create_quality_alert', {
        companyId: companyId,
        teamId: toScalarU64(teamId),
        params: stdbParamsToJson(params as object, 'CreateQualityAlertParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create quality alert');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useAssignQualityAlert(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, { alertId: ScalarId; userId: string | null }>(
    {
      mutationFn: async ({ alertId, userId }) => {
        const { urlPath, init } = stdbBffCommandPost('assign_quality_alert', {
          companyId: companyId,
          alertId: toScalarU64(alertId),
          userId: userId,
        });
        const r = await apiFetch(urlPath, init);
        if (!r.ok) throw new Error('Failed to assign quality alert');
      },
      onSuccess: () => invalidateInventoryQueries(qc, organizationId),
    },
  );
}

export function useCancelQualityAlert(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { alertId: ScalarId; description?: string | null }
  >({
    mutationFn: async ({ alertId, description }) => {
      const { urlPath, init } = stdbBffCommandPost('cancel_quality_alert', {
        companyId: companyId,
        alertId: toScalarU64(alertId),
        description: description ?? null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to cancel quality alert');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateQualityPoint(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateQualityPointParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_quality_point', {
        companyId: companyId,
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create quality point');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateQualityPoint(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { pointId: ScalarId; params: Partial<UpdateQualityPointParams> }
  >({
    mutationFn: async ({ pointId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_quality_point', {
        companyId: companyId,
        pointId: toScalarU64(pointId),
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update quality point');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDeleteQualityPoint(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (pointId) => {
      const { urlPath, init } = stdbBffCommandPost('delete_quality_point', {
        companyId: companyId,
        pointId: toScalarU64(pointId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete quality point');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateQualityTeam(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateQualityTeamParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_quality_team', {
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create quality team');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateQualityTeam(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { teamId: ScalarId; params: Partial<UpdateQualityTeamParams> }
  >({
    mutationFn: async ({ teamId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_quality_team', {
        teamId: toScalarU64(teamId),
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update quality team');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDeleteQualityTeam(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (teamId) => {
      const { urlPath, init } = stdbBffCommandPost('delete_quality_team', {
        teamId: toScalarU64(teamId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete quality team');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

// ── Barcode Management ─────────────────────────────────────────────────────────


export function useStartQualityCheck(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (checkId) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('start_quality_check', {
        companyId,
        checkId: toScalarU64(checkId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to start quality check');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useOpenQualityAlert(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (alertId) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('open_quality_alert', {
        companyId,
        alertId: toScalarU64(alertId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to open quality alert');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useSolveQualityAlert(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { alertId: ScalarId; description?: string | null }
  >({
    mutationFn: async ({ alertId, description }) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('solve_quality_alert', {
        companyId,
        alertId: toScalarU64(alertId),
        description: description ?? null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to solve quality alert');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateQualityAlertReason(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { name: string; description?: string | null; metadata?: string | null }
  >({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'create_quality_alert_reason',
        {
          params: {
            name: params.name,
            description: params.description ?? null,
            metadata: params.metadata ?? null,
          },
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create quality alert reason');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateQualityAlertReason(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    {
      reasonId: ScalarId;
      params: {
        name?: string | null;
        description?: string | null;
        is_active?: boolean | null;
      };
    }
  >({
    mutationFn: async ({ reasonId, params }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'update_quality_alert_reason',
        {
          reasonId: toScalarU64(reasonId),
          params: stdbParamsToJson(params as object),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update quality alert reason');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDeleteQualityAlertReason(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (reasonId) => {
      const { urlPath, init } = stdbBffCommandPost(
        'delete_quality_alert_reason',
        { reasonId: toScalarU64(reasonId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete quality alert reason');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useAddMemberToQualityTeam(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { teamId: ScalarId; memberIdentityHex: string }
  >({
    mutationFn: async ({ teamId, memberIdentityHex }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'add_member_to_quality_team',
        { teamId: toScalarU64(teamId), memberIdentity: memberIdentityHex },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to add team member');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useRemoveMemberFromQualityTeam(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { teamId: ScalarId; memberIdentityHex: string }
  >({
    mutationFn: async ({ teamId, memberIdentityHex }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'remove_member_from_quality_team',
        { teamId: toScalarU64(teamId), memberIdentity: memberIdentityHex },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to remove team member');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useLinkDeviceToQualityCheck(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, { deviceId: ScalarId; checkId: ScalarId }>({
    mutationFn: async ({ deviceId, checkId }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'link_device_to_quality_check',
        { deviceId: toScalarU64(deviceId), checkId: toScalarU64(checkId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to link device to quality check');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}
