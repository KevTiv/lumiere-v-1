"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, coalesceQueryInitialData, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { scalarToU64 as toScalarU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { finalizeUpdateProductParams } from "../inventory-params-merge"
import {
  toCreateProductVariantParams,
  toCreateProductSupplierInfoParams,
  toCreateProductPackagingParams,
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
