"use client"

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { responseErrorMessage as parseCallErrorInv } from "@lumiere/api-client/response-error"



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
