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

export function useProductionLots(
  organizationId: bigint,
  initialData?: StockProductionLot[],
) {
  return useQuery<StockProductionLot[]>({
    queryKey: ['stock-production-lots', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/stock-production-lots',
        'Failed to fetch production lots',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useSerialLotTraceability(
  organizationId: bigint,
  initialData?: SerialLotTraceability[],
) {
  return useQuery<SerialLotTraceability[]>({
    queryKey: ['serial-lot-traceability', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/serial-lot-traceability',
        'Failed to fetch traceability rows',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useStockTraceabilityReports(
  organizationId: bigint,
  initialData?: StockTraceabilityReport[],
) {
  return useQuery<StockTraceabilityReport[]>({
    queryKey: ['stock-traceability-reports', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/stock-traceability-reports',
        'Failed to fetch traceability reports',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useStockProductionSerials(
  organizationId: bigint,
  initialData?: StockProductionSerial[],
) {
  return useQuery<StockProductionSerial[]>({
    queryKey: ['stock-production-serials', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/stock-production-serials',
        'Failed to fetch serial numbers',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────


export function useCreateStockProductionLot(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateStockProductionLotParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'create_stock_production_lot',
        { params: stdbParamsToJson(params as object) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create stock production lot');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateStockProductionSerial(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateStockProductionSerialParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'create_stock_production_serial',
        { params: stdbParamsToJson(params as object) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create stock production serial');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useReserveSerial(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (serialId) => {
      const { urlPath, init } = stdbBffCommandPost('reserve_serial', {
        serialId: toScalarU64(serialId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to reserve serial');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useBlockSerial(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { serialId: ScalarId; reason?: string | null }
  >({
    mutationFn: async ({ serialId, reason }) => {
      const { urlPath, init } = stdbBffCommandPost('block_serial', {
        serialId: toScalarU64(serialId),
        reason: reason ?? null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to block serial');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

// ── Quality Management ───────────────────────────────────────────────────────


export function useUseSerial(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (serialId) => {
      const { urlPath, init } = stdbBffCommandPost('use_serial', {
        serialId: toScalarU64(serialId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to mark serial in use');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateTraceabilityRecord(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  const orgKey = rqBigIntKey(organizationId);
  return useMutation<void, Error, CreateTraceabilityRecordParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'create_traceability_record',
        { params: stdbParamsToJson(params as object) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create traceability record');
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['serial-lot-traceability', orgKey],
      }),
  });
}

export function useCreateTraceabilityReport(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  const orgKey = rqBigIntKey(organizationId);
  return useMutation<void, Error, CreateStockTraceabilityReportParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'create_traceability_report',
        { params: stdbParamsToJson(params as object) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create traceability report');
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['stock-traceability-reports', orgKey],
      }),
  });
}

export function useRunTraceabilityReport(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  const orgKey = rqBigIntKey(organizationId);
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (reportId) => {
      const { urlPath, init } = stdbBffCommandPost('run_traceability_report', {
        reportId: toScalarU64(reportId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to run traceability report');
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['stock-traceability-reports', orgKey],
      }),
  });
}

// ── UOM Management ─────────────────────────────────────────────────────────────


export function useUpdateStockProductionLot(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { lotId: ScalarId; params: Partial<UpdateStockProductionLotParams> }
  >({
    mutationFn: async ({ lotId, params }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'update_stock_production_lot',
        {
          lotId: toScalarU64(lotId),
          params: stdbParamsToJson(params as object),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update lot');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDeleteStockProductionLot(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (lotId) => {
      const { urlPath, init } = stdbBffCommandPost(
        'delete_stock_production_lot',
        { lotId: toScalarU64(lotId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete lot');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateStockProductionSerial(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { serialId: ScalarId; params: Partial<UpdateStockProductionSerialParams> }
  >({
    mutationFn: async ({ serialId, params }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'update_stock_production_serial',
        {
          serialId: toScalarU64(serialId),
          params: stdbParamsToJson(params as object),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update serial');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDeleteStockProductionSerial(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (serialId) => {
      const { urlPath, init } = stdbBffCommandPost(
        'delete_stock_production_serial',
        { serialId: toScalarU64(serialId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete serial');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

