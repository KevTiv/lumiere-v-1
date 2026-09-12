"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, coalesceQueryInitialData, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { toCreateBarcodeNomenclatureParams } from "@lumiere/erp-shared/inventory-create-params"

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

export function useBarcodeRules(
  organizationId: bigint,
  initialData?: BarcodeRule[],
) {
  return useQuery<BarcodeRule[]>({
    queryKey: ['barcode-rules', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/barcode-rules',
        'Failed to fetch barcode rules',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useBarcodeNomenclatures(
  organizationId: bigint,
  initialData?: BarcodeNomenclature[],
) {
  return useQuery<BarcodeNomenclature[]>({
    queryKey: ['barcode-nomenclatures', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/barcode-nomenclatures',
        'Failed to fetch barcode nomenclatures',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useCreateBarcodeRule(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateBarcodeRuleParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_barcode_rule', {
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create barcode rule');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['barcode-rules', rqBigIntKey(organizationId)],
      }),
  });
}

export function useUpdateBarcodeRule(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { ruleId: ScalarId; params: Partial<UpdateBarcodeRuleParams> }
  >({
    mutationFn: async ({ ruleId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_barcode_rule', {
        ruleId: toScalarU64(ruleId),
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update barcode rule');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['barcode-rules', rqBigIntKey(organizationId)],
      }),
  });
}

export function useDeleteBarcodeRule(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (ruleId) => {
      const { urlPath, init } = stdbBffCommandPost('delete_barcode_rule', {
        ruleId: toScalarU64(ruleId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete barcode rule');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['barcode-rules', rqBigIntKey(organizationId)],
      }),
  });
}

export function useRecordBarcodeScan(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, RecordBarcodeScanParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('record_barcode_scan', {
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to record barcode scan');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateBarcodeNomenclature(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const mapped = toCreateBarcodeNomenclatureParams(params);
      if (!mapped) throw new Error('Invalid barcode nomenclature params');
      const { urlPath, init } = stdbBffCommandPost(
        'create_barcode_nomenclature',
        { params: stdbParamsToJson(mapped, 'CreateBarcodeNomenclatureParams') },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create barcode nomenclature');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateBarcodeNomenclature(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { nomenclatureId: ScalarId; params: Partial<UpdateBarcodeNomenclatureParams> }
  >({
    mutationFn: async ({ nomenclatureId, params }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'update_barcode_nomenclature',
        {
          nomenclatureId: toScalarU64(nomenclatureId),
          params: stdbParamsToJson(params as object),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update barcode nomenclature');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDeleteBarcodeNomenclature(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (nomenclatureId) => {
      const { urlPath, init } = stdbBffCommandPost(
        'delete_barcode_nomenclature',
        { nomenclatureId: toScalarU64(nomenclatureId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete barcode nomenclature');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useAddRuleToNomenclature(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { nomenclatureId: ScalarId; ruleId: ScalarId }
  >({
    mutationFn: async ({ nomenclatureId, ruleId }) => {
      const { urlPath, init } = stdbBffCommandPost('add_rule_to_nomenclature', {
        nomenclatureId: toScalarU64(nomenclatureId),
        ruleId: toScalarU64(ruleId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to add rule to nomenclature');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useRemoveRuleFromNomenclature(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  const orgKey = rqBigIntKey(organizationId);
  return useMutation<
    void,
    Error,
    { nomenclatureId: ScalarId; ruleId: ScalarId }
  >({
    mutationFn: async ({ nomenclatureId, ruleId }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'remove_rule_from_nomenclature',
        {
          nomenclatureId: toScalarU64(nomenclatureId),
          ruleId: toScalarU64(ruleId),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to remove rule from nomenclature');
    },
    onSuccess: () => {
      invalidateInventoryQueries(qc, organizationId);
      void qc.invalidateQueries({
        queryKey: ['barcode-nomenclatures', orgKey],
      });
    },
  });
}

