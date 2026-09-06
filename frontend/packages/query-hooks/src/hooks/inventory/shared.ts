"use client"

import { useQueryClient } from '@tanstack/react-query'
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { rqBigIntKey } from "../../http"

export function companyScopeParams(companyId: bigint): Record<string, unknown> {
  return stdbParamsToJson({ companyId }, 'CompanyScopeParams')
}

/** Shallow merge for reducer JSON: `overrides` entries with value `undefined` are skipped. */
export function mergeReducerParams(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

export const CREATE_PRODUCT_DEFAULTS: Record<string, unknown> = {
  costMethod: 'standard',
  valuation: 'manual_periodic',
}

export const CREATE_STOCK_QUANT_DEFAULTS: Record<string, unknown> = {
  inventoryQuantity: 0,
  inventoryDiffQuantity: 0,
  inventoryQuantitySet: false,
  isOutdated: false,
  accountingEntryIds: [],
}

export const CREATE_STOCK_PICKING_DEFAULTS: Record<string, unknown> = {
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
}

export const CREATE_STOCK_LOCATION_DEFAULTS: Record<string, unknown> = {
  childLeft: 0,
  childRight: 1,
  scrapLocation: false,
  returnLocation: false,
  active: true,
  posx: 0,
  posy: 0,
  posz: 0,
  cyclicInventoryFrequency: 0,
}

export function invalidateInventoryQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const orgKey = rqBigIntKey(organizationId)
  void qc.invalidateQueries({ queryKey: ['products', orgKey] })
  void qc.invalidateQueries({ queryKey: ['product-categories', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-locations', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-quants', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-pickings', orgKey] })
  void qc.invalidateQueries({ queryKey: ['inventory-adjustments', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-production-lots', orgKey] })
  void qc.invalidateQueries({ queryKey: ['warehouses', orgKey] })
  void qc.invalidateQueries({ queryKey: ['quality-checks', orgKey] })
  void qc.invalidateQueries({ queryKey: ['quality-alerts', orgKey] })
  void qc.invalidateQueries({ queryKey: ['warehouse-3d-zones', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-cycle-counts', orgKey] })
  void qc.invalidateQueries({ queryKey: ['warehouse-3d', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-inventories', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-moves', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-production-serials', orgKey] })
  void qc.invalidateQueries({ queryKey: ['adjustment-reasons', orgKey] })
  void qc.invalidateQueries({ queryKey: ['barcode-nomenclatures', orgKey] })
  void qc.invalidateQueries({ queryKey: ['serial-lot-traceability', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-traceability-reports', orgKey] })
  void qc.invalidateQueries({ queryKey: ['stock-packages', orgKey] })
  void qc.invalidateQueries({ queryKey: ['inventory-exceptions', orgKey] })
  void qc.invalidateQueries({ queryKey: ['inventory-exceptions-short-atp', orgKey] })
  void qc.invalidateQueries({ queryKey: ['inventory-exceptions-expired-lots', orgKey] })
  void qc.invalidateQueries({ queryKey: ['inventory-exceptions-open-qc', orgKey] })
}
