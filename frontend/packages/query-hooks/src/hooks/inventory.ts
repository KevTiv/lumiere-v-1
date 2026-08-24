'use client';

import { stdbBffCommandPost } from '@lumiere/stdb/commands';
/**
 * Inventory hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Inventory module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { inventoryBffPost } from '@lumiere/stdb/commands';
import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiFetch,
  fetchQueryList,
  coalesceQueryInitialData,
  type QueryRows,
  rqBigIntKey,
} from '../http';
import { buildWarehouse3DView } from '@lumiere/erp-shared/warehouse-3d-from-api';
import {
  toCreateBarcodeNomenclatureParams,
  toCreateProductPackagingParams,
  toCreateProductSupplierInfoParams,
  toCreateProductVariantParams,
  toCreateReplenishmentRuleParams,
  toCreateStockInventoryLineParams,
  toCreateStockInventoryParams,
  toCreateUomCategoryParams,
  toCreateUomConversionParams,
  toCreateUomParams,
} from '@lumiere/erp-shared/inventory-create-params';
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
import { finalizeUpdateProductParams } from './inventory-params-merge';
type ScalarId = bigint | number | string;

/** Coerce reducer u64 ids from table/API scalars (avoids unsafe `Number` for large ids). */
function toScalarU64(v: ScalarId): bigint {
  return typeof v === 'bigint' ? v : BigInt(String(v));
}

function companyScopeParams(companyId: bigint): Record<string, unknown> {
  return stdbParamsToJson({ companyId }, 'CompanyScopeParams');
}

/** Shallow merge for reducer JSON: `overrides` entries with value `undefined` are skipped. */
function mergeReducerParams(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const CREATE_PRODUCT_DEFAULTS: Record<string, unknown> = {
  costMethod: 'standard',
  valuation: 'manual_periodic',
};

const CREATE_STOCK_QUANT_DEFAULTS: Record<string, unknown> = {
  inventoryQuantity: 0,
  inventoryDiffQuantity: 0,
  inventoryQuantitySet: false,
  isOutdated: false,
  accountingEntryIds: [],
};

const CREATE_STOCK_PICKING_DEFAULTS: Record<string, unknown> = {
  moveType: 'direct',
  priority: '0',
  isLocked: false,
  immediateTransfer: false,
  isPrinted: false,
  isReturn: false,
  hasScrapMove: false,
  hasTracking: false,
  backorderIds: [],
  showOperations: true,
  showLotsText: false,
  showReserved: true,
  showCheckAvailability: true,
  showValidate: true,
  showMarkAsTodo: false,
  showSetQtyButton: false,
  showClearQtyButton: false,
  showLotsM2O: false,
  moveLineExist: false,
  hasPackages: false,
  hasMoveLines: false,
  hasPackage: false,
  hasLot: false,
  hasOwner: false,
  hasEntirePackageSrc: false,
  hasEntirePackageDest: false,
  packageLevelIds: [],
};

const CREATE_STOCK_LOCATION_DEFAULTS: Record<string, unknown> = {
  childLeft: 0,
  childRight: 1,
  scrapLocation: false,
  returnLocation: false,
  active: true,
  posx: 0,
  posy: 0,
  posz: 0,
  cyclicInventoryFrequency: 0,
};

function invalidateInventoryQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const orgKey = rqBigIntKey(organizationId);
  void qc.invalidateQueries({ queryKey: ['products', orgKey] });
  void qc.invalidateQueries({ queryKey: ['product-categories', orgKey] });
  void qc.invalidateQueries({ queryKey: ['stock-locations', orgKey] });
  void qc.invalidateQueries({ queryKey: ['stock-quants', orgKey] });
  void qc.invalidateQueries({ queryKey: ['stock-pickings', orgKey] });
  void qc.invalidateQueries({ queryKey: ['inventory-adjustments', orgKey] });
  void qc.invalidateQueries({ queryKey: ['stock-production-lots', orgKey] });
  void qc.invalidateQueries({ queryKey: ['warehouses', orgKey] });
  void qc.invalidateQueries({ queryKey: ['quality-checks', orgKey] });
  void qc.invalidateQueries({ queryKey: ['quality-alerts', orgKey] });
  void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] });
  void qc.invalidateQueries({ queryKey: ['stock-cycle-counts', orgKey] });
  void qc.invalidateQueries({ queryKey: ['warehouse-3d', orgKey] });
  void qc.invalidateQueries({ queryKey: ['stock-inventories', orgKey] });
  void qc.invalidateQueries({ queryKey: ['stock-moves', orgKey] });
  void qc.invalidateQueries({ queryKey: ['stock-production-serials', orgKey] });
  void qc.invalidateQueries({ queryKey: ['adjustment-reasons', orgKey] });
  void qc.invalidateQueries({ queryKey: ['barcode-nomenclatures', orgKey] });
  void qc.invalidateQueries({ queryKey: ['serial-lot-traceability', orgKey] });
  void qc.invalidateQueries({
    queryKey: ['stock-traceability-reports', orgKey],
  });
  void qc.invalidateQueries({ queryKey: ['stock-packages', orgKey] });
  void qc.invalidateQueries({ queryKey: ['inventory-exceptions', orgKey] });
  void qc.invalidateQueries({
    queryKey: ['inventory-exceptions-short-atp', orgKey],
  });
  void qc.invalidateQueries({
    queryKey: ['inventory-exceptions-expired-lots', orgKey],
  });
  void qc.invalidateQueries({
    queryKey: ['inventory-exceptions-open-qc', orgKey],
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useProducts(
  organizationId: bigint,
  initialData?: Product[],
) {
  return useQuery<Product[]>({
    queryKey: ['products', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/products', 'Failed to fetch products'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

export function useProductCategories(
  organizationId: bigint,
  initialData?: ProductCategory[],
) {
  return useQuery<ProductCategory[]>({
    queryKey: ['product-categories', rqBigIntKey(organizationId)],
    queryFn: async () => {
      const rows = await fetchQueryList(
        '/api/query/product-categories',
        'Failed to fetch product categories',
      );
      return rows.filter((r) => r.deletedAt == null);
    },
    staleTime: 30_000,
    initialData: initialData?.filter((r) => r.deletedAt == null),
  });
}

export function useUoms(organizationId: bigint, initialData?: Uom[]) {
  return useQuery<Uom[]>({
    queryKey: ['uoms', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/uoms', 'Failed to fetch units of measure'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

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

export function useWarehouses(
  organizationId: bigint,
  initialData?: Warehouse[],
) {
  return useQuery<Warehouse[]>({
    queryKey: ['warehouses', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/warehouses', 'Failed to fetch warehouses'),
    staleTime: 30_000,
    initialData: coalesceQueryInitialData(initialData),
  });
}

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

export function useWarehouse3D(
  organizationId: bigint,
  _companyId: bigint,
  warehouseId: bigint,
) {
  const orgKey = rqBigIntKey(organizationId);
  const { data: zones3D = [] } = useQuery<Warehouse3DZone[]>({
    queryKey: ['warehouse-3d-zones', orgKey],
    queryFn: () =>
      fetchQueryList(
        '/api/query/warehouse-3d-zones',
        'Failed to fetch warehouse 3D zones',
      ),
    staleTime: 30_000,
  });
  const { data: allLocations = [] } = useQuery<StockLocation[]>({
    queryKey: ['stock-locations', orgKey],
    queryFn: () =>
      fetchQueryList(
        '/api/query/stock-locations',
        'Failed to fetch stock locations',
      ),
    staleTime: 30_000,
  });
  const { data: allQuants = [] } = useQuery<StockQuant[]>({
    queryKey: ['stock-quants', orgKey],
    queryFn: () =>
      fetchQueryList('/api/query/stock-quants', 'Failed to fetch stock quants'),
    staleTime: 30_000,
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products', orgKey],
    queryFn: () =>
      fetchQueryList('/api/query/products', 'Failed to fetch products'),
    staleTime: 30_000,
  });

  return useMemo(() => {
    if (warehouseId === 0n) {
      return { zones: [], slots: [], items: [] };
    }
    const productById = new Map<string, { name: string; sku: string }>();
    for (const p of products) {
      const id = String(p.id ?? '');
      productById.set(id, {
        name: String(p.name ?? ''),
        sku: String(p.defaultCode ?? ''),
      });
    }
    return buildWarehouse3DView(
      warehouseId,
      zones3D,
      allLocations,
      allQuants,
      productById,
    );
  }, [warehouseId, zones3D, allLocations, allQuants, products]);
}

// ── Reads: advanced inventory (query API + hooks; use in future tabs or dashboards) ──

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

export function useCreateProduct(
  organizationId: bigint,
  options?: { productDefaults?: Record<string, unknown> },
) {
  const qc = useQueryClient();
  const productDefaults = options?.productDefaults ?? {};
  return useMutation<void, Error, CreateProductParams>({
    mutationFn: async (params) => {
      const merged = mergeReducerParams(
        mergeReducerParams(CREATE_PRODUCT_DEFAULTS, productDefaults),
        params,
      );
      const { urlPath, init } = stdbBffCommandPost('create_product', {
        params: stdbParamsToJson(merged as object, 'CreateProductParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create product');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['products', rqBigIntKey(organizationId)],
      }),
  });
}

export function useUpdateProduct(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { productId: ScalarId; params: Partial<UpdateProductParams> }
  >({
    mutationFn: async ({ productId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_product', {
        productId: toScalarU64(productId),
        params: stdbParamsToJson(
          finalizeUpdateProductParams(params),
          'UpdateProductParams',
        ),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update product');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDeleteProduct(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (productId) => {
      const { urlPath, init } = stdbBffCommandPost('delete_product', {
        productId: toScalarU64(productId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete product');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateProductVariant(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { productTmplId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ productTmplId, params }) => {
      const mapped = toCreateProductVariantParams(params);
      if (!mapped) throw new Error('Invalid product variant params');
      const { urlPath, init } = stdbBffCommandPost('create_product_variant', {
        productTmplId: toScalarU64(productTmplId),
        params: stdbParamsToJson(mapped, 'CreateProductVariantParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create product variant');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useCreateWarehouse(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateWarehouseParams>({
    mutationFn: async (params) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('create_warehouse', {
        companyId,
        params: stdbParamsToJson(params as object, 'CreateWarehouseParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create warehouse');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateWarehouse(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { warehouseId: ScalarId; params: Partial<UpdateWarehouseParams> }
  >({
    mutationFn: async ({ warehouseId, params }) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('update_warehouse', {
        companyId,
        warehouseId: toScalarU64(warehouseId),
        params: stdbParamsToJson(params as object, 'UpdateWarehouseParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update warehouse');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useDeleteWarehouse(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (warehouseId) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('delete_warehouse', {
        companyId,
        warehouseId: toScalarU64(warehouseId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete warehouse');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useOrgUsers() {
  return useQuery({
    queryKey: ['org-users'],
    queryFn: async () => {
      const r = await apiFetch('/api/settings/users?limit=100');
      if (!r.ok) throw new Error('Failed to load users');
      const json = (await r.json()) as { data?: Record<string, unknown>[] };
      return json.data ?? [];
    },
    staleTime: 60_000,
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
      const reducer = createBackorder
        ? 'validate_stock_picking_backorder'
        : 'validate_stock_picking';
      const { urlPath, init } = inventoryBffPost(reducer, [
        organizationId,
        toScalarU64(pickingId),
        companyScopeParams(companyId),
      ]);
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

// ── 3PL / inventory integration intents ──────────────────────────────────────

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

// ── Warehouse sync (offline / intermittent) ───────────────────────────────────

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

export function useCreateProductCategory(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateProductCategoryParams>({
    mutationFn: async (params) => {
      const base = companyId != null ? { companyId: Number(companyId) } : {};
      const merged = mergeReducerParams(base, params);
      const { urlPath, init } = stdbBffCommandPost('create_product_category', {
        params: stdbParamsToJson(
          merged as object,
          'CreateProductCategoryParams',
        ),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create product category');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['product-categories', rqBigIntKey(organizationId)],
      }),
  });
}

export function useUpdateProductCategory(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { categoryId: ScalarId; params: Partial<UpdateProductCategoryParams> }
  >({
    mutationFn: async ({ categoryId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_product_category', {
        categoryId: toScalarU64(categoryId),
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update product category');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['product-categories', rqBigIntKey(organizationId)],
      }),
  });
}

export function useDeleteProductCategory(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (categoryId) => {
      const { urlPath, init } = stdbBffCommandPost('delete_product_category', {
        categoryId: toScalarU64(categoryId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete product category');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['product-categories', rqBigIntKey(organizationId)],
      }),
  });
}

// ── Stock Routes & Rules ────────────────────────────────────────────────────

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

export function useUpdateProductVariant(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { variantId: ScalarId; params: Partial<UpdateProductVariantParams> }
  >({
    mutationFn: async ({ variantId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_product_variant', {
        variantId: toScalarU64(variantId),
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update product variant');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateProductInventoryData(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { productId: ScalarId; params: Partial<UpdateProductInventoryDataParams> }
  >({
    mutationFn: async ({ productId, params }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'update_product_inventory_data',
        {
          productId: toScalarU64(productId),
          params: stdbParamsToJson(params as object),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update product inventory data');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

export function useUpdateProductPricing(
  organizationId: bigint,
  _companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { productId: ScalarId; params: Partial<UpdateProductPricingParams> }
  >({
    mutationFn: async ({ productId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_product_pricing', {
        productId: toScalarU64(productId),
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update product pricing');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['products', rqBigIntKey(organizationId)],
      }),
  });
}

// ── Reducer coverage: inventory mission (quality, quants, lots/serials, 3D, product extensions, etc.) ──

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

/** Stamps rule last_run / next_run (differs from trigger_replenishment which evaluates stock). */
export function useExecuteReplenishmentRule(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (ruleId) => {
      const { urlPath, init } = inventoryBffPost('execute_replenishment_rule', [
        toScalarU64(ruleId),
      ]);
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

export function useCreateWarehouse3dZone(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    {
      warehouseId: ScalarId;
      locationId: ScalarId;
      params: CreateWarehouse3DZoneParams;
    }
  >({
    mutationFn: async ({ warehouseId, locationId, params }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'create_warehouse_3_d_zone',
        {
          warehouseId: toScalarU64(warehouseId),
          locationId: toScalarU64(locationId),
          params: stdbParamsToJson(params as object),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create 3D zone');
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId);
      void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] });
      void qc.invalidateQueries({ queryKey: ['stock-locations', orgKey] });
    },
  });
}

export function useUpdateWarehouse3dZone(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { zoneId: ScalarId; params: Partial<UpdateWarehouse3DZoneParams> }
  >({
    mutationFn: async ({ zoneId, params }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'update_warehouse_3_d_zone',
        {
          zoneId: toScalarU64(zoneId),
          params: stdbParamsToJson(params as object),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update 3D zone');
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId);
      void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] });
    },
  });
}

export function useDeleteWarehouse3dZone(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (zoneId) => {
      const { urlPath, init } = stdbBffCommandPost(
        'delete_warehouse_3_d_zone',
        { zoneId: toScalarU64(zoneId) },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to delete 3D zone');
    },
    onSuccess: () => {
      const orgKey = rqBigIntKey(organizationId);
      void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] });
    },
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

export function useCreateProductSupplierInfo(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const mapped = toCreateProductSupplierInfoParams(params);
      if (!mapped) throw new Error('Invalid supplier info params');
      const { urlPath, init } = stdbBffCommandPost(
        'create_product_supplier_info',
        { params: stdbParamsToJson(mapped, 'CreateProductSupplierInfoParams') },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create supplier info');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['products', rqBigIntKey(organizationId)],
      }),
  });
}

export function useUpdateProductSupplierInfo(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { supplierInfoId: ScalarId; params: Partial<UpdateProductSupplierInfoParams> }
  >({
    mutationFn: async ({ supplierInfoId, params }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'update_product_supplier_info',
        {
          supplierInfoId: toScalarU64(supplierInfoId),
          params: stdbParamsToJson(params as object),
        },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update supplier info');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['products', rqBigIntKey(organizationId)],
      }),
  });
}

export function useCreateProductPackaging(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { productId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ productId, params }) => {
      const mapped = toCreateProductPackagingParams(params);
      if (!mapped) throw new Error('Invalid packaging params');
      const { urlPath, init } = stdbBffCommandPost('create_product_packaging', {
        productId: toScalarU64(productId),
        params: stdbParamsToJson(mapped, 'CreateProductPackagingParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to create packaging');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['products', rqBigIntKey(organizationId)],
      }),
  });
}

export function useUpdateProductPackaging(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { packagingId: ScalarId; params: Partial<UpdateProductPackagingParams> }
  >({
    mutationFn: async ({ packagingId, params }) => {
      const { urlPath, init } = stdbBffCommandPost('update_product_packaging', {
        packagingId: toScalarU64(packagingId),
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update packaging');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['products', rqBigIntKey(organizationId)],
      }),
  });
}

export function useRestoreProductCategory(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (categoryId) => {
      const { urlPath, init } = stdbBffCommandPost('restore_product_category', {
        categoryId: toScalarU64(categoryId),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to restore category');
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['product-categories', rqBigIntKey(organizationId)],
      }),
  });
}

export function useUpsertWarehouseGeo(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    {
      warehouseId: ScalarId;
      latitude: number;
      longitude: number;
      address?: string | null;
      city?: string | null;
      countryCode?: string | null;
      managerName?: string | null;
    }
  >({
    mutationFn: async (p) => {
      const { urlPath, init } = stdbBffCommandPost('upsert_warehouse_geo', {
        warehouseId: toScalarU64(p.warehouseId),
        latitude: p.latitude,
        longitude: p.longitude,
        address: p.address ?? null,
        city: p.city ?? null,
        countryCode: p.countryCode ?? null,
        managerName: p.managerName ?? null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to save warehouse geo');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}

// ── CSV imports (inventory + UOM masters) ─────────────────────────────────────

import { responseErrorMessage as parseCallErrorInv } from '@lumiere/api-client/response-error';

export function useImportUomCategoryCsv(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost('import_uom_category_csv', {
        csvData: csvData,
      });
      const res = await apiFetch(urlPath, init);
      if (!res.ok) throw new Error(await parseCallErrorInv(res));
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['uoms', rqBigIntKey(organizationId)],
      }),
  });
}

export function useImportUomCsv(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost('import_uom_csv', {
        csvData: csvData,
      });
      const res = await apiFetch(urlPath, init);
      if (!res.ok) throw new Error(await parseCallErrorInv(res));
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['uoms', rqBigIntKey(organizationId)],
      }),
  });
}

export function useImportProductCategoryCsv(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost(
        'import_product_category_csv',
        { csvData: csvData },
      );
      const res = await apiFetch(urlPath, init);
      if (!res.ok) throw new Error(await parseCallErrorInv(res));
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['product-categories', rqBigIntKey(organizationId)],
      });
      void qc.invalidateQueries({
        queryKey: ['products', rqBigIntKey(organizationId)],
      });
    },
  });
}

export function useImportProductCsv(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { csvData: string; currencyId: number }) => {
      const { urlPath, init } = stdbBffCommandPost('import_product_csv', {
        currencyId: args.currencyId,
        csvData: args.csvData,
      });
      const res = await apiFetch(urlPath, init);
      if (!res.ok) throw new Error(await parseCallErrorInv(res));
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['products', rqBigIntKey(organizationId)],
      }),
  });
}

export function useImportProductVariantCsv(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost(
        'import_product_variant_csv',
        { csvData: csvData },
      );
      const res = await apiFetch(urlPath, init);
      if (!res.ok) throw new Error(await parseCallErrorInv(res));
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['products', rqBigIntKey(organizationId)],
      }),
  });
}

export function useImportWarehouseCsv(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost('import_warehouse_csv', {
        companyId: companyId,
        csvData: csvData,
      });
      const res = await apiFetch(urlPath, init);
      if (!res.ok) throw new Error(await parseCallErrorInv(res));
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId);
      void qc.invalidateQueries({ queryKey: ['warehouses', k] });
      void qc.invalidateQueries({ queryKey: ['stock-locations', k] });
    },
  });
}

export function useImportStockLocationCsv(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost(
        'import_stock_location_csv',
        { companyId: companyId, csvData: csvData },
      );
      const res = await apiFetch(urlPath, init);
      if (!res.ok) throw new Error(await parseCallErrorInv(res));
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId);
      void qc.invalidateQueries({ queryKey: ['stock-locations', k] });
    },
  });
}

export function useImportStockQuantCsv(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost('import_stock_quant_csv', {
        companyId: companyId,
        csvData: csvData,
      });
      const res = await apiFetch(urlPath, init);
      if (!res.ok) throw new Error(await parseCallErrorInv(res));
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId);
      void qc.invalidateQueries({ queryKey: ['stock-quants', k] });
    },
  });
}

export function useImportLotCsv(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost('import_lot_csv', {
        companyId: companyId,
        csvData: csvData,
      });
      const res = await apiFetch(urlPath, init);
      if (!res.ok) throw new Error(await parseCallErrorInv(res));
    },
    onSuccess: () => {
      const k = rqBigIntKey(organizationId);
      void qc.invalidateQueries({ queryKey: ['stock-production-lots', k] });
    },
  });
}

export function useInventoryCsvImportMutations(
  organizationId: bigint,
  companyId: bigint,
) {
  return {
    importUomCategory: useImportUomCategoryCsv(organizationId),
    importUom: useImportUomCsv(organizationId),
    importProductCategory: useImportProductCategoryCsv(organizationId),
    importProduct: useImportProductCsv(organizationId),
    importProductVariant: useImportProductVariantCsv(organizationId),
    importWarehouse: useImportWarehouseCsv(organizationId, companyId),
    importStockLocation: useImportStockLocationCsv(organizationId, companyId),
    importStockQuant: useImportStockQuantCsv(organizationId, companyId),
    importLot: useImportLotCsv(organizationId, companyId),
  };
}

/** Integration / admin: Meta WhatsApp quality score — no inventory tab UI. */
export function useUpdateWhatsappQualityScore(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { accountId: ScalarId; qualityScore: string }
  >({
    mutationFn: async ({ accountId, qualityScore }) => {
      const { urlPath, init } = stdbBffCommandPost(
        'update_whatsapp_quality_score',
        { accountId: toScalarU64(accountId), qualityScore: qualityScore },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error('Failed to update WhatsApp quality score');
    },
    onSuccess: () => invalidateInventoryQueries(qc, organizationId),
  });
}
