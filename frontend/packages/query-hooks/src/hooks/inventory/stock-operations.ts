"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, coalesceQueryInitialData, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64, type ScalarId } from "@lumiere/erp-shared/u64"


// ── Shared helpers ───────────────────────────────────────────────────────────
import {
  toCreateReplenishmentRuleParams,
} from "@lumiere/erp-shared/inventory-create-params"
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

export function useStockQuants(
  organizationId: bigint,
  initialData?: StockQuant[],
) {
  return useQuery<StockQuant[]>({
    queryKey: ['stock-quants', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/stock-quants', 'Failed to fetch stock quants'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useStockPickings(
  organizationId: bigint,
  initialData?: StockPicking[],
) {
  return useQuery<StockPicking[]>({
    queryKey: ['stock-pickings', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/stock-pickings',
        'Failed to fetch stock pickings',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useStockLocations(
  organizationId: bigint,
  initialData?: StockLocation[],
) {
  return useQuery<StockLocation[]>({
    queryKey: ['stock-locations', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/stock-locations',
        'Failed to fetch stock locations',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useStockMoves(
  organizationId: bigint,
  initialData?: StockMove[],
) {
  return useQuery<StockMove[]>({
    queryKey: ['stock-moves', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/stock-moves', 'Failed to fetch stock moves'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useStockRoutes(
  organizationId: bigint,
  initialData?: StockRoute[],
) {
  return useQuery<StockRoute[]>({
    queryKey: ['stock-routes', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/stock-routes', 'Failed to fetch stock routes'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useStockRules(
  organizationId: bigint,
  initialData?: StockRule[],
) {
  return useQuery<StockRule[]>({
    queryKey: ['stock-rules', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/stock-rules', 'Failed to fetch stock rules'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function usePickingWaves(
  organizationId: bigint,
  initialData?: PickingWave[],
) {
  return useQuery<PickingWave[]>({
    queryKey: ['picking-waves', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/picking-waves',
        'Failed to fetch picking waves',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useWarehouseTasks(
  organizationId: bigint,
  initialData?: WarehouseTask[],
) {
  return useQuery<WarehouseTask[]>({
    queryKey: ['warehouse-tasks', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/warehouse-tasks',
        'Failed to fetch warehouse tasks',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useReplenishmentRules(
  organizationId: bigint,
  initialData?: ReplenishmentRule[],
) {
  return useQuery<ReplenishmentRule[]>({
    queryKey: ['replenishment-rules', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/replenishment-rules',
        'Failed to fetch replenishment rules',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}


export function useAssignUserToPicking(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { pickingId: ScalarId; params: { userId: string | null } }
  >({
    mutationFn: async ({ pickingId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('assign_user_to_picking', {
        pickingId: toScalarU64(pickingId),
        params: stdbParamsToJson({
          company_id: companyId,
          user_id:
            params.userId && params.userId.length > 0 ? params.userId : null,
        } as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to assign user to picking');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateStockPicking(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient();
  const scopedCompanyId = options?.companyId;
  return useMutation<void, Error, CreateStockPickingParams>({
    mutationFn: async (params) => {
      const base = mergeReducerParams(
        CREATE_STOCK_PICKING_DEFAULTS,
        scopedCompanyId != null ? { companyId: Number(scopedCompanyId) } : {},
      );
      const merged = mergeReducerParams(base, params);
      const { urlPath, init } = stdbBffCommandPost('create_stock_picking', {
        params: stdbParamsToJson(merged as object, 'CreateStockPickingParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create stock picking');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-pickings', rqBigIntKey(organizationId)],
      }),
  });
}



export function useMoveStockItem3D(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { quantId: bigint; targetLocationId: bigint; quantity: number }
  >({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('move_stock_quant', {
        quantId: toScalarU64(params.quantId),
        params: stdbParamsToJson({
          company_id: companyId,
          dest_location_id: toScalarU64(params.targetLocationId),
          quantity: params.quantity,
        } as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to move stock item');
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId);
      void qc.invalidateQueries({ queryKey: ['stock-quants', orgKey] });
      void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] });
    },
  });
}


export function useValidateStockPicking(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { pickingId: ScalarId; createBackorder?: boolean } | ScalarId
  >({
    mutationFn: async (arg) => {
      const pickingId =
        typeof arg === 'object' && arg !== null && 'pickingId' in arg
          ? arg.pickingId
          : arg;
      const createBackorder =
        typeof arg === 'object' && arg !== null && 'pickingId' in arg
          ? Boolean(arg.createBackorder)
          : false;
      const { urlPath, init } = createBackorder
        ? stdbBffCommandPost('validate_stock_picking_backorder', {
            pickingId: toScalarU64(pickingId),
            params: companyScopeParams(companyId),
          })
        : stdbBffCommandPost('validate_stock_picking', {
            pickingId: toScalarU64(pickingId),
            params: companyScopeParams(companyId),
          });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to validate stock picking');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useReserveStockQuant(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, { quantId: ScalarId; reserveQty: number }>({
    mutationFn: async ({ quantId, reserveQty }) => {
      const { urlPath, init } = stdbBffCommandPost('reserve_stock_quant', {
        quantId: toScalarU64(quantId),
        params: stdbParamsToJson(
          { companyId, reserveQty },
          'StockQuantReserveParams',
        ),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to reserve stock');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUnreserveStockQuant(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, { quantId: ScalarId; unreserveQty: number }>({
    mutationFn: async ({ quantId, unreserveQty }) => {
      const { urlPath, init } = stdbBffCommandPost('unreserve_stock_quant', {
        quantId: toScalarU64(quantId),
        params: stdbParamsToJson(
          { companyId, unreserveQty },
          'StockQuantUnreserveParams',
        ),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to unreserve stock');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}


export function useCreateStockLocation(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateStockLocationParams>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(CREATE_STOCK_LOCATION_DEFAULTS, params);
      const { urlPath, init } = stdbBffCommandPost('create_stock_location', {
        params: stdbParamsToJson(merged as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create stock location');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateStockLocation(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { locationId: ScalarId; params: Partial<UpdateStockLocationParams> }
  >({
    mutationFn: async ({ locationId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_stock_location', {
        locationId: toScalarU64(locationId),
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update stock location');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDeleteStockLocation(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (locationId) => {
      const { urlPath, init } = stdbBffCommandPost('delete_stock_location', {
        locationId: toScalarU64(locationId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete stock location');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateStockMove(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateStockMoveParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_stock_move', {
        params: stdbParamsToJson(params as object, 'CreateStockMoveParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create stock move');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useConfirmStockMove(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (moveId) => {
      const { urlPath, init } = stdbBffCommandPost('confirm_stock_move', {
        moveId: toScalarU64(moveId),
        params: companyScopeParams(companyId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to confirm stock move');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useAssignStockMove(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (moveId) => {
      const { urlPath, init } = stdbBffCommandPost('assign_stock_move', {
        moveId: toScalarU64(moveId),
        params: companyScopeParams(companyId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to assign stock move');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDoneStockMove(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, { moveId: ScalarId; quantityDone: number }>({
    mutationFn: async ({ moveId, quantityDone }) => {
      const { urlPath, init } = stdbBffCommandPost('done_stock_move', {
        moveId: toScalarU64(moveId),
        params: stdbParamsToJson(
          { companyId, quantityDone },
          'DoneStockMoveParams',
        ),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to complete stock move');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCancelStockMove(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (moveId) => {
      const { urlPath, init } = stdbBffCommandPost('cancel_stock_move', {
        moveId: toScalarU64(moveId),
        params: companyScopeParams(companyId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to cancel stock move');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useConfirmStockPicking(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (pickingId) => {
      const { urlPath, init } = stdbBffCommandPost('confirm_stock_picking', {
        pickingId: toScalarU64(pickingId),
        params: companyScopeParams(companyId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to confirm stock picking');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useAssignStockPicking(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (pickingId) => {
      const { urlPath, init } = stdbBffCommandPost('assign_stock_picking', {
        pickingId: toScalarU64(pickingId),
        params: companyScopeParams(companyId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to assign stock picking');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCancelStockPicking(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (pickingId) => {
      const { urlPath, init } = stdbBffCommandPost('cancel_stock_picking', {
        pickingId: toScalarU64(pickingId),
        params: companyScopeParams(companyId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to cancel stock picking');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}


export function useCreatePickingWave(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreatePickingWaveParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_picking_wave', {
        companyId: companyId,
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create picking wave');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['picking-waves', rqBigIntKey(organizationId)],
      }),
  });
}

/** Releases a draft wave: confirm/assign pickings and create pick tasks. */
export function useReleasePickingWave(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (waveId) => {
      const { urlPath, init } = stdbBffCommandPost('release_picking_wave', {
        companyId: companyId,
        waveId: toScalarU64(waveId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to release picking wave');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

/** UI "confirm wave" → `release_picking_wave` (orchestrate pickings + tasks). */
export function useConfirmPickingWave(
  organizationId: bigint,
  companyId: bigint,
) {
  return useReleasePickingWave(organizationId, companyId);
}

export function useCompletePickingWave(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (waveId) => {
      const { urlPath, init } = stdbBffCommandPost('complete_picking_wave', {
        companyId: companyId,
        waveId: toScalarU64(waveId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to complete picking wave');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

// ── Inventory close ──────────────────────────────────────────────────────────


export function useCreatePackagingMaterial(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreatePackagingMaterialParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'create_packaging_material',
        {
          companyId: companyId,
          params: stdbParamsToJson(
            params as object,
            'CreatePackagingMaterialParams',
          ),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create packaging material');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useRunCartonization(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, RunCartonizationParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('run_cartonization', {
        companyId: companyId,
        params: stdbParamsToJson(params as object, 'RunCartonizationParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to run cartonization');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useActivateConsignmentAgreement(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (agreementId) => {
      const { urlPath, init } = stdbBffCommandPost(
        'activate_consignment_agreement',
        { companyId: companyId, agreementId: toScalarU64(agreementId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to activate consignment agreement');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useReceiveConsignmentStock(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ReceiveConsignmentStockParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost(
        'receive_consignment_stock',
        {
          companyId: companyId,
          params: stdbParamsToJson(
            params as object,
            'ReceiveConsignmentStockParams',
          ),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to receive consignment stock');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useExecuteCrossDock(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ExecuteCrossDockParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('execute_cross_dock', {
        companyId: companyId,
        params: stdbParamsToJson(params as object, 'ExecuteCrossDockParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to execute cross-dock');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useExecuteDirectedPutaway(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ExecuteDirectedPutawayParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('execute_directed_putaway', {
        companyId: companyId,
        params: stdbParamsToJson(
          params as object,
          'ExecuteDirectedPutawayParams',
        ),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to execute directed putaway');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

// ── Packing ──────────────────────────────────────────────────────────────────


export function useStockPackages(
  organizationId: bigint,
  initialData?: StockPackage[],
) {
  return useQuery<StockPackage[]>({
    queryKey: ['stock-packages', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/stock-packages',
        'Failed to fetch stock packages',
      ),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function usePackStockPicking(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, PackStockPickingParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('pack_stock_picking', {
        companyId: companyId,
        params: stdbParamsToJson(params as object, 'PackStockPickingParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to pack stock picking');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useConfirmStockPackage(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (packageId) => {
      const { urlPath, init } = stdbBffCommandPost('confirm_stock_package', {
        companyId: companyId,
        packageId: toScalarU64(packageId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to confirm stock package');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDoneStockPackage(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (packageId) => {
      const { urlPath, init } = stdbBffCommandPost('done_stock_package', {
        companyId: companyId,
        packageId: toScalarU64(packageId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to complete stock package');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

// ── Exception queues ─────────────────────────────────────────────────────────

/** Server-bounded: open short-ATP exceptions. */

export function useCreateStockRoute(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateStockRouteParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_stock_route', {
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create stock route');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-routes', rqBigIntKey(organizationId)],
      }),
  });
}

export function useUpdateStockRoute(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { routeId: ScalarId; params: Partial<UpdateStockRouteParams> }
  >({
    mutationFn: async ({ routeId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_stock_route', {
        routeId: toScalarU64(routeId),
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update stock route');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-routes', rqBigIntKey(organizationId)],
      }),
  });
}

export function useDeleteStockRoute(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (routeId) => {
      const { urlPath, init } = stdbBffCommandPost('delete_stock_route', {
        routeId: toScalarU64(routeId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete stock route');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-routes', rqBigIntKey(organizationId)],
      }),
  });
}

export function useCreateStockRule(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateStockRuleParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_stock_rule', {
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create stock rule');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-rules', rqBigIntKey(organizationId)],
      }),
  });
}

export function useUpdateStockRule(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { ruleId: ScalarId; params: Partial<UpdateStockRuleParams> }
  >({
    mutationFn: async ({ ruleId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_stock_rule', {
        ruleId: toScalarU64(ruleId),
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update stock rule');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-rules', rqBigIntKey(organizationId)],
      }),
  });
}

export function useDeleteStockRule(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (ruleId) => {
      const { urlPath, init } = stdbBffCommandPost('delete_stock_rule', {
        ruleId: toScalarU64(ruleId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete stock rule');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['stock-rules', rqBigIntKey(organizationId)],
      }),
  });
}

// ── Warehouse Tasks ────────────────────────────────────────────────────────────


export function useCreateWarehouseTask(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateWarehouseTaskParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost('create_warehouse_task', {
        companyId: companyId,
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create warehouse task');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['warehouse-tasks', rqBigIntKey(organizationId)],
      }),
  });
}

/** Start task via `update_warehouse_task_status` → `in_progress`. */
export function useStartWarehouseTask(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (taskId) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost(
        'update_warehouse_task_status',
        {
          companyId,
          taskId: toScalarU64(taskId),
          newStatus: 'in_progress',
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to start warehouse task');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['warehouse-tasks', rqBigIntKey(organizationId)],
      }),
  });
}

/** Complete task via `update_warehouse_task_status` → `done`. */
export function useCompleteWarehouseTask(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { taskId: ScalarId; result?: Record<string, unknown> }
  >({
    mutationFn: async ({ taskId }) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost(
        'update_warehouse_task_status',
        {
          companyId,
          taskId: toScalarU64(taskId),
          newStatus: 'done',
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to complete warehouse task');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

/** Cancel task via `update_warehouse_task_status` → `cancelled`. */
export function useCancelWarehouseTask(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (taskId) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost(
        'update_warehouse_task_status',
        {
          companyId,
          taskId: toScalarU64(taskId),
          newStatus: 'cancelled',
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to cancel warehouse task');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['warehouse-tasks', rqBigIntKey(organizationId)],
      }),
  });
}

// ── Product Operations ───────────────────────────────────────────────────────


export function useExecuteReplenishmentRule(
  organizationId: bigint,
  companyId?: bigint | null,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, { ruleId: ScalarId; idempotencyKey: string }>({
    mutationFn: async ({ ruleId, idempotencyKey }) => {
      if (companyId == null || companyId <= 0n) {
        throw new Error('A selected company is required');
      }
      const { urlPath, init } = stdbBffCommandPost(
        'execute_replenishment_rule',
        {
          companyId,
          ruleId: toScalarU64(ruleId),
          idempotencyKey,
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to execute replenishment rule');
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId);
      void qc.invalidateQueries({ queryKey: ['replenishment-rules', orgKey] });
      void qc.invalidateQueries({ queryKey: ['stock-quants', orgKey] });
    },
  });
}


export function useCreateStockQuant(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient();
  const scopedCompanyId = options?.companyId;
  return useMutation<void, Error, CreateStockQuantParams>({
    mutationFn: async (params) => {
      const base = mergeReducerParams(
        CREATE_STOCK_QUANT_DEFAULTS,
        scopedCompanyId != null ? { companyId: Number(scopedCompanyId) } : {},
      );
      const merged = mergeReducerParams(base, params);
      const { urlPath, init } = stdbBffCommandPost('create_stock_quant', {
        params: stdbParamsToJson(merged as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create stock quant');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateStockQuantQuantity(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, { quantId: ScalarId; quantity: number }>({
    mutationFn: async ({ quantId, quantity }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'update_stock_quant_quantity',
        {
          quantId: toScalarU64(quantId),
          params: stdbParamsToJson(
            { companyId, quantity },
            'UpdateStockQuantQuantityParams',
          ),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update quant quantity');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}


export function useUpdateWarehouseTaskStatus(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, { taskId: ScalarId; newStatus: string }>({
    mutationFn: async ({ taskId, newStatus }) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost(
        'update_warehouse_task_status',
        { companyId, taskId: toScalarU64(taskId), newStatus },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update task status');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['warehouse-tasks', rqBigIntKey(organizationId)],
      }),
  });
}


export function useCreateReplenishmentRule(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const mapped = toCreateReplenishmentRuleParams(params);
      if (!mapped) throw new Error('Invalid replenishment rule params');
      const { urlPath, init } = stdbBffCommandPost(
        'create_replenishment_rule',
        {
          companyId: companyId,
          params: stdbParamsToJson(mapped, 'CreateReplenishmentRuleParams'),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create replenishment rule');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['replenishment-rules', rqBigIntKey(organizationId)],
      }),
  });
}

// ── Picking Wave ─────────────────────────────────────────────────────────────

