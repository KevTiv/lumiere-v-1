"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, coalesceQueryInitialData, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64, type ScalarId } from "@lumiere/erp-shared/u64"
import {
  toCreateStockInventoryParams,
  toCreateStockInventoryLineParams,
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

export function useInventoryAdjustments(
  organizationId: bigint,
  initialData?: InventoryAdjustment[],
) {
  return useQuery<InventoryAdjustment[]>({
    queryKey: ['inventory-adjustments', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/inventory-adjustments',
        'Failed to fetch inventory adjustments',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useStockCycleCounts(
  organizationId: bigint,
  initialData?: StockCycleCount[],
) {
  return useQuery<StockCycleCount[]>({
    queryKey: ['stock-cycle-counts', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/stock-cycle-counts',
        'Failed to fetch cycle counts',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useStockInventories(
  organizationId: bigint,
  initialData?: StockInventory[],
) {
  return useQuery<StockInventory[]>({
    queryKey: ['stock-inventories', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/stock-inventories',
        'Failed to fetch stock inventories',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useAdjustmentReasons(
  organizationId: bigint,
  initialData?: AdjustmentReason[],
) {
  return useQuery<AdjustmentReason[]>({
    queryKey: ['adjustment-reasons', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/adjustment-reasons',
        'Failed to fetch adjustment reasons',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useCreateInventoryAdjustment(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateInventoryAdjustmentParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'create_inventory_adjustment',
        {
          params: stdbParamsToJson(
            params as object,
            'CreateInventoryAdjustmentParams',
          ),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create inventory adjustment');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['inventory-adjustments', rqBigIntKey(organizationId)],
      }),
  });
}

export function useProcessInventoryAdjustment(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (adjustmentId) => {
      const { urlPath, init } = stdbBffCommandPost(
        'process_inventory_adjustment',
        { adjustmentId: toScalarU64(adjustmentId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to process inventory adjustment');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['inventory-adjustments', rqBigIntKey(organizationId)],
      }),
  });
}


export function useCreateCycleCountPlan(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { locationId: number; params: CreateCycleCountPlanParams }
  >({
    mutationFn: async ({ locationId, params }) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('create_cycle_count_plan', {
        companyId,
        locationId: toScalarU64(locationId),
        params: stdbParamsToJson(
          params as object,
          'CreateCycleCountPlanParams',
        ),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create cycle count plan');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-cycle-counts', rqBigIntKey(organizationId)],
      }),
  });
}

export function useStartCycleCountSession(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (cycleCountId) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost(
        'start_cycle_count_session',
        { companyId, cycleCountId: toScalarU64(cycleCountId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to start cycle count session');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-cycle-counts', rqBigIntKey(organizationId)],
      }),
  });
}

export function useRecordCycleCountLine(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { cycleCountId: ScalarId; params: RecordCycleCountLineParams }
  >({
    mutationFn: async ({ cycleCountId, params }) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('record_cycle_count_line', {
        companyId,
        cycleCountId: toScalarU64(cycleCountId),
        params: stdbParamsToJson(
          params as object,
          'RecordCycleCountLineParams',
        ),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to record cycle count line');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-cycle-counts', rqBigIntKey(organizationId)],
      }),
  });
}

export function useValidateCycleCount(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (cycleCountId) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('validate_cycle_count', {
        companyId,
        cycleCountId: toScalarU64(cycleCountId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to validate cycle count');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-cycle-counts', rqBigIntKey(organizationId)],
      }),
  });
}

export function usePostCycleCountAdjustments(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (cycleCountId) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost(
        'post_cycle_count_adjustments',
        { companyId, cycleCountId: toScalarU64(cycleCountId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to post cycle count adjustments');
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId);
      void qc.invalidateQueries({ queryKey: ['stock-cycle-counts', orgKey] });
      void qc.invalidateQueries({ queryKey: ['stock-quants', orgKey] });
    },
  });
}


export function useCreateStockInventory(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const mapped = toCreateStockInventoryParams(params);
      if (!mapped) throw new Error('Invalid stock inventory params');
      const { urlPath, init } = stdbBffCommandPost('create_stock_inventory', {
        params: stdbParamsToJson(mapped, 'CreateStockInventoryParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create stock inventory');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateStockInventoryLine(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { inventoryId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ inventoryId, params }) => {
      const mapped = toCreateStockInventoryLineParams(params);
      if (!mapped) throw new Error('Invalid stock inventory line params');
      const { urlPath, init } = stdbBffCommandPost(
        'create_stock_inventory_line',
        {
          inventoryId: toScalarU64(inventoryId),
          params: stdbParamsToJson(mapped, 'CreateStockInventoryLineParams'),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create stock inventory line');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateStockInventoryState(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, { inventoryId: ScalarId; newState: string }>({
    mutationFn: async ({ inventoryId, newState }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'update_stock_inventory_state',
        { inventoryId: toScalarU64(inventoryId), newState: newState },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update stock inventory state');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}


export function useCreateAdjustmentReason(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  const orgKey = rqBigIntKey(organizationId);
  return useMutation<void, Error, CreateAdjustmentReasonParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_adjustment_reason', {
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create adjustment reason');
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['adjustment-reasons', orgKey] }),
  });
}


export function useCreateInventoryClose(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateInventoryCloseParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_inventory_close', {
        companyId: companyId,
        params: stdbParamsToJson(
          params as object,
          'CreateInventoryCloseParams',
        ),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create inventory close');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useRunInventoryClose(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { closeId: ScalarId; params?: RunInventoryCloseParams }
  >({
    mutationFn: async ({ closeId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('run_inventory_close', {
        companyId: companyId,
        closeId: toScalarU64(closeId),
        params: stdbParamsToJson(params ?? {}, 'RunInventoryCloseParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to run inventory close');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useReopenInventoryClose(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (closeId) => {
      const { urlPath, init } = stdbBffCommandPost('reopen_inventory_close', {
        companyId: companyId,
        closeId: toScalarU64(closeId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to reopen inventory close');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useInventoryExceptionsShortAtp(
  organizationId: bigint,
  initialData?: InventoryException[],
) {
  return useQuery<InventoryException[]>({
    queryKey: ['inventory-exceptions-short-atp', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/inventory-exceptions-short-atp',
        'Failed to fetch short ATP exceptions',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

/** Server-bounded: open expired-lot exceptions. */
export function useInventoryExceptionsExpiredLots(
  organizationId: bigint,
  initialData?: InventoryException[],
) {
  return useQuery<InventoryException[]>({
    queryKey: [
      'inventory-exceptions-expired-lots',
      rqBigIntKey(organizationId),
    ],
    queryFn: () =>
      fetchQueryList(
        '/api/query/inventory-exceptions-expired-lots',
        'Failed to fetch expired lot exceptions',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

/** Server-bounded: open QC-fail exceptions. */
export function useInventoryExceptionsOpenQc(
  organizationId: bigint,
  initialData?: InventoryException[],
) {
  return useQuery<InventoryException[]>({
    queryKey: ['inventory-exceptions-open-qc', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/inventory-exceptions-open-qc',
        'Failed to fetch open QC exceptions',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useRefreshInventoryExceptions(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, RefreshInventoryExceptionsParams | undefined>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'refresh_inventory_exceptions',
        {
          companyId: companyId,
          params: stdbParamsToJson(
            params ?? { upsertOnly: false },
            'RefreshInventoryExceptionsParams',
          ),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to refresh inventory exceptions');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useResolveInventoryException(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (exceptionId) => {
      const { urlPath, init } = stdbBffCommandPost(
        'resolve_inventory_exception',
        { companyId: companyId, exceptionId: toScalarU64(exceptionId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to resolve inventory exception');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useInventoryValuations(
  organizationId: bigint,
  initialData?: InventoryValuation[],
) {
  return useQuery<InventoryValuation[]>({
    queryKey: ['inventory-valuations', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/inventory-valuations',
        'Failed to fetch inventory valuations',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

