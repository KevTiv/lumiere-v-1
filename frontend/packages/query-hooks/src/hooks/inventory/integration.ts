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

export function useCreateInventoryIntegrationIntent(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateInventoryIntegrationIntentParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'create_inventory_integration_intent',
        {
          companyId: companyId,
          params: stdbParamsToJson(
            params as object,
            'CreateInventoryIntegrationIntentParams',
          ),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok)
        throw new Error('Failed to create inventory integration intent');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useRecordInventoryIntegrationResult(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { intentId: ScalarId; params: RecordInventoryIntegrationResultParams }
  >({
    mutationFn: async ({ intentId, params }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'record_inventory_integration_result',
        {
          companyId: companyId,
          intentId: toScalarU64(intentId),
          params: stdbParamsToJson(
            params as object,
            'RecordInventoryIntegrationResultParams',
          ),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok)
        throw new Error('Failed to record inventory integration result');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

// ── Cartonization / consignment / cross-dock ─────────────────────────────────


export function useWarehouseSyncIntentsPending(
  organizationId: bigint,
  initialData?: WarehouseSyncIntent[],
) {
  return useQuery<WarehouseSyncIntent[]>({
    queryKey: ['warehouse-sync-intents-pending', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/warehouse-sync-intents-pending',
        'Failed to fetch pending warehouse sync intents',
      ),
    staleTime: 15_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useCreateWarehouseSyncIntent(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateWarehouseSyncIntentParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'create_warehouse_sync_intent',
        {
          companyId: companyId,
          params: stdbParamsToJson(
            params as object,
            'CreateWarehouseSyncIntentParams',
          ),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create warehouse sync intent');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useApplyWarehouseSyncIntent(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (intentId) => {
      const { urlPath, init } = stdbBffCommandPost(
        'apply_warehouse_sync_intent',
        { companyId: companyId, intentId: toScalarU64(intentId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to apply warehouse sync intent');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useFailWarehouseSyncIntent(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, { intentId: ScalarId; lastError: string }>({
    mutationFn: async ({ intentId, lastError }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'fail_warehouse_sync_intent',
        {
          companyId: companyId,
          intentId: toScalarU64(intentId),
          params: stdbParamsToJson(
            { lastError },
            'FailWarehouseSyncIntentParams',
          ),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to fail warehouse sync intent');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

// ── Product Category ───────────────────────────────────────────────────────────
