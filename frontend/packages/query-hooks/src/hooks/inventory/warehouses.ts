"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, coalesceQueryInitialData, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { useMemo } from "react"
import { buildWarehouse3DView } from "@lumiere/erp-shared/warehouse-3d-from-api"

// ── Shared helpers ───────────────────────────────────────────────────────────
import {
  inventoryInitialData,
  inventoryListQueryOptions,
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

export function useWarehouses(
  organizationId: bigint,
  initialData?: Warehouse[],
  enabled = true,
  companyId?: bigint,
) {
  return useQuery<Warehouse[]>({
    enabled,
    ...inventoryListQueryOptions('warehouses', organizationId, 'Failed to fetch warehouses', companyId),
    initialData: inventoryInitialData(initialData, companyId),
  });
}


export function useWarehouse3DZones(organizationId: bigint, companyId: bigint, enabled = true) {
  return useQuery<Warehouse3DZone[]>({
    enabled: enabled && companyId > 0n,
    queryKey: ['warehouse-3d-zones', rqBigIntKey(organizationId), String(companyId)],
    queryFn: () => fetchQueryList(
      `/api/query/warehouse-3d-zones?companyId=${companyId}`,
      'Failed to fetch warehouse 3D zones',
    ),
    staleTime: 30_000,
  });
}

export function useWarehouse3D(
  organizationId: bigint,
  _companyId: bigint,
  warehouseId: bigint,
  enabled = true,
) {
  const orgKey = rqBigIntKey(organizationId);
  const zonesQuery = useQuery<Warehouse3DZone[]>({
    enabled,
    queryKey: ['warehouse-3d-zones', orgKey],
    queryFn: () =>
      fetchQueryList(
        '/api/query/warehouse-3d-zones',
        'Failed to fetch warehouse 3D zones',
      ),
    staleTime: 30_000,
  });
  const locationsQuery = useQuery<StockLocation[]>({
    enabled,
    queryKey: ['stock-locations', orgKey],
    queryFn: () =>
      fetchQueryList(
        '/api/query/stock-locations',
        'Failed to fetch stock locations',
      ),
    staleTime: 30_000,
  });
  const quantsQuery = useQuery<StockQuant[]>({
    enabled,
    queryKey: ['stock-quants', orgKey],
    queryFn: () =>
      fetchQueryList('/api/query/stock-quants', 'Failed to fetch stock quants'),
    staleTime: 30_000,
  });
  const productsQuery = useQuery<Product[]>({
    enabled,
    queryKey: ['products', orgKey],
    queryFn: () =>
      fetchQueryList('/api/query/products', 'Failed to fetch products'),
    staleTime: 30_000,
  });

  const { data: zones3D } = zonesQuery;
  const { data: allLocations } = locationsQuery;
  const { data: allQuants } = quantsQuery;
  const { data: products } = productsQuery;
  const view = useMemo(() => {
    if (!enabled || warehouseId === 0n) {
      return { zones: [], slots: [], items: [] };
    }
    const productById = new Map<string, { name: string; sku: string }>();
    for (const p of products ?? []) {
      const id = String(p.id ?? '');
      productById.set(id, {
        name: String(p.name ?? ''),
        sku: String(p.defaultCode ?? ''),
      });
    }
    return buildWarehouse3DView(
      warehouseId,
      zones3D ?? [],
      allLocations ?? [],
      allQuants ?? [],
      productById,
    );
  }, [enabled, warehouseId, zones3D, allLocations, allQuants, products]);
  return { ...view, queries: [zonesQuery, locationsQuery, quantsQuery, productsQuery] };
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
