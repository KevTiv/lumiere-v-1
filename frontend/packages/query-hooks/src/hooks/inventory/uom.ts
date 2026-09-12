"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, coalesceQueryInitialData, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64, type ScalarId } from "@lumiere/erp-shared/u64"
import {
  toCreateUomCategoryParams,
  toCreateUomParams,
  toCreateUomConversionParams,
} from "@lumiere/erp-shared/inventory-create-params"

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

export function useUoms(organizationId: bigint, initialData?: Uom[]) {
  return useQuery<Uom[]>({
    queryKey: ['uoms', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/uoms', 'Failed to fetch units of measure'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useCreateUomCategory(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const mapped = toCreateUomCategoryParams(params);
      if (!mapped) throw new Error('Invalid UOM category params');
      const { urlPath, init } = stdbBffCommandPost('create_uom_category', {
        params: stdbParamsToJson(mapped, 'CreateUomCategoryParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create UOM category');
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['uoms', rqBigIntKey(organizationId)] }),
  });
}

export function useCreateUom(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const mapped = toCreateUomParams(params);
      if (!mapped) throw new Error('Invalid UOM params');
      const { urlPath, init } = stdbBffCommandPost('create_uom', {
        params: stdbParamsToJson(mapped, 'CreateUomParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create UOM');
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['uoms', rqBigIntKey(organizationId)] }),
  });
}

export function useCreateUomConversion(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { categoryId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ categoryId, params }) => {
      const mapped = toCreateUomConversionParams(params);
      if (!mapped) throw new Error('Invalid UOM conversion params');
      const { urlPath, init } = stdbBffCommandPost('create_uom_conversion', {
        categoryId: toScalarU64(categoryId),
        params: stdbParamsToJson(mapped, 'CreateUomConversionParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create UOM conversion');
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['uoms', rqBigIntKey(organizationId)] }),
  });
}

// ── Replenishment ────────────────────────────────────────────────────────────

